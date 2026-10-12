// @vitest-environment jsdom
//
// 设置页（options）结构、无障碍与响应式测试。
// 覆盖需求：
//   - Req 9.1：呈现端点 / 绕过 / PAC 三个配置区块，均带可见标签。
//   - Req 9.6：每个 Interactive_Control 均具备 Accessible_Label。
//   - Req 9.7：键盘 Tab 焦点顺序自上而下匹配 DOM 顺序。
//   - Req 9.5：320–800px 视口下无水平滚动（CSS 契约断言）。

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(here, '../src/options/options.html');
const OPTIONS_CSS_PATH = resolve(here, '../src/options/options.css');
const THEME_CSS_PATH = resolve(here, '../src/ui/theme.css');

function loadOptionsBody(): void {
  const html = readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) {
    throw new Error('无法在 options.html 中找到 <body> 元素');
  }
  document.body.innerHTML = match[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

function hasAccessibleLabel(el: Element): boolean {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim().length > 0) {
    return true;
  }
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy && labelledBy.trim().length > 0) {
    const ids = labelledBy.trim().split(/\s+/);
    if (ids.every((id) => {
      const target = document.getElementById(id);
      return !!target && (target.textContent ?? '').trim().length > 0;
    })) {
      return true;
    }
  }
  const id = el.getAttribute('id');
  if (id) {
    const explicit = document.querySelector(`label[for="${id}"]`);
    if (explicit && (explicit.textContent ?? '').trim().length > 0) {
      return true;
    }
  }
  const wrapping = el.closest('label');
  if (wrapping && (wrapping.textContent ?? '').trim().length > 0) {
    return true;
  }
  if (el.tagName === 'BUTTON' && (el.textContent ?? '').trim().length > 0) {
    return true;
  }
  return false;
}

beforeAll(() => {
  loadOptionsBody();
});

describe('设置页结构与可见标签 (Req 9.1)', () => {
  const sections: Array<{ id: string; labelId: string }> = [
    { id: 'section-endpoint', labelId: 'section-endpoint-label' },
    { id: 'section-bypass', labelId: 'section-bypass-label' },
    { id: 'section-pac', labelId: 'section-pac-label' },
  ];

  it('呈现端点 / 绕过 / PAC 三个配置区块', () => {
    const root = document.getElementById('options-root');
    expect(root).not.toBeNull();
    for (const { id } of sections) {
      const section = document.getElementById(id);
      expect(section, `应存在区块 #${id}`).not.toBeNull();
      expect(root!.contains(section!)).toBe(true);
    }
  });

  it('每个区块均带有非空的可见标签 (h2) 并通过 aria-labelledby 关联', () => {
    for (const { id, labelId } of sections) {
      const label = document.getElementById(labelId);
      expect(label, `#${id} 应有标签 #${labelId}`).not.toBeNull();
      expect(['LEGEND', 'H1', 'H2']).toContain(label!.tagName);
      expect((label!.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect(document.getElementById(id)!.getAttribute('aria-labelledby')).toBe(labelId);
    }
  });
});

describe('Interactive_Control 无障碍标签 (Req 9.6)', () => {
  it('每个 Interactive_Control 均具备 Accessible_Label', () => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('input, select, textarea, button'),
    );
    expect(controls.length).toBeGreaterThan(0);
    const unlabeled = controls.filter((el) => !hasAccessibleLabel(el));
    const info = unlabeled.map((el) => `${el.tagName.toLowerCase()}#${el.id || '(no-id)'}`);
    expect(unlabeled.length, `以下控件缺少 Accessible_Label: ${info.join(', ')}`).toBe(0);
  });
});

describe('键盘焦点顺序匹配 DOM 顺序 (Req 9.7)', () => {
  const expectedOrder = [
    'host-input',
    'port-input',
    'protocol-select',
    'save-endpoint',
    'bypass-input',
    'save-bypass',
    'pac-source-url',
    'pac-source-inline',
    'pac-url-input',
    'pac-script-input',
    'save-pac',
  ];

  function focusableInDomOrder(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]), select, textarea, button, [tabindex]',
      ),
    );
  }

  it('DOM 中可聚焦控件的顺序自上而下匹配各区块的可见排列', () => {
    expect(focusableInDomOrder().map((el) => el.id)).toEqual(expectedOrder);
  });

  it('不存在正值 tabindex', () => {
    for (const el of focusableInDomOrder()) {
      const tabindexAttr = el.getAttribute('tabindex');
      if (tabindexAttr !== null) {
        expect(Number(tabindexAttr)).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('响应式无水平滚动的 CSS 契约 (Req 9.5)', () => {
  let themeCss = '';
  let optionsCss = '';

  beforeAll(() => {
    themeCss = readFileSync(THEME_CSS_PATH, 'utf8');
    optionsCss = readFileSync(OPTIONS_CSS_PATH, 'utf8');
  });

  function normalize(text: string): string {
    return text.replace(/\s+/g, ' ');
  }

  it('共享主题设置 box-sizing: border-box 并在 body 上 overflow-x: hidden', () => {
    expect(/box-sizing\s*:\s*border-box/i.test(themeCss)).toBe(true);
    const bodyRule = normalize(themeCss).match(/body\s*\{([^}]*)\}/i)?.[1] ?? '';
    expect(/overflow-x\s*:\s*hidden/i.test(bodyRule)).toBe(true);
  });

  it('设置页内容容器限定最大宽度（<= 800px）且 body 设置 min-width 下限', () => {
    const rootRule = normalize(optionsCss).match(/\.options-root\s*\{([^}]*)\}/i)?.[1] ?? '';
    const maxWidthMatch = rootRule.match(/max-width\s*:\s*(\d+)px/i);
    expect(maxWidthMatch, '.options-root 应设置 max-width').not.toBeNull();
    expect(Number(maxWidthMatch![1])).toBeLessThanOrEqual(800);

    const bodyRule = normalize(optionsCss).match(/body\s*\{([^}]*)\}/i)?.[1] ?? '';
    expect(/min-width\s*:\s*320px/i.test(bodyRule)).toBe(true);
  });
});
