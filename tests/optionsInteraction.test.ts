// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  queryDom,
  applyValidationErrors,
  clearValidationErrors,
  type OptionsDom,
} from '../src/options/options.js';
import type { FieldError } from '../src/core/types.js';

/**
 * Options page interaction tests: inline validation placement (Req 9.4) and
 * synchronous (< 1000 ms) feedback timing (Req 9.2). The detailed endpoint /
 * bypass / PAC validation messages must render adjacent to their controls.
 */

const OPTIONS_HTML_PATH = resolve(process.cwd(), 'src/options/options.html');

function loadOptionsBody(): string {
  const html = readFileSync(OPTIONS_HTML_PATH, 'utf8');
  const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    throw new Error('options.html 缺少 <body> 元素');
  }
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

describe('Options validation placement & timing (Req 9.4, 9.2)', () => {
  let dom: OptionsDom;

  beforeEach(() => {
    document.body.innerHTML = loadOptionsBody();
    dom = queryDom(document);
  });

  it('shows each message in the same field/section as its control and marks it invalid', () => {
    const errors: FieldError[] = [
      { field: 'host', message: '主机地址为必填，长度限定在 1 至 253 个字符之间。' },
      { field: 'port', message: '端口号无效，必须是 1 至 65535 范围内的整数。' },
    ];

    applyValidationErrors(errors, dom);

    expect(dom.hostError.hidden).toBe(false);
    expect(dom.hostError.textContent).toBe(errors[0].message);
    const hostField = dom.hostInput.closest('.field');
    expect(hostField?.contains(dom.hostError)).toBe(true);
    expect(
      dom.hostInput.compareDocumentPosition(dom.hostError) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const endpointSection = document.getElementById('section-endpoint');
    expect(endpointSection?.contains(dom.hostInput)).toBe(true);
    expect(endpointSection?.contains(dom.hostError)).toBe(true);
    expect(dom.hostInput.getAttribute('aria-invalid')).toBe('true');

    expect(dom.portError.hidden).toBe(false);
    expect(dom.portError.textContent).toBe(errors[1].message);
    expect(dom.portInput.getAttribute('aria-invalid')).toBe('true');

    // Unaffected fields stay clean.
    expect(dom.protocolError.hidden).toBe(true);
    expect(dom.protocolSelect.hasAttribute('aria-invalid')).toBe(false);
  });

  it('renders bypass and pac messages in their own sections', () => {
    applyValidationErrors(
      [
        { field: 'bypassList', message: '绕过列表无效。' },
        { field: 'pacUrl', message: 'PAC 脚本 URL 无效。' },
      ],
      dom,
    );

    expect(dom.bypassError.hidden).toBe(false);
    expect(document.getElementById('section-bypass')?.contains(dom.bypassError)).toBe(true);
    expect(dom.bypassInput.getAttribute('aria-invalid')).toBe('true');

    expect(dom.pacError.hidden).toBe(false);
    expect(document.getElementById('section-pac')?.contains(dom.pacError)).toBe(true);
    expect(dom.pacUrlInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('clearValidationErrors hides every message and removes aria-invalid', () => {
    applyValidationErrors(
      [
        { field: 'host', message: '主机错误' },
        { field: 'port', message: '端口错误' },
        { field: 'bypassList', message: '列表错误' },
        { field: 'pacUrl', message: 'PAC 错误' },
      ],
      dom,
    );

    clearValidationErrors(dom);

    expect(dom.hostError.hidden).toBe(true);
    expect(dom.hostError.textContent).toBe('');
    expect(dom.portError.hidden).toBe(true);
    expect(dom.bypassError.hidden).toBe(true);
    expect(dom.pacError.hidden).toBe(true);
    expect(dom.hostInput.hasAttribute('aria-invalid')).toBe(false);
    expect(dom.portInput.hasAttribute('aria-invalid')).toBe(false);
    expect(dom.bypassInput.hasAttribute('aria-invalid')).toBe(false);
    expect(dom.pacUrlInput.hasAttribute('aria-invalid')).toBe(false);
  });

  it('reflects validation feedback synchronously, well within 1000 ms (Req 9.2)', () => {
    const start = performance.now();
    applyValidationErrors([{ field: 'host', message: '主机地址无效。' }], dom);
    const elapsed = performance.now() - start;

    expect(dom.hostError.hidden).toBe(false);
    expect(dom.hostError.textContent).toBe('主机地址无效。');
    expect(elapsed).toBeLessThan(1000);
  });
});
