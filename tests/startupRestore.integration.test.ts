import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { restoreOnStartup } from '../src/background/restore.js';
import { STORAGE_KEY } from '../src/background/storage.js';
import { serializeConfiguration } from '../src/core/serialize.js';
import type { PersistedState } from '../src/core/types.js';

/**
 * Startup restoration integration test (Req 5.2).
 *
 * End-to-end exercise of the startup-restore flow through the real
 * Service Worker (restoreOnStartup), the real storage layer
 * (readPersistedState reads chrome.storage.local under STORAGE_KEY) and the
 * real Shared Core conversion (toChromeProxyConfig), with only the Chromium
 * runtime APIs mocked:
 *
 * - chrome.storage.local is an in-memory store seeded with a VALID serialized
 *   PersistedState (Fixed_Servers mode with an endpoint and a bypass list),
 *   written under the SAME key the storage layer reads (STORAGE_KEY).
 * - chrome.proxy.settings.set captures the applied value so we can assert the
 *   browser proxy was configured for the stored endpoint and bypass list.
 * - chrome.runtime.lastError is undefined so the proxy write is treated as
 *   successful.
 *
 * This verifies that when the Browser starts and a valid stored
 * Proxy_Configuration exists, the Extension applies the most recently
 * effective Proxy_Mode (Fixed_Servers) including the stored Proxy_Endpoint and
 * Bypass_List (Req 5.2).
 */
describe('startup restore integration: valid Fixed_Servers config (Req 5.2)', () => {
  // Captures every value passed to chrome.proxy.settings.set.
  let appliedValues: chrome.proxy.ProxyConfig[];
  // In-memory backing for chrome.storage.local.
  let store: Record<string, unknown>;
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  // A valid stored configuration: Fixed_Servers mode pointing at a SOCKS5
  // endpoint, with a custom bypass list (Req 5.2).
  const storedState: PersistedState = {
    schemaVersion: 1,
    configuration: {
      endpoint: { host: '192.168.1.50', port: 1080, protocol: 'SOCKS5' },
      bypassList: ['localhost', '127.0.0.1', '10.0.0.0/8'],
      pac: null,
    },
    effectiveMode: 'Fixed_Servers',
    selectedMode: 'Fixed_Servers',
    enabled: true,
  };

  beforeEach(() => {
    appliedValues = [];
    // Seed the store with the serialized state under the SAME key the storage
    // layer reads from, exercising the real serialize → store → read →
    // deserialize path.
    store = { [STORAGE_KEY]: serializeConfiguration(storedState) };

    (globalThis as { chrome: unknown }).chrome = {
      runtime: {
        // No error → the proxy write is treated as successful.
        lastError: undefined,
      },
      storage: {
        local: {
          get: (key: string, callback: (result: Record<string, unknown>) => void) => {
            const result: Record<string, unknown> =
              key in store ? { [key]: store[key] } : {};
            callback(result);
          },
        },
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
    };
  });

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome: unknown }).chrome = originalChrome;
    }
  });

  it('applies chrome.proxy.settings.set exactly once with the stored configuration (Req 5.2)', async () => {
    await restoreOnStartup();

    expect(appliedValues).toHaveLength(1);
  });

  it('configures Fixed_Servers mode with the stored endpoint and bypass list (Req 5.2)', async () => {
    await restoreOnStartup();

    const applied = appliedValues[0];
    expect(applied.mode).toBe('fixed_servers');

    // singleProxy reflects the stored endpoint: SOCKS5 → 'socks5' scheme.
    const singleProxy = applied.rules?.singleProxy;
    expect(singleProxy).toEqual({
      scheme: 'socks5',
      host: '192.168.1.50',
      port: 1080,
    });

    // The stored Bypass_List is applied unchanged.
    expect(applied.rules?.bypassList).toEqual([
      'localhost',
      '127.0.0.1',
      '10.0.0.0/8',
    ]);
  });
});
