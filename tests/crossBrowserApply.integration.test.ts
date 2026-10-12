import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyProxyMode } from '../src/background/apply.js';
import { toChromeProxyConfig } from '../src/core/convert.js';
import type { ProxyConfiguration } from '../src/core/types.js';

/**
 * Cross-browser apply integration test (Req 8.2, 8.3, 8.4).
 *
 * Chrome and Edge are both Chromium-based Manifest V3 browsers: they expose
 * the identical `chrome.proxy` API surface and the Extension uses the same
 * `applyProxyMode` write point and the same `toChromeProxyConfig` conversion
 * for both. There is no real browser in the test environment, so "Chrome" and
 * "Edge" are represented by two structurally identical mocked `globalThis.chrome`
 * environments. The only thing that differs between them is a label.
 *
 * For each environment we:
 *   - install a mocked `globalThis.chrome` whose `chrome.proxy.settings.set`
 *     captures the applied value, `chrome.runtime.lastError` is undefined, and
 *     `chrome.action.*` are no-ops;
 *   - apply a representative Fixed_Servers config via `applyProxyMode` and
 *     assert the captured proxy value reflects the effective mode (Req 8.2 for
 *     Chrome, Req 8.3 for Edge);
 *   - also exercise a Direct case to confirm the effective mode is honored.
 *
 * Finally we assert that `toChromeProxyConfig` produces a deep-equal config
 * object for the same input regardless of which browser environment is active,
 * since both browsers share the conversion (Req 8.4).
 */

// A representative Fixed_Servers configuration pointing at a v2raya SOCKS5
// endpoint with a custom bypass list.
const fixedConfig: ProxyConfiguration = {
  endpoint: { host: '192.168.1.100', port: 1080, protocol: 'SOCKS5' },
  bypassList: ['localhost', '127.0.0.1', '10.0.0.0/8'],
  pac: null,
};

interface MockChromeEnv {
  appliedValues: chrome.proxy.ProxyConfig[];
  install(): void;
}

/**
 * Build a mocked Chromium environment representing a browser (Chrome or Edge).
 * The API surface is identical for both browsers; the `label` only documents
 * which browser the environment stands in for.
 */
function createBrowserEnv(): MockChromeEnv {
  const appliedValues: chrome.proxy.ProxyConfig[] = [];

  return {
    appliedValues,
    install() {
      (globalThis as { chrome: unknown }).chrome = {
        runtime: {
          // No error → the proxy write is treated as successful.
          lastError: undefined,
        },
        proxy: {
          settings: {
            set: (
              details: { value: chrome.proxy.ProxyConfig; scope: string },
              callback: () => void,
            ) => {
              appliedValues.push(details.value);
              callback();
            },
          },
        },
        // Toolbar indicator APIs are no-ops in this environment.
        action: {
          setBadgeText: () => {},
          setBadgeBackgroundColor: () => {},
          setIcon: () => {},
          setTitle: () => {},
        },
      };
    },
  };
}

// Parameterize over the two representative Chromium environments. Req 8.2 maps
// to Chrome and Req 8.3 maps to Edge.
const browsers: ReadonlyArray<{ label: string; req: string }> = [
  { label: 'Chrome', req: 'Req 8.2' },
  { label: 'Edge', req: 'Req 8.3' },
];

describe('cross-browser apply integration (Req 8.2, 8.3)', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome: unknown }).chrome = originalChrome;
    }
  });

  describe.each(browsers)('$label environment ($req)', ({ label }) => {
    let env: MockChromeEnv;

    beforeEach(() => {
      env = createBrowserEnv();
      env.install();
    });

    it(`applies Fixed_Servers so the proxy forwards to the stored endpoint (${label})`, async () => {
      const result = await applyProxyMode('Fixed_Servers', fixedConfig, 'Direct');

      // The application succeeded and Fixed_Servers is now the effective mode.
      expect(result.ok).toBe(true);
      expect(result.effectiveMode).toBe('Fixed_Servers');

      // chrome.proxy.settings.set was called exactly once with a fixed_servers
      // configuration whose singleProxy matches the endpoint.
      expect(env.appliedValues).toHaveLength(1);
      const applied = env.appliedValues[0];
      expect(applied.mode).toBe('fixed_servers');
      expect(applied.rules?.singleProxy).toEqual({
        scheme: 'socks5',
        host: '192.168.1.100',
        port: 1080,
      });
      expect(applied.rules?.bypassList).toEqual([
        'localhost',
        '127.0.0.1',
        '10.0.0.0/8',
      ]);
    });

    it(`applies Direct so the proxy sends traffic without a proxy (${label})`, async () => {
      const result = await applyProxyMode('Direct', fixedConfig, 'Fixed_Servers');

      expect(result.ok).toBe(true);
      expect(result.effectiveMode).toBe('Direct');

      expect(env.appliedValues).toHaveLength(1);
      expect(env.appliedValues[0].mode).toBe('direct');
    });
  });

  it('produces identical proxy config for the same input across both browser environments (Req 8.4)', () => {
    // Chrome environment active.
    const chromeEnv = createBrowserEnv();
    chromeEnv.install();
    const chromeConfig = toChromeProxyConfig('Fixed_Servers', fixedConfig);

    // Edge environment active.
    const edgeEnv = createBrowserEnv();
    edgeEnv.install();
    const edgeConfig = toChromeProxyConfig('Fixed_Servers', fixedConfig);

    // Both browsers share the same conversion, so the resulting effective mode
    // and endpoint routing are deeply equal (Req 8.4).
    expect(chromeConfig).toEqual(edgeConfig);
    expect(chromeConfig.mode).toBe('fixed_servers');
    expect(chromeConfig.rules?.singleProxy).toEqual({
      scheme: 'socks5',
      host: '192.168.1.100',
      port: 1080,
    });
  });
});
