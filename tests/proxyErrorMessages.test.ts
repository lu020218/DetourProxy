import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleProxyError,
  setCurrentMode,
  getErrorState,
} from '../src/background/errors.js';
import { applyProxyMode } from '../src/background/apply.js';
import type { ProxyConfiguration, ProxyEndpoint } from '../src/core/types.js';

/**
 * Unit / example tests for the proxy error-reporting messages (Task 6.9).
 *
 * - Req 7.1: after `chrome.proxy.onProxyError` fires while Fixed_Servers is the
 *   effective mode, the Extension records the current endpoint as unreachable.
 *   This is the data the popup renders as the "端点不可达" message, so we assert
 *   on the host/port captured in the error state.
 * - Req 7.3: when `chrome.proxy.settings.set` is rejected, `applyProxyMode`
 *   reports that the configuration was NOT applied and names the Proxy_Mode
 *   that remains in effect.
 */

// A minimal `chrome` mock for the Node test environment. `chrome.action.*` are
// no-ops (the toolbar indicator side effects are exercised elsewhere);
// `chrome.proxy.settings.set` and `chrome.runtime.lastError` are configured per
// test to simulate success or rejection.
function installChromeMock(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    action: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
      setTitle: () => {},
    },
    runtime: { lastError: undefined },
    proxy: {
      settings: {
        // Default: succeed (no lastError) by invoking the callback immediately.
        set: (_details: unknown, callback: () => void) => {
          callback();
        },
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
  };
}

beforeEach(() => {
  installChromeMock();
  // Reset the error module's tracked state between tests. Switching to Direct
  // clears any unresolved error and the tracked endpoint.
  setCurrentMode('Direct', null);
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('proxy error message content', () => {
  describe('Req 7.1: onProxyError surfaces the unreachable endpoint', () => {
    const endpoint: ProxyEndpoint = {
      host: 'proxy.lan',
      port: 1080,
      protocol: 'SOCKS5',
    };

    it('captures the Fixed_Servers endpoint host and port as unreachable', () => {
      setCurrentMode('Fixed_Servers', endpoint);

      handleProxyError({
        error: 'net::ERR_PROXY_CONNECTION_FAILED',
        details: '',
        fatal: true,
      } as chrome.proxy.ErrorDetails);

      const state = getErrorState();
      expect(state.errorActive).toBe(true);
      expect(state.errorEndpoint).not.toBeNull();
      expect(state.errorEndpoint?.host).toBe(endpoint.host);
      expect(state.errorEndpoint?.port).toBe(endpoint.port);
    });

    it('ignores proxy errors when Fixed_Servers is not the effective mode', () => {
      setCurrentMode('Direct', null);

      handleProxyError({
        error: 'net::ERR_PROXY_CONNECTION_FAILED',
        details: '',
        fatal: true,
      } as chrome.proxy.ErrorDetails);

      const state = getErrorState();
      expect(state.errorActive).toBe(false);
      expect(state.errorEndpoint).toBeNull();
    });
  });

  describe('Req 7.3: rejected proxy.set reports config not applied', () => {
    const config: ProxyConfiguration = {
      endpoint: { host: 'proxy.lan', port: 1080, protocol: 'SOCKS5' },
      bypassList: ['localhost', '127.0.0.1'],
      pac: null,
    };

    function makeProxySetReject(): void {
      (globalThis as unknown as { chrome: typeof chrome }).chrome.proxy.settings.set =
        ((_details: unknown, callback: () => void) => {
          // chrome reports rejection via runtime.lastError, read inside the cb.
          (globalThis as unknown as { chrome: typeof chrome }).chrome.runtime.lastError = {
            message: 'proxy settings rejected',
          } as chrome.runtime.LastError;
          callback();
          (globalThis as unknown as { chrome: typeof chrome }).chrome.runtime.lastError =
            undefined;
        }) as typeof chrome.proxy.settings.set;
    }

    it('returns failure preserving the previous mode and naming it in the message', async () => {
      makeProxySetReject();

      const previousMode = 'Direct';
      const result = await applyProxyMode('Fixed_Servers', config, previousMode);

      expect(result.ok).toBe(false);
      // The mode that remains in effect is the previous one (Req 7.2 / 7.3).
      expect(result.effectiveMode).toBe(previousMode);

      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        const message = result.errors[0].message;
        // The message identifies the configuration as NOT applied...
        expect(message).toContain('未被应用');
        // ...and names the Proxy_Mode that remains in effect.
        expect(message).toContain(previousMode);
      }
    });

    it('names whichever previous mode remains in effect after rejection', async () => {
      makeProxySetReject();

      const previousMode = 'System';
      const result = await applyProxyMode('Fixed_Servers', config, previousMode);

      expect(result.ok).toBe(false);
      expect(result.effectiveMode).toBe(previousMode);
      if (!result.ok) {
        expect(result.errors[0].message).toContain('System');
      }
    });
  });
});
