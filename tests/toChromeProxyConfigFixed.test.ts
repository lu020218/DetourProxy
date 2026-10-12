import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toChromeProxyConfig, normalizeBypassList } from '../src/core/convert.js';
import type { Protocol, ProxyConfiguration, ProxyEndpoint } from '../src/core/types.js';

/**
 * Property test for `toChromeProxyConfig` in Fixed_Servers mode.
 *
 * Generators cover valid Proxy_Endpoints (host 1–253 chars, port 1–65535,
 * protocol within the enum) and validated Bypass_Lists, including the empty
 * list which must normalize to the default `['localhost', '127.0.0.1']`.
 */

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];

/** Independent re-statement of the Protocol → scheme mapping from design.md. */
const EXPECTED_SCHEME: Readonly<Record<Protocol, string>> = {
  SOCKS5: 'socks5',
  SOCKS4: 'socks4',
  HTTP: 'http',
  HTTPS: 'https',
};

// --- Generators ---

/** A valid host: 1–253 characters, exercising the boundaries. */
const hostArb: fc.Arbitrary<string> = fc
  .oneof(fc.constantFrom(1, 2, 252, 253), fc.integer({ min: 1, max: 253 }))
  .map((len) => 'a'.repeat(len));

/** A valid port: integer in 1–65535, exercising the boundaries. */
const portArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(1, 80, 1080, 8080, 65535),
  fc.integer({ min: 1, max: 65535 }),
);

const protocolArb: fc.Arbitrary<Protocol> = fc.constantFrom(...VALID_PROTOCOLS);

const endpointArb: fc.Arbitrary<ProxyEndpoint> = fc.record({
  host: hostArb,
  port: portArb,
  protocol: protocolArb,
});

/** A valid entry for a Bypass_List: 1–255 chars. */
const bypassEntryArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 255 });

/** A validated Bypass_List, including the empty list (which normalizes to default). */
const bypassListArb: fc.Arbitrary<string[]> = fc.oneof(
  fc.constant<string[]>([]),
  fc.array(bypassEntryArb, { minLength: 1, maxLength: 100 }),
);

const configArb: fc.Arbitrary<ProxyConfiguration> = fc.record({
  endpoint: endpointArb,
  bypassList: bypassListArb,
  pac: fc.constant<null>(null),
});

describe('toChromeProxyConfig (Fixed_Servers, Property 6)', () => {
  // Feature: browser-proxy-extension, Property 6: Fixed_Servers 转换映射
  it('maps a valid endpoint and bypass list to a fixed_servers ProxyConfig', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const result = toChromeProxyConfig('Fixed_Servers', config);

        expect(result.mode).toBe('fixed_servers');
        expect(result.rules).toBeDefined();

        const singleProxy = result.rules!.singleProxy!;
        const endpoint = config.endpoint!;

        // scheme/host/port match the endpoint, protocol mapped to lowercase scheme.
        expect(singleProxy.scheme).toBe(EXPECTED_SCHEME[endpoint.protocol]);
        expect(singleProxy.host).toBe(endpoint.host);
        expect(singleProxy.port).toBe(endpoint.port);

        // bypassList equals the normalized Bypass_List (empty → default).
        expect(result.rules!.bypassList).toEqual(normalizeBypassList(config.bypassList));
      }),
      { numRuns: 100 },
    );
  });
});
