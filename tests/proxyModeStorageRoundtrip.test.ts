import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  persistConfiguration,
  readPersistedState,
} from '../src/background/storage.js';
import { deserializeConfiguration } from '../src/core/serialize.js';
import type {
  PacSource,
  PersistedState,
  Protocol,
  ProxyEndpoint,
  ProxyMode,
} from '../src/core/types.js';

/**
 * Property test for Proxy_Mode storage round-trip (Property 8, Req 2.8).
 *
 * With chrome.storage.local mocked by an in-memory store, persisting a
 * PersistedState whose effectiveMode is an arbitrary accepted Proxy_Mode and
 * reading it back must yield the same effectiveMode.
 */

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];
const VALID_MODES: readonly ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];

// --- In-memory chrome.storage.local mock ---

let store: Record<string, unknown> = {};

function installChromeMock(): void {
  globalThis.chrome = {
    runtime: { lastError: undefined },
    storage: {
      local: {
        set(items: Record<string, unknown>, callback: () => void): void {
          Object.assign(store, items);
          callback();
        },
        get(key: string, callback: (result: Record<string, unknown>) => void): void {
          const result: Record<string, unknown> =
            key in store ? { [key]: store[key] } : {};
          callback(result);
        },
      },
    },
  } as unknown as typeof chrome;
}

// --- Generators (constrained to the valid input space) ---

const hostArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 253 })
  .map((len) => 'h'.repeat(len));

const portArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 65535 });

const protocolArb: fc.Arbitrary<Protocol> = fc.constantFrom(...VALID_PROTOCOLS);

const endpointArb: fc.Arbitrary<ProxyEndpoint> = fc.record({
  host: hostArb,
  port: portArb,
  protocol: protocolArb,
});

const bypassEntryArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 255 })
  .map((len) => 'b'.repeat(len));

const bypassListArb: fc.Arbitrary<string[]> = fc.array(bypassEntryArb, {
  minLength: 0,
  maxLength: 100,
});

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

describe('Proxy_Mode storage round-trip (Property 8)', () => {
  beforeEach(() => {
    installChromeMock();
  });

  // Feature: browser-proxy-extension, Property 8: Proxy_Mode 存储往返
  it('persisting an accepted effectiveMode then reading it back yields the same mode', async () => {
    await fc.assert(
      fc.asyncProperty(persistedStateArb, async (state) => {
        // Reset the in-memory store between runs.
        store = {};

        const persistResult = await persistConfiguration(state);
        expect(persistResult.ok).toBe(true);

        const raw = await readPersistedState();
        expect(raw).not.toBeNull();

        const deserialized = deserializeConfiguration(raw as string);
        expect(deserialized.ok).toBe(true);
        if (deserialized.ok) {
          expect(deserialized.value.effectiveMode).toBe(state.effectiveMode);
        }
      }),
      { numRuns: 100 },
    );
  });
});
