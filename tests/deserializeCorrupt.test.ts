import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deserializeConfiguration } from '../src/core/serialize.js';
import type {
  PersistedState,
  Protocol,
  ProxyMode,
} from '../src/core/types.js';

/**
 * Property test for `deserializeConfiguration` on corrupt input.
 *
 * Property 10 states that for ANY raw string that either cannot be parsed
 * (corrupt JSON) or that fails structural validation (valid JSON but the
 * wrong shape), `deserializeConfiguration` returns `ok:false`.
 *
 * The generators below produce strings that are invalid *by construction*,
 * split into two families:
 *   1. Corrupt JSON — strings that do not parse as JSON at all.
 *   2. Structurally invalid — well-formed JSON whose shape violates exactly
 *      one PersistedState constraint (non-object root, missing/typed-wrong
 *      field, invalid Proxy_Mode, out-of-range port, bad protocol, oversized
 *      bypass list, invalid PAC URL, etc.).
 *
 * Building every input so that it is guaranteed invalid lets the property
 * assert a single outcome (`ok === false`) without re-implementing the
 * validator as an oracle.
 */

const PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];
const MODES: readonly ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];

// --- A fully valid PersistedState, used as the base for single-field corruption ---

const validStateArb: fc.Arbitrary<PersistedState> = fc.record({
  schemaVersion: fc.integer({ min: 0, max: 10 }),
  configuration: fc.record({
    endpoint: fc.option(
      fc.record({
        host: fc.string({ minLength: 1, maxLength: 253 }),
        port: fc.integer({ min: 1, max: 65535 }),
        protocol: fc.constantFrom(...PROTOCOLS),
      }),
      { nil: null },
    ),
    bypassList: fc.array(fc.string({ minLength: 1, maxLength: 255 }), {
      maxLength: 100,
    }),
    pac: fc.option(
      fc.oneof(
        fc
          .string({ minLength: 1, maxLength: 2048 })
          .map((url) => ({ kind: 'url' as const, url })),
        fc
          .string({ minLength: 1, maxLength: 500 })
          .map((script) => ({ kind: 'inline' as const, script })),
      ),
      { nil: null },
    ),
  }),
  effectiveMode: fc.constantFrom(...MODES),
  selectedMode: fc.constantFrom('System', 'Fixed_Servers', 'PAC'),
  enabled: fc.boolean(),
});

// --- Family 1: corrupt JSON (does not parse) ---

/**
 * Strings that are not valid JSON. Random strings are filtered to those that
 * genuinely throw in JSON.parse, combined with hand-picked broken snippets.
 */
const corruptJsonArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    '',
    '   ',
    '{',
    '}',
    '[',
    '{"schemaVersion": 1,',
    '{"a": }',
    "{'a': 1}",
    'undefined',
    'NaN',
    '{"x": 01}',
    '{,}',
    'tru',
    '{"k" "v"}',
  ),
  fc.string().filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  }),
);

// --- Family 2: structurally invalid (parses, but wrong shape) ---

/** JSON whose root is not a plain object. */
const nonObjectRootArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.string(),
    fc.array(fc.integer(), { maxLength: 5 }),
  )
  .map((v) => JSON.stringify(v));

/**
 * A valid base state mutated so that exactly one field violates the
 * PersistedState contract. The mutated object is always invalid.
 */
const mutatedInvalidArb: fc.Arbitrary<string> = validStateArb.chain((base) =>
  fc
    .oneof(
      // schemaVersion: not a finite number.
      fc.constantFrom<unknown>('1', null, true).map((v) => ({
        ...base,
        schemaVersion: v,
      })),
      // schemaVersion removed entirely.
      fc.constant(omit(base, 'schemaVersion')),
      // enabled: not a boolean.
      fc.constantFrom<unknown>(0, 1, 'true', null).map((v) => ({
        ...base,
        enabled: v,
      })),
      // enabled removed entirely.
      fc.constant(omit(base, 'enabled')),
      // effectiveMode: not a valid ProxyMode.
      fc
        .constantFrom<unknown>('direct', 'FIXED', '', 'pac', 42, null)
        .map((v) => ({ ...base, effectiveMode: v })),
      // configuration: not a plain object.
      fc.constantFrom<unknown>(null, 'config', 5, []).map((v) => ({
        ...base,
        configuration: v,
      })),
      // endpoint present but not a plain object.
      fc.constantFrom<unknown>('host:port', 123, []).map((v) => ({
        ...base,
        configuration: { ...base.configuration, endpoint: v },
      })),
      // endpoint.host invalid (empty or 254 chars).
      fc.constantFrom('', 'h'.repeat(254)).map((host) => ({
        ...base,
        configuration: {
          ...base.configuration,
          endpoint: { host, port: 8080, protocol: 'HTTP' },
        },
      })),
      // endpoint.port out of range / non-integer / wrong type.
      fc.constantFrom<unknown>(0, 65536, -1, 80.5, '8080', null).map((port) => ({
        ...base,
        configuration: {
          ...base.configuration,
          endpoint: { host: 'example.com', port, protocol: 'HTTP' },
        },
      })),
      // endpoint.protocol not in the accepted enum.
      fc.constantFrom<unknown>('socks5', 'FTP', '', 5).map((protocol) => ({
        ...base,
        configuration: {
          ...base.configuration,
          endpoint: { host: 'example.com', port: 8080, protocol },
        },
      })),
      // bypassList: not an array.
      fc.constantFrom<unknown>('localhost', 5, {}).map((v) => ({
        ...base,
        configuration: { ...base.configuration, bypassList: v },
      })),
      // bypassList: too many entries (101).
      fc.constant({
        ...base,
        configuration: {
          ...base.configuration,
          bypassList: Array.from({ length: 101 }, () => 'a'),
        },
      }),
      // bypassList: contains an invalid entry (empty / 256 chars / non-string).
      fc.constantFrom<unknown>('', 'b'.repeat(256), 5, null).map((entry) => ({
        ...base,
        configuration: {
          ...base.configuration,
          bypassList: ['ok', entry],
        },
      })),
      // pac: present but invalid (bad shape / empty url / empty script / bad kind).
      fc
        .constantFrom<unknown>(
          5,
          'pac',
          { kind: 'url' },
          { kind: 'url', url: '' },
          { kind: 'url', url: 'p'.repeat(2049) },
          { kind: 'inline' },
          { kind: 'inline', script: '' },
          { kind: 'bogus', url: 'http://x' },
        )
        .map((v) => ({
          ...base,
          configuration: { ...base.configuration, pac: v },
        })),
    )
    .map((obj) => JSON.stringify(obj)),
);

/** Drop a key from a copy of an object. */
function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

/** Union of every invalid-input family. */
const invalidRawArb: fc.Arbitrary<string> = fc.oneof(
  corruptJsonArb,
  nonObjectRootArb,
  mutatedInvalidArb,
);

describe('deserializeConfiguration on corrupt input (Property 10)', () => {
  // Feature: browser-proxy-extension, Property 10: 损坏配置反序列化失败
  it('returns ok:false for any unparsable or structurally invalid string (Req 5.4)', () => {
    fc.assert(
      fc.property(invalidRawArb, (raw) => {
        const result = deserializeConfiguration(raw);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          // A rejection always carries at least one FieldError describing why.
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
