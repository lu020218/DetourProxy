import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateEndpoint } from '../src/core/validation.js';
import type { EndpointInput, Protocol } from '../src/core/types.js';

/**
 * Property test for `validateEndpoint`.
 *
 * The generators intelligently cover the boundaries called out in the design's
 * Testing Strategy: host length 0/1/253/254, port 0/1/65535/65536/non-numeric,
 * and protocol values inside and outside the accepted enum.
 */

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];

const HOST_MIN = 1;
const HOST_MAX = 253;
const PORT_MIN = 1;
const PORT_MAX = 65535;

// --- Oracles: independent re-statements of the spec rules ---

function hostIsValid(host: string): boolean {
  return host.length >= HOST_MIN && host.length <= HOST_MAX;
}

/** Mirrors the accept condition for ports: integer in 1–65535. */
function portIsValid(port: string | number): boolean {
  let n: number;
  if (typeof port === 'number') {
    n = port;
  } else {
    const trimmed = port.trim();
    if (trimmed === '' || !/^\d+$/.test(trimmed)) {
      return false;
    }
    n = Number(trimmed);
  }
  return Number.isInteger(n) && n >= PORT_MIN && n <= PORT_MAX;
}

function protocolIsValid(protocol: string): boolean {
  return (VALID_PROTOCOLS as readonly string[]).includes(protocol);
}

// --- Generators ---

/** A host string whose length covers the 0/1/253/254 boundaries and random sizes. */
const hostArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(0, 1, 2, 252, 253, 254, 255, 300),
    fc.integer({ min: 0, max: 300 }),
  )
  .map((len) => 'a'.repeat(len));

/** A port value (string or number) covering numeric/non-numeric boundaries. */
const portArb: fc.Arbitrary<string | number> = fc.oneof(
  // Numeric values, including out-of-range and boundary integers.
  fc.constantFrom(-1, 0, 1, 80, 1080, 65535, 65536, 100000),
  fc.integer({ min: -10, max: 70000 }),
  // Fractional numbers (must be rejected as non-integers).
  fc.double({ min: 0, max: 70000, noNaN: true }),
  // Numeric and boundary strings.
  fc.constantFrom('0', '1', '65535', '65536', '80', '01080'),
  // Non-numeric / malformed strings.
  fc.constantFrom('', '   ', 'abc', '80.5', '0x10', '-1', '+80', '8 0'),
  // Arbitrary strings, plus whitespace-padded numeric strings.
  fc.string(),
  fc.integer({ min: 0, max: 70000 }).map((n) => `  ${n}  `),
);

/** A protocol value covering enum members and values outside the enum. */
const protocolArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom<string>(...VALID_PROTOCOLS),
  fc.constantFrom('socks5', 'socks4', 'http', 'https', 'SOCKS', 'FTP', '', 'SOCKS5 '),
  fc.string(),
);

const endpointInputArb: fc.Arbitrary<EndpointInput> = fc.record({
  host: hostArb,
  port: portArb,
  protocol: protocolArb,
});

describe('validateEndpoint (Property 1)', () => {
  // Feature: browser-proxy-extension, Property 1: 端点校验接受有效、拒绝无效
  it('accepts valid endpoints and rejects invalid ones with the offending field errors', () => {
    fc.assert(
      fc.property(endpointInputArb, (input) => {
        const hostOk = hostIsValid(input.host);
        const portOk = portIsValid(input.port);
        const protocolOk = protocolIsValid(input.protocol);
        const expectedOk = hostOk && portOk && protocolOk;

        const result = validateEndpoint(input);

        // ok:true iff all three fields satisfy their constraints.
        expect(result.ok).toBe(expectedOk);

        if (result.ok) {
          // Returned value reflects the (already valid) input.
          expect(result.value.host).toBe(input.host);
          expect(result.value.port).toBe(
            typeof input.port === 'number' ? input.port : Number(String(input.port).trim()),
          );
          expect(result.value.protocol).toBe(input.protocol);
        } else {
          // Each offending field must have a corresponding FieldError, and
          // valid fields must not produce one.
          const fields = result.errors.map((e) => e.field);
          expect(fields.includes('host')).toBe(!hostOk);
          expect(fields.includes('port')).toBe(!portOk);
          expect(fields.includes('protocol')).toBe(!protocolOk);
          // At least one error when not ok.
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
