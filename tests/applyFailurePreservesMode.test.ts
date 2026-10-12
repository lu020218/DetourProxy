import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { applyProxyMode } from '../src/background/apply.js';
import type { ProxyConfiguration, ProxyMode, Protocol } from '../src/core/types.js';

/**
 * Property test for `applyProxyMode` failure handling (Property 12).
 *
 * When the Proxy_Service rejects an attempt to apply a Proxy_Configuration,
 * `applyProxyMode` must NOT update the effective mode: the returned
 * `effectiveMode` stays equal to `previousMode`. Because the caller only
 * persists `effectiveMode` when `ok` is true, this models preservation of the
 * previous mode in BOTH the Proxy_Service and the Storage_Service (Req 7.2).
 *
 * Rejection is simulated by mocking `chrome.proxy.settings.set` so it sets
 * `chrome.runtime.lastError` before invoking its callback, which drives the
 * failure path in `applyProxyMode`. Configurations are generated to be valid
 * (valid endpoint for Fixed_Servers, valid pacUrl for PAC) so the failure is
 * caused by the proxy rejection rather than prerequisite validation.
 */

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];
const ALL_MODES: readonly ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];

// --- chrome API mock ---

/**
 * Install a `globalThis.chrome` whose `proxy.settings.set` simulates rejection
 * by populating `chrome.runtime.lastError` before invoking the callback.
 */
function installRejectingChrome(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { lastError: undefined as { message?: string } | undefined },
    proxy: {
      settings: {
        set(
          _details: { value: unknown; scope: string },
          callback?: () => void,
        ): void {
          // Simulate the Proxy_Service rejecting the configuration.
          (globalThis as unknown as { chrome: { runtime: { lastError?: { message?: string } } } })
            .chrome.runtime.lastError = { message: 'Proxy_Service 拒绝应用配置' };
          callback?.();
        },
      },
    },
  };
}

function resetLastError(): void {
  const c = (globalThis as unknown as { chrome?: { runtime: { lastError?: unknown } } }).chrome;
  if (c) {
    c.runtime.lastError = undefined;
  }
}

beforeEach(() => {
  installRejectingChrome();
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

// --- Generators ---

const hostArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 253 })
  .map((len) => 'a'.repeat(len));

const portArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 65535 });

const protocolArb: fc.Arbitrary<Protocol> = fc.constantFrom(...VALID_PROTOCOLS);

/** A valid Proxy_Endpoint so Fixed_Servers passes its prerequisite check. */
const endpointArb = fc.record({
  host: hostArb,
  port: portArb,
  protocol: protocolArb,
});

/** A valid Bypass_List (including empty, which normalizes to the default). */
const bypassListArb: fc.Arbitrary<string[]> = fc.oneof(
  fc.constant<string[]>([]),
  fc.array(fc.string({ minLength: 1, maxLength: 255 }), { minLength: 1, maxLength: 100 }),
);

/** A valid PAC source (URL) so PAC passes its prerequisite check. */
const pacArb: fc.Arbitrary<{ kind: 'url'; url: string }> = fc
  .integer({ min: 1, max: 2048 })
  .map((len) => ({ kind: 'url' as const, url: 'p'.repeat(len) }));

/**
 * A config that is valid for every mode that reaches the proxy.set call:
 * Direct/System (no prerequisites), Fixed_Servers (valid endpoint) and PAC
 * (valid pac source).
 */
const configArb: fc.Arbitrary<ProxyConfiguration> = fc.record({
  endpoint: endpointArb,
  bypassList: bypassListArb,
  pac: pacArb,
});

const previousModeArb: fc.Arbitrary<ProxyMode> = fc.constantFrom(...ALL_MODES);
const targetModeArb: fc.Arbitrary<ProxyMode> = fc.constantFrom(...ALL_MODES);

describe('applyProxyMode (failure preserves mode, Property 12)', () => {
  // Feature: browser-proxy-extension, Property 12: 应用失败时保留先前模式
  it('returns ok:false with effectiveMode equal to previousMode when the Proxy_Service rejects', async () => {
    await fc.assert(
      fc.asyncProperty(
        previousModeArb,
        targetModeArb,
        configArb,
        async (previousMode, targetMode, config) => {
          resetLastError();

          const result = await applyProxyMode(targetMode, config, previousMode);

          // Application was rejected by the Proxy_Service.
          expect(result.ok).toBe(false);
          // The previously effective mode is preserved (Proxy_Service + Storage).
          expect(result.effectiveMode).toBe(previousMode);
        },
      ),
      { numRuns: 100 },
    );
  });
});
