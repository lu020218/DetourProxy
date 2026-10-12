import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/**
 * Property test for the DISABLE flow (Property 11).
 *
 * The Service Worker (src/background/index.ts) registers chrome listeners at
 * import time and the DISABLE handler touches chrome.storage, chrome.proxy and
 * chrome.action. Since `chrome` is absent in the Node test environment, a
 * minimal in-memory mock is installed on `globalThis` BEFORE the module under
 * test is imported (via `vi.hoisted`, which runs before hoisted imports).
 *
 * The mock backs `chrome.storage.local` with a mutable `storageRef.data`
 * object so each property run can seed an arbitrary serialized PersistedState,
 * invoke DISABLE, and read the stored state back to assert the configuration
 * was preserved and only the running mode became Direct.
 */
const { storageRef } = vi.hoisted(() => {
  const storageRef: { data: Record<string, string> } = { data: {} };

  const chromeMock = {
    runtime: {
      lastError: undefined as { message?: string } | undefined,
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    proxy: {
      // Succeed immediately: invoke the callback with no lastError set.
      settings: {
        set: (_details: unknown, cb?: () => void) => {
          cb?.();
        },
      },
      onProxyError: { addListener: () => {} },
    },
    storage: {
      local: {
        get: (key: string, cb: (result: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          if (typeof key === 'string' && key in storageRef.data) {
            result[key] = storageRef.data[key];
          }
          cb(result);
        },
        set: (items: Record<string, string>, cb?: () => void) => {
          Object.assign(storageRef.data, items);
          cb?.();
        },
      },
    },
    action: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
      setTitle: () => {},
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
  return { storageRef };
});

import { handleMessage, type Request, type Response } from '../src/background/index.js';
import { STORAGE_KEY } from '../src/background/storage.js';
import {
  serializeConfiguration,
  deserializeConfiguration,
} from '../src/core/serialize.js';
import type {
  PacSource,
  PersistedState,
  Protocol,
  ProxyEndpoint,
  ProxyMode,
} from '../src/core/types.js';

// --- Generators (constrained to the valid input space) ---

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];
const VALID_MODES: readonly ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];

/** Host: 1–253 characters. */
const hostArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 253 })
  .map((len) => 'h'.repeat(len));

/** Port: integer in 1–65535. */
const portArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 65535 });

const protocolArb: fc.Arbitrary<Protocol> = fc.constantFrom(...VALID_PROTOCOLS);

const endpointArb: fc.Arbitrary<ProxyEndpoint> = fc.record({
  host: hostArb,
  port: portArb,
  protocol: protocolArb,
});

/** Bypass entries: each 1–255 characters; list 0–100 entries. */
const bypassEntryArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 255 })
  .map((len) => 'b'.repeat(len));

const bypassListArb: fc.Arbitrary<string[]> = fc.array(bypassEntryArb, {
  minLength: 0,
  maxLength: 100,
});

/** PAC URL: null or 1–2048 characters. */
const pacArb: fc.Arbitrary<PacSource | null> = fc.oneof(
  fc.constant<PacSource | null>(null),
  fc
    .integer({ min: 1, max: 2048 })
    .map((len): PacSource => ({ kind: 'url', url: 'p'.repeat(len) })),
  fc
    .integer({ min: 1, max: 500 })
    .map((len): PacSource => ({ kind: 'inline', script: 's'.repeat(len) })),
);

const modeArb: fc.Arbitrary<ProxyMode> = fc.constantFrom(...VALID_MODES);

const persistedStateArb: fc.Arbitrary<PersistedState> = fc.record({
  schemaVersion: fc.integer({ min: 0, max: 1_000_000 }),
  configuration: fc.record({
    endpoint: fc.oneof(fc.constant(null), endpointArb),
    bypassList: bypassListArb,
    pac: pacArb,
  }),
  effectiveMode: modeArb,
  selectedMode: fc.constantFrom('System', 'Fixed_Servers', 'PAC'),
  enabled: fc.boolean(),
});

/** Invoke the DISABLE message flow and resolve with the Service Worker reply. */
function sendDisable(): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const request: Request = { type: 'DISABLE' };
    handleMessage(request, {} as chrome.runtime.MessageSender, resolve);
  });
}

describe('DISABLE preserves stored configuration (Property 11)', () => {
  beforeEach(() => {
    storageRef.data = {};
    (globalThis as unknown as { chrome: { runtime: { lastError?: unknown } } }).chrome.runtime.lastError =
      undefined;
  });

  // Feature: browser-proxy-extension, Property 11: 禁用不改变已存储配置
  it('leaves configuration unchanged and sets effectiveMode to Direct', async () => {
    await fc.assert(
      fc.asyncProperty(persistedStateArb, async (state) => {
        // Seed the mocked Storage_Service with the serialized state.
        storageRef.data = { [STORAGE_KEY]: serializeConfiguration(state) };

        const response = await sendDisable();

        // DISABLE applies Direct, which never fails validation.
        expect(response.ok).toBe(true);

        // Read the stored state back from the Storage_Service.
        const raw = storageRef.data[STORAGE_KEY];
        expect(typeof raw).toBe('string');
        const result = deserializeConfiguration(raw);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }

        const stored = result.value;

        // The Proxy_Configuration is preserved exactly (Req 3.3).
        expect(stored.configuration).toEqual(state.configuration);

        // Only the running mode becomes Direct.
        expect(stored.effectiveMode).toBe('Direct');
      }),
      { numRuns: 100 },
    );
  });
});
