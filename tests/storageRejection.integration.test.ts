import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  persistConfiguration,
  readPersistedState,
  STORAGE_KEY,
} from '../src/background/storage.js';
import { serializeConfiguration } from '../src/core/serialize.js';
import type { PersistedState } from '../src/core/types.js';

/**
 * Integration test: Storage_Service rejects a persistence attempt (Req 5.5).
 *
 * When chrome.storage.local.set is rejected (signaled via
 * chrome.runtime.lastError), the Extension must preserve the previously stored
 * Proxy_Configuration unchanged and return a persistence-failure result
 * carrying a message describing the failure.
 *
 * This is an example-based integration test: it exercises persistConfiguration
 * against a mocked chrome.storage.local whose `set` simulates a rejected write
 * (it sets lastError and does NOT mutate the in-memory store), and verifies
 * both the returned failure and that the old config survives intact.
 */

// Previously stored configuration that must survive a rejected write.
const OLD_STATE: PersistedState = {
  schemaVersion: 1,
  configuration: {
    endpoint: { host: 'old.lan', port: 1080, protocol: 'SOCKS5' },
    bypassList: ['localhost', '127.0.0.1'],
    pac: null,
  },
  effectiveMode: 'Fixed_Servers',
  selectedMode: 'Fixed_Servers',
  enabled: true,
};

// A different configuration whose write attempt will be rejected.
const NEW_STATE: PersistedState = {
  schemaVersion: 1,
  configuration: {
    endpoint: { host: 'new.lan', port: 8080, protocol: 'HTTP' },
    bypassList: ['example.internal'],
    pac: null,
  },
  effectiveMode: 'PAC',
  selectedMode: 'PAC',
  enabled: false,
};

describe('storage rejects persistence (Req 5.5)', () => {
  let store: Record<string, unknown>;
  let lastError: { message: string } | undefined;
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  beforeEach(() => {
    // Seed the in-memory store with the previously persisted (old) config.
    store = { [STORAGE_KEY]: serializeConfiguration(OLD_STATE) };
    lastError = undefined;

    (globalThis as { chrome: unknown }).chrome = {
      runtime: {
        // Reading lastError reflects whatever the latest storage op set.
        get lastError() {
          return lastError;
        },
      },
      storage: {
        local: {
          // Simulate a rejected write: set lastError and DO NOT mutate the
          // store, then invoke the callback so the wrapper rejects.
          set: (_items: Record<string, unknown>, callback: () => void) => {
            lastError = { message: 'QUOTA_BYTES quota exceeded' };
            callback();
            // Clear after the synchronous callback so later get() is clean.
            lastError = undefined;
          },
          get: (key: string, callback: (result: Record<string, unknown>) => void) => {
            const result: Record<string, unknown> =
              key in store ? { [key]: store[key] } : {};
            callback(result);
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

  it('returns a persistence-failure result when the write is rejected (Req 5.5)', async () => {
    const result = await persistConfiguration(NEW_STATE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The message must describe the persistence failure.
      expect(result.message).toContain('持久化');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('preserves the previously stored configuration after a rejected write (Req 5.5)', async () => {
    await persistConfiguration(NEW_STATE);

    // The in-memory store must still hold the OLD config, unchanged.
    const raw = await readPersistedState();
    expect(raw).toBe(serializeConfiguration(OLD_STATE));

    // And it must NOT have been overwritten by the rejected NEW_STATE write.
    expect(raw).not.toBe(serializeConfiguration(NEW_STATE));
  });
});
