import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildProxyStatus } from '../src/core/status.js';
import type {
  PacSource,
  Protocol,
  ProxyMode,
  ProxyEndpoint,
  ProxyConfiguration,
} from '../src/core/types.js';

const PROTOCOLS: Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];
const MODES: ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];

// Generates a valid Proxy_Endpoint or null (endpoint may be unconfigured).
const endpointArb: fc.Arbitrary<ProxyEndpoint | null> = fc.option(
  fc.record({
    host: fc.string({ minLength: 1, maxLength: 253 }),
    port: fc.integer({ min: 1, max: 65535 }),
    protocol: fc.constantFrom(...PROTOCOLS),
  }),
  { nil: null },
);

// Generates a PAC source (url/inline) within bounds, or null.
const pacArb: fc.Arbitrary<PacSource | null> = fc.option(
  fc.oneof(
    fc
      .string({ minLength: 1, maxLength: 2048 })
      .map((url): PacSource => ({ kind: 'url', url })),
    fc
      .string({ minLength: 1, maxLength: 500 })
      .map((script): PacSource => ({ kind: 'inline', script })),
  ),
  { nil: null },
);

const bypassListArb: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 255 }),
  { maxLength: 100 },
);

const configArb: fc.Arbitrary<ProxyConfiguration> = fc.record({
  endpoint: endpointArb,
  bypassList: bypassListArb,
  pac: pacArb,
});

const errorEndpointArb: fc.Arbitrary<{ host: string; port: number } | null> =
  fc.option(
    fc.record({
      host: fc.string({ minLength: 1, maxLength: 253 }),
      port: fc.integer({ min: 1, max: 65535 }),
    }),
    { nil: null },
  );

describe('buildProxyStatus (Property 13)', () => {
  // Feature: browser-proxy-extension, Property 13: 状态构建反映当前模式与端点
  it('reflects the effective mode and exposes endpoint/pacUrl only for the matching mode (Req 6.2, 6.3)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODES),
        configArb,
        fc.boolean(),
        errorEndpointArb,
        (mode, config, errorActive, errorEndpoint) => {
          const status = buildProxyStatus(mode, config, errorActive, errorEndpoint);

          // effectiveMode always equals the supplied mode.
          expect(status.effectiveMode).toBe(mode);

          if (mode === 'Fixed_Servers') {
            // Fixed_Servers exposes the configured endpoint.
            expect(status.endpoint).toBe(config.endpoint);
          } else {
            // Endpoint is null in every other mode.
            expect(status.endpoint).toBeNull();
          }

          if (mode === 'PAC') {
            // PAC exposes the configured PAC source.
            expect(status.pac).toBe(config.pac);
          } else {
            // PAC source is null in every other mode.
            expect(status.pac).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
