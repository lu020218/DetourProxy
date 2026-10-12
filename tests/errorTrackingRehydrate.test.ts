import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression tests for the error-tracking rehydrate race (MV3).
 *
 * `hydrateErrorTracking()` is kicked off (async) when the Service Worker spins
 * up. If a message (e.g. SET_MODE switching away from Fixed_Servers) is
 * processed BEFORE that async read resolves, the message's `setCurrentMode`
 * clears the error — and the late-arriving snapshot must NOT clobber that
 * freshly-cleared state and resurrect a resolved "endpoint unreachable" error.
 *
 * Each test re-imports the module (vi.resetModules) so the module-level
 * `trackingInitialized` flag starts fresh, exercising both orderings.
 */

const STALE_SNAPSHOT = {
  mode: 'Fixed_Servers' as const,
  endpoint: { host: '192.168.0.13', port: 20170, protocol: 'SOCKS5' as const },
  errorActive: true,
  errorEndpoint: { host: '192.168.0.13', port: 20170 },
};

function installChromeMock(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    action: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
      setTitle: () => {},
    },
    runtime: { lastError: undefined },
    storage: {
      session: {
        // A stale snapshot persisted from a prior Fixed_Servers error session.
        get: async () => ({
          'browserProxyExtension.errorTracking': STALE_SNAPSHOT,
        }),
        set: async () => {},
      },
    },
  };
}

beforeEach(() => {
  installChromeMock();
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('error-tracking rehydrate race guard', () => {
  it('does NOT resurrect a stale error when a live update ran first', async () => {
    const { setCurrentMode, hydrateErrorTracking, getErrorState } = await import(
      '../src/background/errors.js'
    );

    // A SET_MODE message switching to PAC clears the error BEFORE the spin-up
    // rehydrate (started but not yet resolved) completes.
    setCurrentMode('PAC', null);

    // The late-arriving rehydrate must be a no-op for the live state.
    await hydrateErrorTracking();

    const state = getErrorState();
    expect(state.errorActive).toBe(false);
    expect(state.errorEndpoint).toBeNull();
  });

  it('still restores a persisted unresolved error on a clean spin-up', async () => {
    const { hydrateErrorTracking, getErrorState } = await import(
      '../src/background/errors.js'
    );

    // No live update yet: the snapshot is authoritative and should be restored
    // so a genuinely unresolved error survives the worker restart.
    await hydrateErrorTracking();

    const state = getErrorState();
    expect(state.errorActive).toBe(true);
    expect(state.errorEndpoint).toEqual({ host: '192.168.0.13', port: 20170 });
  });
});
