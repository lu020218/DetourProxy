import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toChromeProxyConfig } from '../src/core/convert.js';
import type { ProxyConfiguration } from '../src/core/types.js';

describe('toChromeProxyConfig (PAC)', () => {
  // Feature: browser-proxy-extension, Property 7: PAC 转换映射
  it('maps a URL PAC source to mode "pac_script" with pacScript.url equal to the input (Req 2.4)', () => {
    const pacUrl = fc.string({ minLength: 1, maxLength: 2048 });
    // Bypass_List and endpoint are irrelevant for PAC conversion.
    const bypassList = fc.array(fc.string({ minLength: 1, maxLength: 255 }), {
      maxLength: 100,
    });

    fc.assert(
      fc.property(pacUrl, bypassList, (url, bypass) => {
        const config: ProxyConfiguration = {
          endpoint: null,
          bypassList: bypass,
          pac: { kind: 'url', url },
        };

        const result = toChromeProxyConfig('PAC', config);

        expect(result.mode).toBe('pac_script');
        expect(result.pacScript).toBeDefined();
        expect(result.pacScript?.url).toBe(url);
        // A URL source must NOT populate inline data.
        expect(result.pacScript?.data).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: browser-proxy-extension, Property 7b: 内联 PAC 转换映射 (Req 2.10)
  it('maps an inline PAC source to mode "pac_script" with pacScript.data equal to the script (Req 2.10)', () => {
    const pacScript = fc.string({ minLength: 1, maxLength: 1000 });
    const bypassList = fc.array(fc.string({ minLength: 1, maxLength: 255 }), {
      maxLength: 100,
    });

    fc.assert(
      fc.property(pacScript, bypassList, (script, bypass) => {
        const config: ProxyConfiguration = {
          endpoint: null,
          bypassList: bypass,
          pac: { kind: 'inline', script },
        };

        const result = toChromeProxyConfig('PAC', config);

        expect(result.mode).toBe('pac_script');
        expect(result.pacScript).toBeDefined();
        expect(result.pacScript?.data).toBe(script);
        // An inline source must NOT populate a URL.
        expect(result.pacScript?.url).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
