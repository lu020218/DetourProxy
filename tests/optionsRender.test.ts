// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  queryDom,
  renderEndpoint,
  renderBypass,
  renderPac,
  buildBypassDisplay,
  type OptionsDom,
} from '../src/options/options.js';
import { DEFAULT_BYPASS_LIST } from '../src/core/constants.js';
import type { ProxyEndpoint } from '../src/core/types.js';

/**
 * Options page rendering and default-fill tests (Req 1.6, 4.5, 4.6).
 *
 * The options page owns the detailed configuration controls. On open it should
 * render the stored Proxy_Endpoint (or clear), the Bypass_List (default-filled
 * with localhost/127.0.0.1 when empty), and the stored PAC URL.
 */

const OPTIONS_HTML = readFileSync(
  resolve(process.cwd(), 'src/options/options.html'),
  'utf-8',
);

const MAIN_MARKUP = (() => {
  const match = OPTIONS_HTML.match(/<main[\s\S]*?<\/main>/);
  if (!match) {
    throw new Error('options.html 缺少 <main> 标记');
  }
  return match[0];
})();

describe('Options rendering and default fill (Req 1.6, 4.5, 4.6)', () => {
  let dom: OptionsDom;

  beforeEach(() => {
    document.body.innerHTML = MAIN_MARKUP;
    dom = queryDom(document);
  });

  describe('renderEndpoint (Req 1.6)', () => {
    it('populates host, port and protocol from the stored Proxy_Endpoint', () => {
      const endpoint: ProxyEndpoint = { host: '192.168.1.10', port: 1080, protocol: 'SOCKS5' };
      renderEndpoint(endpoint, dom);
      expect(dom.hostInput.value).toBe('192.168.1.10');
      expect(dom.portInput.value).toBe('1080');
      expect(dom.protocolSelect.value).toBe('SOCKS5');
    });

    it('reflects a non-default protocol selection', () => {
      renderEndpoint({ host: 'proxy.lan', port: 8080, protocol: 'HTTP' }, dom);
      expect(dom.hostInput.value).toBe('proxy.lan');
      expect(dom.portInput.value).toBe('8080');
      expect(dom.protocolSelect.value).toBe('HTTP');
    });

    it('clears host and port and resets protocol when no endpoint is stored', () => {
      renderEndpoint({ host: 'stale', port: 9999, protocol: 'HTTPS' }, dom);
      renderEndpoint(null, dom);
      expect(dom.hostInput.value).toBe('');
      expect(dom.portInput.value).toBe('');
      expect(dom.protocolSelect.selectedIndex).toBe(0);
    });
  });

  describe('renderBypass (Req 4.5, 4.6)', () => {
    it('shows the stored Bypass_List when one is stored (Req 4.5)', () => {
      const stored = ['example.com', '10.0.0.0/8', 'internal.lan'];
      renderBypass(stored, dom);
      expect(dom.bypassInput.value).toBe(buildBypassDisplay(stored));
      expect(dom.bypassInput.value.split('\n')).toEqual(stored);
    });

    it('shows the default localhost / 127.0.0.1 list for an empty list (Req 4.6)', () => {
      renderBypass([], dom);
      expect(dom.bypassInput.value.split('\n')).toEqual(['localhost', '127.0.0.1']);
    });

    it('shows the default list when none is stored (null/undefined) (Req 4.6)', () => {
      renderBypass(null, dom);
      expect(dom.bypassInput.value.split('\n')).toEqual([...DEFAULT_BYPASS_LIST]);
      renderBypass(undefined, dom);
      expect(dom.bypassInput.value.split('\n')).toEqual([...DEFAULT_BYPASS_LIST]);
    });
  });

  describe('renderPac', () => {
    it('fills the URL input from a stored URL source and shows the URL field', () => {
      renderPac({ kind: 'url', url: 'http://192.168.1.10/proxy.pac' }, dom);
      expect(dom.pacUrlInput.value).toBe('http://192.168.1.10/proxy.pac');
      expect(dom.pacUrlField.hidden).toBe(false);
      expect(dom.pacScriptField.hidden).toBe(true);
      const urlRadio = dom.pacSourceRadios.find((r) => r.value === 'url');
      expect(urlRadio?.checked).toBe(true);
    });

    it('fills the script textarea from a stored inline source and shows the script field', () => {
      const script = 'function FindProxyForURL(url, host) { return "DIRECT"; }';
      renderPac({ kind: 'inline', script }, dom);
      expect(dom.pacScriptInput.value).toBe(script);
      expect(dom.pacScriptField.hidden).toBe(false);
      expect(dom.pacUrlField.hidden).toBe(true);
      const inlineRadio = dom.pacSourceRadios.find((r) => r.value === 'inline');
      expect(inlineRadio?.checked).toBe(true);
    });

    it('defaults to an empty URL source when nothing is stored', () => {
      renderPac(null, dom);
      expect(dom.pacUrlInput.value).toBe('');
      expect(dom.pacScriptInput.value).toBe('');
      expect(dom.pacUrlField.hidden).toBe(false);
      expect(dom.pacScriptField.hidden).toBe(true);
    });
  });
});
