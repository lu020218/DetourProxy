/**
 * Proxy error handling and toolbar indicator updates for the Service Worker.
 *
 * This module owns two responsibilities described in design.md:
 *
 *  - `handleProxyError` listens for `chrome.proxy.onProxyError`. While the
 *    current effective mode is Fixed_Servers it records an unresolved error
 *    (errorActive = true) together with the endpoint reported as unreachable,
 *    then drives the toolbar indicator into its error state (Req 7.1, 7.4).
 *    The error state is cleared whenever a new valid configuration is applied
 *    successfully or the mode is switched (see `setCurrentMode` /
 *    `clearProxyError`).
 *
 *  - `updateToolbarIndicator` maps a Proxy_Status to a toolbar indicator via
 *    the pure `indicatorFor` helper and applies it through the
 *    `chrome.action.setBadge*` / `setTitle` APIs (Req 6.5, 7.4).
 *
 * The Shared Core (`indicatorFor`) remains the single source of truth for
 * what each visual state looks like; this module only tracks runtime state
 * and performs the browser-API side effects.
 *
 * MV3 lifecycle
 * -------------
 * The Service Worker is ephemeral: Chromium terminates it after a short idle
 * period and respawns it on the next event, which resets every module-level
 * variable in this file. To keep proxy-error reporting correct across those
 * restarts, the tracked mode/endpoint and the unresolved-error state are
 * mirrored into `chrome.storage.session` on every change and rehydrated via
 * {@link hydrateErrorTracking} when the worker spins back up. `session` storage
 * survives worker restarts within a browser session and is cleared on browser
 * restart — at which point `onStartup` → restore repopulates it.
 *
 * Requirements: 6.5, 7.1, 7.4
 */
import { indicatorFor } from '../core/indicator.js';
import type { ProxyEndpoint, ProxyMode, ProxyStatus } from '../core/types.js';

/**
 * The unresolved proxy-error state tracked by the Service Worker.
 */
export interface ErrorState {
  /** Whether an unresolved proxy error currently exists (Req 7.4). */
  errorActive: boolean;
  /** The endpoint reported as unreachable, if known (Req 7.1). */
  errorEndpoint: { host: string; port: number } | null;
}

/**
 * The current effective Proxy_Mode, tracked so `handleProxyError` can decide
 * whether a proxy error is relevant (errors are only surfaced while
 * Fixed_Servers is active — Req 7.1).
 */
let currentMode: ProxyMode = 'Direct';

/**
 * The current effective Proxy_Endpoint (only meaningful in Fixed_Servers
 * mode). Recorded as the unreachable endpoint when an error occurs.
 */
let currentEndpoint: ProxyEndpoint | null = null;

/**
 * Module-level holder for the unresolved-error state. Other modules read it
 * via `getErrorState` and clear it via `clearProxyError`.
 */
const errorState: ErrorState = {
  errorActive: false,
  errorEndpoint: null,
};

/**
 * Whether the tracked state has been authoritatively set in this Service Worker
 * lifetime — either by a live update (`setCurrentMode` / `handleProxyError` /
 * `clearProxyError`) or by a completed rehydrate. Once true, a late-arriving
 * {@link hydrateErrorTracking} must NOT overwrite the live state with a stale
 * session snapshot. This guards the race where a SET_MODE/ENABLE message is
 * processed (clearing the error and switching mode) before the rehydrate kicked
 * off at spin-up resolves — without it, the stale snapshot would clobber the
 * freshly-cleared state and resurrect a resolved "endpoint unreachable" error.
 */
let trackingInitialized = false;

/**
 * `chrome.storage.session` key under which the runtime tracking snapshot
 * (current mode/endpoint + unresolved-error state) is mirrored so it survives
 * Service Worker restarts within a browser session.
 */
const SESSION_KEY = 'browserProxyExtension.errorTracking';

/** Shape of the snapshot mirrored into `chrome.storage.session`. */
interface TrackingSnapshot {
  mode: ProxyMode;
  endpoint: ProxyEndpoint | null;
  errorActive: boolean;
  errorEndpoint: { host: string; port: number } | null;
}

/**
 * Mirror the current tracking snapshot into `chrome.storage.session`.
 *
 * Fire-and-forget and fully defensive: when `chrome.storage.session` is
 * unavailable (e.g. the Node test environment, or an older runtime) it simply
 * no-ops, so the in-memory fast path keeps working unchanged.
 */
function persistSnapshot(): void {
  const session = chrome.storage?.session;
  if (!session) {
    return;
  }
  const snapshot: TrackingSnapshot = {
    mode: currentMode,
    endpoint: currentEndpoint,
    errorActive: errorState.errorActive,
    errorEndpoint: errorState.errorEndpoint,
  };
  try {
    void session.set({ [SESSION_KEY]: snapshot });
  } catch {
    // Ignore: persistence of the snapshot is best-effort.
  }
}

/**
 * Rehydrate the tracked mode/endpoint and unresolved-error state from
 * `chrome.storage.session` after a Service Worker restart. Safe to call when
 * the snapshot is absent or `chrome.storage.session` is unavailable — it leaves
 * the in-memory defaults untouched. Refreshes the toolbar indicator so the
 * badge reflects the restored state.
 */
export async function hydrateErrorTracking(): Promise<void> {
  const session = chrome.storage?.session;
  if (!session) {
    trackingInitialized = true;
    return;
  }

  let snapshot: TrackingSnapshot | undefined;
  try {
    const result = await session.get(SESSION_KEY);
    const value = result?.[SESSION_KEY];
    if (value && typeof value === 'object') {
      snapshot = value as TrackingSnapshot;
    }
  } catch {
    trackingInitialized = true;
    return;
  }

  // If a live update (e.g. a SET_MODE message) already set the tracked state
  // while this async read was in flight, do NOT overwrite it with the snapshot —
  // that authoritative update reflects the current reality; the snapshot is now
  // stale. Only apply the snapshot when nothing has claimed the state yet.
  if (!trackingInitialized && snapshot) {
    currentMode = snapshot.mode ?? 'Direct';
    currentEndpoint = snapshot.endpoint ?? null;
    errorState.errorActive = snapshot.errorActive ?? false;
    errorState.errorEndpoint = snapshot.errorEndpoint ?? null;
    refreshIndicator();
  }
  trackingInitialized = true;
}

/**
 * Track the current effective Proxy_Mode (and, for Fixed_Servers, its
 * endpoint). Call this after a configuration is applied successfully or the
 * mode is switched. Doing so also clears any unresolved proxy error, because
 * a successful apply / mode switch resolves the previous error condition
 * (Req 7.4), and refreshes the toolbar indicator to reflect the new state.
 *
 * @param mode     The new current effective Proxy_Mode.
 * @param endpoint The effective endpoint (used only for Fixed_Servers mode).
 */
export function setCurrentMode(
  mode: ProxyMode,
  endpoint: ProxyEndpoint | null = null
): void {
  trackingInitialized = true;
  currentMode = mode;
  currentEndpoint = endpoint;
  // Applying a new valid config / switching mode clears the error state.
  errorState.errorActive = false;
  errorState.errorEndpoint = null;
  persistSnapshot();
  refreshIndicator();
}

/**
 * Handle a `chrome.proxy.onProxyError` event.
 *
 * Proxy errors are only surfaced while Fixed_Servers mode is active: in that
 * case the error is recorded (errorActive = true, errorEndpoint = current
 * endpoint) and the toolbar indicator is driven into its error state
 * (Req 7.1, 7.4). In any other mode the event is ignored.
 *
 * Note: the installed `@types/chrome` exposes the event payload as
 * `chrome.proxy.ErrorDetails`. The payload does not carry the offending
 * endpoint, so the currently-tracked effective endpoint is recorded instead.
 *
 * @param _details Error details from the proxy stack (currently unused — the
 *                 unreachable endpoint is taken from the tracked state).
 */
export function handleProxyError(_details: chrome.proxy.ErrorDetails): void {
  if (currentMode !== 'Fixed_Servers') {
    return;
  }

  trackingInitialized = true;
  errorState.errorActive = true;
  errorState.errorEndpoint = currentEndpoint
    ? { host: currentEndpoint.host, port: currentEndpoint.port }
    : null;

  persistSnapshot();
  refreshIndicator();
}

/**
 * Clear any unresolved proxy error and refresh the toolbar indicator back to
 * the normal indicator for the current mode. Intended to be called when a new
 * valid configuration is applied successfully or the mode is switched
 * (Req 7.4).
 */
export function clearProxyError(): void {
  trackingInitialized = true;
  errorState.errorActive = false;
  errorState.errorEndpoint = null;
  persistSnapshot();
  refreshIndicator();
}

/**
 * Read the current unresolved-error state. Returns a defensive copy so callers
 * cannot mutate the internal holder.
 */
export function getErrorState(): ErrorState {
  return {
    errorActive: errorState.errorActive,
    errorEndpoint: errorState.errorEndpoint
      ? { ...errorState.errorEndpoint }
      : null,
  };
}

/**
 * Update the toolbar indicator to reflect the given status and error flag.
 *
 * Computes the indicator descriptor via the pure `indicatorFor` helper
 * (single source of truth for visual states) and applies it through the
 * `chrome.action` badge/title APIs (Req 6.5, 7.4).
 *
 * @param status      The current Proxy_Status (its `effectiveMode` selects the
 *                    normal-mode indicator).
 * @param errorActive Whether an unresolved proxy error is active; when true the
 *                    error indicator takes precedence over the mode indicator.
 */
export function updateToolbarIndicator(
  status: ProxyStatus,
  errorActive: boolean
): void {
  const indicator = indicatorFor(status.effectiveMode, errorActive);
  // `chrome.action` is guarded so the Service Worker logic (and its tests) can
  // run in environments that don't mock the action API.
  const action = chrome.action;
  if (!action) {
    return;
  }
  void action.setBadgeText({ text: indicator.badgeText });
  void action.setBadgeBackgroundColor({ color: indicator.badgeColor });
  void action.setTitle({ title: indicator.title });
}

/**
 * Rebuild a Proxy_Status from the tracked runtime state and push it to the
 * toolbar indicator. Used internally whenever the tracked mode or error state
 * changes.
 */
function refreshIndicator(): void {
  const status: ProxyStatus = {
    effectiveMode: currentMode,
    // Not used by the toolbar indicator; derived for type-completeness only.
    selectedMode: currentMode === 'Direct' ? 'Fixed_Servers' : currentMode,
    endpoint: currentMode === 'Fixed_Servers' ? currentEndpoint : null,
    pac: null,
    errorActive: errorState.errorActive,
    errorEndpoint: errorState.errorEndpoint,
  };
  updateToolbarIndicator(status, errorState.errorActive);
}
