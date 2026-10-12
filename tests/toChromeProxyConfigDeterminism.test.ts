import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toChromeProxyConfig } from '../src/core/convert.js';
import type { ProxyConfiguration, ProxyMode, Protocol } from '../src/core/types.js';

describe('toChromeProxyConfig determinism', () => {
  // Feature: browser-proxy-extension, Property 15: 转换确定性（跨浏览器一致）
  it('produces deeply-equal results across repeated calls for any mode and configuration (Req 8.4)', () => {
    const protocol = fc.constantFrom<Protocol>('SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS');

    // A valid Proxy_Endpoint (host 1–253 chars, port 1–65535, valid protocol).
    const endpoint = fc.record({
      host: fc.string({ minLength: 1, maxLength: 253 }),
      port: fc.integer({ min: 1, max: 65535 }),
      protocol,
    });

    // A Bypass_List that satisfies the validation constraints.
    const bypassList = fc.array(fc.string({ minLength: 1, maxLength: 255 }), {
      minLength: 0,
      maxLength: 100,
    });

    // A valid PAC source: a URL (1–2048 chars) or an inline script (1–500 chars).
    const pac = fc.oneof(
      fc
        .string({ minLength: 1, maxLength: 2048 })
        .map((url) => ({ kind: 'url' as const, url })),
      fc
        .string({ minLength: 1, maxLength: 500 })
        .map((script) => ({ kind: 'inline' as const, script })),
    );

    // Build a (mode, config) pair where the config satisfies whatever the
    // chosen mode requires: Fixed_Servers needs a non-null endpoint and PAC
    // needs a non-null pac source, otherwise toChromeProxyConfig throws.
    const modeAndConfig: fc.Arbitrary<{ mode: ProxyMode; config: ProxyConfiguration }> =
      fc.oneof(
        fc
          .record({ bypassList, pac: fc.option(pac, { nil: null }) })
          .map(({ bypassList: bl, pac: pu }) => ({
            mode: 'Direct' as ProxyMode,
            config: { endpoint: null, bypassList: bl, pac: pu } as ProxyConfiguration,
          })),
        fc
          .record({ bypassList, pac: fc.option(pac, { nil: null }) })
          .map(({ bypassList: bl, pac: pu }) => ({
            mode: 'System' as ProxyMode,
            config: { endpoint: null, bypassList: bl, pac: pu } as ProxyConfiguration,
          })),
        fc
          .record({ endpoint, bypassList, pac: fc.option(pac, { nil: null }) })
          .map(({ endpoint: ep, bypassList: bl, pac: pu }) => ({
            mode: 'Fixed_Servers' as ProxyMode,
            config: { endpoint: ep, bypassList: bl, pac: pu } as ProxyConfiguration,
          })),
        fc
          .record({ endpoint: fc.option(endpoint, { nil: null }), bypassList, pac })
          .map(({ endpoint: ep, bypassList: bl, pac: pu }) => ({
            mode: 'PAC' as ProxyMode,
            config: { endpoint: ep, bypassList: bl, pac: pu } as ProxyConfiguration,
          })),
      );

    fc.assert(
      fc.property(modeAndConfig, ({ mode, config }) => {
        const first = toChromeProxyConfig(mode, config);
        const second = toChromeProxyConfig(mode, config);
        const third = toChromeProxyConfig(mode, config);

        // Multiple calls with the same input must produce deeply-equal results,
        // guaranteeing identical effective mode and endpoint routing across
        // Chrome and Edge (which share this conversion function).
        expect(second).toEqual(first);
        expect(third).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });
});
