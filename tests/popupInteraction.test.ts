// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  queryDom,
  applyValidationErrors,
  clearValidationErrors,
  highlightMode,
  selectMode,
  renderStatus,
  type PopupDom,
} from '../src/popup/popup.js';
import type { FieldError, ProxyStatus } from '../src/core/types.js';

/**
 * Popup interaction tests (Req 9.2, 9.3, 9.4, 6.4) plus the shared theming
 * contract (Req 9.8). Detailed field validation (host/port/bypass/pac) now
 * lives on the options page and is covered by optionsInteraction.test.ts; the
 * popup only surfaces config-level messages (e.g. "请先在设置中配置端点").
 */

const POPUP_HTML_PATH = resolve(process.cwd(), 'src/popup/popup.html');
const THEME_CSS_PATH = resolve(process.cwd(), 'src/ui/theme.css');

function loadPopupBody(): string {
  const html = readFileSync(POPUP_HTML_PATH, 'utf8');
  const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    throw new Error('popup.html 缺少 <body> 元素');
  }
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

const THEME_CSS = readFileSync(THEME_CSS_PATH, 'utf8');

function makeStatus(overrides: Partial<ProxyStatus> = {}): ProxyStatus {
  return {
    effectiveMode: 'Direct',
    selectedMode: 'Fixed_Servers',
    endpoint: null,
    pac: null,
    errorActive: false,
    errorEndpoint: null,
    ...overrides,
  };
}

describe('Popup interaction: highlight, feedback, config message, theming', () => {
  let dom: PopupDom;

  beforeEach(() => {
    document.body.innerHTML = loadPopupBody();
    dom = queryDom(document);
  });

  // -------------------------------------------------------------------------
  // Req 9.4 — config-level message renders next to the mode controls
  // -------------------------------------------------------------------------
  describe('config message placement (Req 9.4)', () => {
    it('shows a config message inside the mode section and clears it', () => {
      const errors: FieldError[] = [
        { field: 'config', message: '尚未配置有效的代理端点。' },
      ];

      applyValidationErrors(errors, dom);

      expect(dom.modeError.hidden).toBe(false);
      expect(dom.modeError.textContent).toBe(errors[0].message);
      const modeSection = document.getElementById('section-mode');
      expect(modeSection?.contains(dom.modeError)).toBe(true);

      clearValidationErrors(dom);
      expect(dom.modeError.hidden).toBe(true);
      expect(dom.modeError.textContent).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Req 9.3 — current mode visually distinguished from the other options
  // -------------------------------------------------------------------------
  describe('current mode highlight (Req 9.3)', () => {
    it('marks only the active mode option as active / aria-checked', () => {
      highlightMode('Fixed_Servers', dom);

      for (const radio of dom.modeRadios) {
        const label = radio.closest('.mode-option') as HTMLElement;
        expect(label).not.toBeNull();
        if (radio.value === 'Fixed_Servers') {
          expect(radio.checked).toBe(true);
          expect(label.classList.contains('active')).toBe(true);
          expect(label.getAttribute('aria-checked')).toBe('true');
        } else {
          expect(radio.checked).toBe(false);
          expect(label.classList.contains('active')).toBe(false);
          expect(label.getAttribute('aria-checked')).toBe('false');
        }
      }

      expect(document.querySelectorAll('.mode-option.active').length).toBe(1);
    });

    it('moves the highlight when a different mode becomes active', () => {
      highlightMode('Fixed_Servers', dom);
      highlightMode('PAC', dom);

      const pacRadio = dom.modeRadios.find((r) => r.value === 'PAC')!;
      const fixedRadio = dom.modeRadios.find((r) => r.value === 'Fixed_Servers')!;
      expect(pacRadio.closest('.mode-option')?.classList.contains('active')).toBe(true);
      expect(fixedRadio.closest('.mode-option')?.classList.contains('active')).toBe(false);
      expect(document.querySelectorAll('.mode-option.active').length).toBe(1);
    });

    // Model 1A: while the proxy is OFF the chosen mode is "selected-pending"
    // (outline), visually distinct from the active fill, and no radio is left
    // checked so the shared :has(input:checked) fill cannot paint it as active.
    it('marks the pending mode as selected (not active) when disabled', () => {
      selectMode('PAC', dom);

      const pacOption = dom.modeRadios
        .find((r) => r.value === 'PAC')!
        .closest('.mode-option') as HTMLElement;

      expect(pacOption.classList.contains('selected')).toBe(true);
      expect(pacOption.classList.contains('active')).toBe(false);
      // Pending selection leaves every radio unchecked.
      expect(dom.modeRadios.every((r) => !r.checked)).toBe(true);
      expect(document.querySelectorAll('.mode-option.active').length).toBe(0);
      expect(document.querySelectorAll('.mode-option.selected').length).toBe(1);
    });

    // renderStatus routes disabled (Direct) status to the selected-pending
    // style and enabled status to the active fill.
    it('renders selected-pending highlight for a disabled status', () => {
      renderStatus(
        makeStatus({ effectiveMode: 'Direct', selectedMode: 'PAC' }),
        dom,
      );
      const pacOption = dom.modeRadios
        .find((r) => r.value === 'PAC')!
        .closest('.mode-option') as HTMLElement;
      expect(pacOption.classList.contains('selected')).toBe(true);
      expect(document.querySelectorAll('.mode-option.active').length).toBe(0);

      // Enabling flips it to the active fill.
      renderStatus(
        makeStatus({ effectiveMode: 'PAC', selectedMode: 'PAC', pac: { kind: 'url', url: 'http://x/p.pac' } }),
        dom,
      );
      expect(pacOption.classList.contains('active')).toBe(true);
      expect(pacOption.classList.contains('selected')).toBe(false);
      expect(document.querySelectorAll('.mode-option.selected').length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Req 9.2 / 6.4 — feedback & status updates land synchronously (< 1000 ms)
  // -------------------------------------------------------------------------
  describe('visual feedback / status timing (Req 9.2, 6.4)', () => {
    it('reflects a config message synchronously, well within 1000 ms', () => {
      const start = performance.now();
      applyValidationErrors([{ field: 'config', message: '需要先配置端点。' }], dom);
      const elapsed = performance.now() - start;

      expect(dom.modeError.hidden).toBe(false);
      expect(elapsed).toBeLessThan(1000);
    });

    it('updates status text, endpoint row and highlight synchronously on mode change (Req 6.4)', () => {
      renderStatus(makeStatus({ effectiveMode: 'Direct' }), dom);
      expect(dom.statusMode.textContent).toBe('直连');
      expect(dom.statusEndpointRow.hidden).toBe(true);

      const start = performance.now();
      renderStatus(
        makeStatus({
          effectiveMode: 'Fixed_Servers',
          endpoint: { host: '192.168.1.10', port: 1080, protocol: 'SOCKS5' },
        }),
        dom,
      );
      const elapsed = performance.now() - start;

      expect(dom.statusMode.textContent).toBe('固定服务器');
      expect(dom.statusEndpointRow.hidden).toBe(false);
      expect(dom.statusEndpoint.textContent).toContain('192.168.1.10');
      const fixedRadio = dom.modeRadios.find((r) => r.value === 'Fixed_Servers')!;
      expect(fixedRadio.closest('.mode-option')?.classList.contains('active')).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // -------------------------------------------------------------------------
  // Req 9.8 — shared theme tracks the Browser-reported Color_Scheme
  // -------------------------------------------------------------------------
  describe('color scheme theming contract (Req 9.8)', () => {
    it('defines color tokens on :root for the default (light) theme', () => {
      expect(THEME_CSS).toMatch(/:root\s*\{/);
      expect(THEME_CSS).toMatch(/--color-bg:/);
      expect(THEME_CSS).toMatch(/--color-text:/);
      expect(THEME_CSS).toMatch(/--color-accent:/);
    });

    it('overrides the tokens under @media (prefers-color-scheme: dark)', () => {
      const darkBlock = THEME_CSS.match(
        /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{[\s\S]*?--color-bg:[\s\S]*?\}/,
      );
      expect(darkBlock).not.toBeNull();
      const darkText = darkBlock![0];
      expect(darkText).toMatch(/--color-bg:/);
      expect(darkText).toMatch(/--color-text:/);
    });

    it('opts the document into both color schemes via color-scheme', () => {
      expect(THEME_CSS).toMatch(/color-scheme:\s*light\s+dark/);
    });
  });
});
