// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { queryDom, renderStatus, type PopupDom } from '../src/popup/popup.js';
import { buildProxyStatus } from '../src/core/status.js';
import { DEFAULT_BYPASS_LIST } from '../src/core/constants.js';
import type { ProxyConfiguration, ProxyEndpoint } from '../src/core/types.js';

/**
 * Compact popup rendering tests (Req 6.1, 6.2, 6.3, 7.1).
 *
 * The popup is the quick-access surface: it shows the Proxy_Status (on/off
 * pill, current mode, endpoint/PAC summary) and reconciles the master switch.
 * Detailed configuration (endpoint/bypass/PAC inputs) now lives on the options
 * page, so this file only exercises the popup's status rendering.
 */

const POPUP_HTML = readFileSync(
  resolve(process.cwd(), 'src/popup/popup.html'),
  'utf-8',
);

const MAIN_MARKUP = (() => {
  const match = POPUP_HTML.match(/<main[\s\S]*?<\/main>/);
  if (!match) {
    throw new Error('popup.html 缺少 <main> 标记');
  }
  return match[0];
})();

function makeConfig(overrides: Partial<ProxyConfiguration> = {}): ProxyConfiguration {
  return {
    endpoint: null,
    bypassList: [...DEFAULT_BYPASS_LIST],
    pac: null,
    ...overrides,
  };
}

describe('Popup status rendering (Req 6.1, 6.2, 6.3, 7.1)', () => {
  let dom: PopupDom;

  beforeEach(() => {
    document.body.innerHTML = MAIN_MARKUP;
    dom = queryDom(document);
  });

  it('shows the effective Proxy_Mode label for each mode (Req 6.1)', () => {
    const expectations: Array<[Parameters<typeof buildProxyStatus>[0], string]> = [
      ['Direct', '直连'],
      ['System', '系统代理'],
      ['Fixed_Servers', '固定服务器'],
      ['PAC', '自动配置 (PAC)'],
    ];

    for (const [mode, label] of expectations) {
      const status = buildProxyStatus(mode, makeConfig(), false, null);
      renderStatus(status, dom);
      expect(dom.statusMode.textContent).toBe(label);
    }
  });

  it('reflects the on/off state via pill text, dot and the master switch', () => {
    // Direct → disabled.
    renderStatus(buildProxyStatus('Direct', makeConfig(), false, null), dom);
    expect(dom.statusStateText.textContent).toBe('已禁用');
    expect(dom.statusIndicator.classList.contains('active')).toBe(false);
    expect(dom.enableToggle.checked).toBe(false);

    // A forwarding mode → enabled.
    const endpoint: ProxyEndpoint = { host: '192.168.1.10', port: 1080, protocol: 'SOCKS5' };
    renderStatus(buildProxyStatus('Fixed_Servers', makeConfig({ endpoint }), false, null), dom);
    expect(dom.statusStateText.textContent).toBe('已启用');
    expect(dom.statusIndicator.classList.contains('active')).toBe(true);
    expect(dom.enableToggle.checked).toBe(true);
  });

  it('shows the endpoint row with host/port/protocol for Fixed_Servers (Req 6.2)', () => {
    const endpoint: ProxyEndpoint = { host: '192.168.1.10', port: 1080, protocol: 'SOCKS5' };
    const status = buildProxyStatus('Fixed_Servers', makeConfig({ endpoint }), false, null);

    renderStatus(status, dom);

    expect(dom.statusEndpointRow.hidden).toBe(false);
    expect(dom.statusEndpoint.textContent).toBe('192.168.1.10:1080 (SOCKS5)');
    expect(dom.statusPacRow.hidden).toBe(true);
  });

  it('shows the PAC row with the PAC URL for PAC mode (Req 6.3)', () => {
    const pacUrl = 'http://192.168.1.10/proxy.pac';
    const status = buildProxyStatus(
      'PAC',
      makeConfig({ pac: { kind: 'url', url: pacUrl } }),
      false,
      null,
    );

    renderStatus(status, dom);

    expect(dom.statusPacRow.hidden).toBe(false);
    expect(dom.statusPac.textContent).toBe(pacUrl);
    expect(dom.statusEndpointRow.hidden).toBe(true);
  });

  it('shows "内联脚本" in the PAC row for an inline PAC source (Req 6.3)', () => {
    const status = buildProxyStatus(
      'PAC',
      makeConfig({ pac: { kind: 'inline', script: 'function FindProxyForURL(){return "DIRECT";}' } }),
      false,
      null,
    );

    renderStatus(status, dom);

    expect(dom.statusPacRow.hidden).toBe(false);
    expect(dom.statusPac.textContent).toBe('内联脚本');
  });

  it('hides both summary rows and the error for Direct mode (Req 6.1)', () => {
    renderStatus(buildProxyStatus('Direct', makeConfig(), false, null), dom);

    expect(dom.statusMode.textContent).toBe('直连');
    expect(dom.statusEndpointRow.hidden).toBe(true);
    expect(dom.statusPacRow.hidden).toBe(true);
    expect(dom.statusError.hidden).toBe(true);
  });

  it('surfaces an unreachable-endpoint error and an error dot (Req 7.1)', () => {
    const status = buildProxyStatus(
      'Fixed_Servers',
      makeConfig({ endpoint: { host: '10.0.0.5', port: 8080, protocol: 'HTTP' } }),
      true,
      { host: '10.0.0.5', port: 8080 },
    );

    renderStatus(status, dom);

    expect(dom.statusError.hidden).toBe(false);
    expect(dom.statusError.textContent).toContain('10.0.0.5');
    expect(dom.statusError.textContent).toContain('8080');
    expect(dom.statusIndicator.classList.contains('error')).toBe(true);
    expect(dom.statusStateText.textContent).toBe('代理错误');
  });
});
