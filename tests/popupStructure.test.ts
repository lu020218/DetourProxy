// @vitest-environment jsdom
//
// 紧凑弹窗（popup）结构、无障碍与样式契约测试。
// 覆盖需求：
//   - Req 6.1 / 9.1：弹窗呈现状态区块与模式区块，均带可见标签。
//   - Req 9.6：每个 Interactive_Control 均具备 Accessible_Label。
//   - Req 9.7：键盘 Tab 焦点顺序自上而下匹配 DOM 顺序。
//   - Req 9.5：无水平滚动（通过共享 theme.css + popup.css 的 CSS 契约断言）。
//
// 详细配置（端点/绕过/PAC）已移至 options 页面，由 optionsStructure 测试覆盖。

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(here, '../src/popup/popup.html');
const POPUP_CSS_PATH = resolve(here, '../src/popup/popup.css');
const THEME_CSS_PATH = resolve(here, '../src/ui/theme.css');

function loadPopupBody(): void {
  const html = readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) {
    throw new Error('无法在 popup.html 中找到 <body> 元素');
  }
  const body = match[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = body;
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
  loadPopupBody();
});

describe('弹窗结构与可见标签 (Req 6.1, 9.1)', () => {
  const sections: Array<{ id: string; labelId: string }> = [
    { id: 'section-status', labelId: 'section-status-label' },
    { id: 'section-mode', labelId: 'section-mode-label' },
  ];

  it('在弹窗根容器内呈现状态与模式区块', () => {
    const root = document.getElementById('popup-root');
    expect(root, 'popup-root 容器应存在').not.toBeNull();

    for (const { id } of sections) {
      const section = document.getElementById(id);
      expect(section, `应存在区块 #${id}`).not.toBeNull();
      expect(root!.contains(section!), `#${id} 应位于弹窗容器内`).toBe(true);
    }
  });

  it('每个区块均带有非空的可见标签 (h2)', () => {
    for (const { id, labelId } of sections) {
      const label = document.getElementById(labelId);
      expect(label, `#${id} 应有标签元素 #${labelId}`).not.toBeNull();
      expect(['LEGEND', 'H1', 'H2']).toContain(label!.tagName);
      expect((label!.textContent ?? '').trim().length).toBeGreaterThan(0);
      const section = document.getElementById(id)!;
      expect(section.getAttribute('aria-labelledby')).toBe(labelId);
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
  // 弹窗自上而下的可聚焦控件：设置按钮 → 开关 → 模式单选 → 高级设置按钮
  const expectedOrder = [
    'open-settings',
    'enable-toggle',
    'mode-system',
    'mode-fixed',
    'mode-pac',
    'open-settings-link',
  ];

  function focusableInDomOrder(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]), select, textarea, button, [tabindex]',
      ),
    );
  }

  it('DOM 中可聚焦控件的顺序自上而下匹配可见排列', () => {
    const ids = focusableInDomOrder().map((el) => el.id);
    expect(ids).toEqual(expectedOrder);
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

describe('无水平滚动的 CSS 契约 (Req 9.5)', () => {
  let themeCss = '';
  let popupCss = '';

  beforeAll(() => {
    themeCss = readFileSync(THEME_CSS_PATH, 'utf8');
    popupCss = readFileSync(POPUP_CSS_PATH, 'utf8');
  });

  function normalize(text: string): string {
    return text.replace(/\s+/g, ' ');
  }

  it('共享主题设置 box-sizing: border-box 并在 body 上 overflow-x: hidden', () => {
    expect(/box-sizing\s*:\s*border-box/i.test(themeCss)).toBe(true);
    const bodyRule = normalize(themeCss).match(/body\s*\{([^}]*)\}/i)?.[1] ?? '';
    expect(/overflow-x\s*:\s*hidden/i.test(bodyRule)).toBe(true);
  });

  it('弹窗为紧凑固定宽度并设置 min-width 下限', () => {
    const bodyRule = normalize(popupCss).match(/body\s*\{([^}]*)\}/i)?.[1] ?? '';
    expect(/width\s*:\s*\d+px/i.test(bodyRule)).toBe(true);
    expect(/min-width\s*:\s*320px/i.test(bodyRule)).toBe(true);
  });
});
