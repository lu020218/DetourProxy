import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  restoreOnStartup,
  isStoredConfigInvalid,
} from '../src/background/restore.js';

/**
 * Startup restoration with no stored configuration (Req 5.3).
 *
 * When the Browser starts and no Proxy_Configuration is stored, the Extension
 * configures the Proxy_Service for Direct Proxy_Mode. This is a deterministic
 * scenario, so it is covered by an example-based unit test rather than a
 * property test.
 *
 * The chrome.storage / chrome.proxy / chrome.runtime APIs are mocked on
 * globalThis.chrome so the Service Worker logic can run in a plain Node env.
 */
describe('restoreOnStartup with no stored configuration (Req 5.3)', () => {
  // Captures every value passed to chrome.proxy.settings.set so assertions can
  // inspect what the restore applied.
  let appliedValues: chrome.proxy.ProxyConfig[];
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  beforeEach(() => {
    appliedValues = [];

    (globalThis as { chrome: unknown }).chrome = {
      runtime: {
        // No error → the proxy write is treated as successful.
        lastError: undefined,
      },
      storage: {
        local: {
          // Nothing stored: return an empty object so readPersistedState() -> null.
          get: (_key: string, callback: (result: Record<string, unknown>) => void) => {
            callback({});
          },
        },
      },
      proxy: {
        settings: {
          // Capture the applied config and settle the callback.
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

  it('configures the Proxy_Service for Direct mode when nothing is stored (Req 5.3)', async () => {
    await restoreOnStartup();

    expect(appliedValues).toHaveLength(1);
    expect(appliedValues[0]).toEqual({ mode: 'direct' });
  });

  it('does not flag the stored configuration as invalid when nothing is stored (Req 5.3)', async () => {
    await restoreOnStartup();

    // No stored config is a clean restore, not an invalid-config condition (Req 5.4).
    expect(isStoredConfigInvalid()).toBe(false);
  });
});
