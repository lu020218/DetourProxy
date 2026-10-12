import { describe, it, expect } from 'vitest';
import { toChromeProxyConfig } from '../src/core/convert.js';
import type { ProxyConfiguration } from '../src/core/types.js';

describe('toChromeProxyConfig Direct/System mapping', () => {
  // Direct/System are deterministic mode mappings independent of the rest of
  // the configuration, so they are covered by example-based unit tests.
  const baseConfig: ProxyConfiguration = {
    endpoint: null,
    bypassList: [],
    pac: null,
  };

  it('maps Direct mode to chrome.proxy mode "direct" (Req 2.2)', () => {
    expect(toChromeProxyConfig('Direct', baseConfig)).toEqual({ mode: 'direct' });
  });

  it('maps System mode to chrome.proxy mode "system" (Req 2.3)', () => {
    expect(toChromeProxyConfig('System', baseConfig)).toEqual({ mode: 'system' });
  });

  it('ignores endpoint/bypassList/pac when mapping Direct (Req 2.2)', () => {
    const populatedConfig: ProxyConfiguration = {
      endpoint: { host: 'proxy.lan', port: 1080, protocol: 'SOCKS5' },
      bypassList: ['localhost', '127.0.0.1'],
      pac: { kind: 'url', url: 'https://example.com/proxy.pac' },
    };
    expect(toChromeProxyConfig('Direct', populatedConfig)).toEqual({ mode: 'direct' });
  });

  it('ignores endpoint/bypassList/pac when mapping System (Req 2.3)', () => {
    const populatedConfig: ProxyConfiguration = {
      endpoint: { host: 'proxy.lan', port: 8080, protocol: 'HTTP' },
      bypassList: ['localhost', '127.0.0.1'],
      pac: { kind: 'url', url: 'https://example.com/proxy.pac' },
    };
    expect(toChromeProxyConfig('System', populatedConfig)).toEqual({ mode: 'system' });
  });

  it('maps Direct deterministically across repeated calls (Req 2.2)', () => {
    const first = toChromeProxyConfig('Direct', baseConfig);
    const second = toChromeProxyConfig('Direct', baseConfig);
    expect(second).toEqual(first);
  });

  it('maps System deterministically across repeated calls (Req 2.3)', () => {
    const first = toChromeProxyConfig('System', baseConfig);
    const second = toChromeProxyConfig('System', baseConfig);
    expect(second).toEqual(first);
  });
});
