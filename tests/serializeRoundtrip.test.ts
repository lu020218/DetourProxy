import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
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

/**
 * Property test for the serialize / deserialize round-trip.
 *
 * The generators produce only *valid* PersistedState values (within the bounds
 * the spec defines), so that deserialization is expected to succeed and return
 * a value deeply equal to the original.
 */

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];
const VALID_MODES: readonly ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];

// --- Generators (constrained to the valid input space) ---

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

/** PAC source: null, a URL (1–2048 chars), or an inline script (1–500 chars). */
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

describe('serialize/deserialize round-trip (Property 9)', () => {
  // Feature: browser-proxy-extension, Property 9: 配置序列化往返
  it('deserialize(serialize(state)) returns ok:true with a value deeply equal to the original', () => {
    fc.assert(
      fc.property(persistedStateArb, (state) => {
        const result = deserializeConfiguration(serializeConfiguration(state));

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual(state);
        }
      }),
      { numRuns: 100 },
    );
  });
});
