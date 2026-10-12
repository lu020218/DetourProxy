import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hasValidEndpoint } from '../src/core/validation.js';
import type { ProxyConfiguration, Protocol } from '../src/core/types.js';

/**
 * Property test for `hasValidEndpoint` (Property 5).
 *
 * `hasValidEndpoint` is the predicate that gates operations requiring a valid
 * Proxy_Endpoint: selecting Fixed_Servers Proxy_Mode (Req 2.5) and activating
 * the enable control (Req 3.1, 3.4). When the endpoint is invalid those
 * operations must be rejected and the previously effective Proxy_Mode left
 * unchanged. The semantics are captured by verifying that `hasValidEndpoint`
 * returns true *if and only if* the endpoint is non-null and satisfies the
 * host (1–253), port (integer 1–65535) and protocol (enum) constraints.
 *
 * Generators intelligently cover: null endpoints, fully valid endpoints, and
 * endpoints with invalid host length (0/254), invalid port (0/65536/non-integer)
 * and invalid protocol.
 */

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];

const HOST_MIN = 1;
const HOST_MAX = 253;
const PORT_MIN = 1;
const PORT_MAX = 65535;

// --- Oracle: an independent re-statement of the spec rule ---

function endpointIsValid(endpoint: unknown): boolean {
  if (endpoint === null || endpoint === undefined || typeof endpoint !== 'object') {
    return false;
  }
  const ep = endpoint as { host?: unknown; port?: unknown; protocol?: unknown };

  const host = typeof ep.host === 'string' ? ep.host : '';
  if (host.length < HOST_MIN || host.length > HOST_MAX) {
    return false;
  }

  const port = ep.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    return false;
  }

  if (typeof ep.protocol !== 'string' || !(VALID_PROTOCOLS as readonly string[]).includes(ep.protocol)) {
    return false;
  }

  return true;
}

// --- Generators ---

/** Host strings covering the 0/1/253/254 boundaries plus random sizes. */
const hostArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(0, 1, 2, 252, 253, 254, 300),
    fc.integer({ min: 0, max: 300 }),
  )
  .map((len) => 'a'.repeat(len));

/** Port values covering numeric/non-numeric and boundary cases. */
const portArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(-1, 0, 1, 80, 1080, 65535, 65536, 100000),
  fc.integer({ min: -10, max: 70000 }),
  // Fractional values (must be rejected as non-integers).
  fc.double({ min: 0, max: 70000, noNaN: true }),
);

/** Protocol values covering enum members and values outside the enum. */
const protocolArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom<string>(...VALID_PROTOCOLS),
  fc.constantFrom('socks5', 'http', 'SOCKS', 'FTP', '', 'SOCKS5 '),
  fc.string(),
);

/** An endpoint object built from the field generators (may be valid or not). */
const endpointArb = fc.record({
  host: hostArb,
  port: portArb,
  protocol: protocolArb,
});

/** A configuration whose endpoint is either null or a possibly-invalid object. */
const configArb: fc.Arbitrary<ProxyConfiguration> = fc.record({
  endpoint: fc.oneof(
    fc.constant(null),
    endpointArb as unknown as fc.Arbitrary<ProxyConfiguration['endpoint']>,
  ),
  bypassList: fc.constant<string[]>([]),
  pac: fc.constant<null>(null),
});

describe('hasValidEndpoint (Property 5)', () => {
  // Feature: browser-proxy-extension, Property 5: 需有效端点的操作在端点无效时被拒绝且保留模式
  it('returns true iff the endpoint is non-null and satisfies host/port/protocol constraints', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const expected = endpointIsValid(config.endpoint);

        expect(hasValidEndpoint(config)).toBe(expected);

        // A null endpoint is never valid: the gated operations are rejected.
        if (config.endpoint === null) {
          expect(hasValidEndpoint(config)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
