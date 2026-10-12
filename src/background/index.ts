/**
 * Service Worker entry point for the browser proxy extension.
 *
 * This module wires the Shared Core logic and the sibling background modules
 * (storage / apply / restore / errors) together behind two surfaces:
 *
 *  1. `handleMessage` — the `chrome.runtime.onMessage` handler that processes
 *     requests sent by the Popup_Interface (SAVE_ENDPOINT, SAVE_BYPASS,
 *     SET_MODE, ENABLE, DISABLE, GET_STATUS) and replies with a {@link Response}
 *     carrying the resulting {@link ProxyStatus} (plus any FieldErrors).
 *
 *  2. Listener registration — `chrome.runtime.onStartup` / `onInstalled` drive
 *     startup restoration, `chrome.proxy.onProxyError` drives error tracking,
 *     and `chrome.runtime.onMessage` dispatches popup requests.
 *
 * The Service Worker remains the single write point for `chrome.proxy` and
 * `chrome.storage`: every mutation flows through `applyProxyMode` /
 * `persistConfiguration`, and the runtime mode is tracked via `setCurrentMode`
 * so `handleProxyError` can decide whether a proxy error is relevant.
 *
 * Requirements: 2.8, 3.1, 3.4, 5.2, 7.1, 7.2
 */
import { DEFAULT_STATE } from '../core/constants.js';
import { deserializeConfiguration } from '../core/serialize.js';
import { buildProxyStatus } from '../core/status.js';
import {
  hasValidEndpoint,
  validateBypassList,
  validateEndpoint,
  validatePacSource,
} from '../core/validation.js';
import type {
  EndpointInput,
  FieldError,
  ForwardingMode,
  PacSource,
  PersistedState,
  ProxyConfiguration,
  ProxyMode,
  ProxyStatus,
} from '../core/types.js';
import { applyProxyMode } from './apply.js';
import {
  getErrorState,
  handleProxyError,
  hydrateErrorTracking,
  setCurrentMode,
} from './errors.js';
import {
  getRestoreError,
  isStoredConfigInvalid,
  restoreOnStartup,
} from './restore.js';
import { persistConfiguration, readPersistedState } from './storage.js';

/**
 * Requests sent from the Popup_Interface to the Service Worker.
 * Mirrors the message protocol in design.md.
 */
export type Request =
  | { type: 'SAVE_ENDPOINT'; endpoint: EndpointInput }
  | { type: 'SAVE_BYPASS'; entries: string[] }
  | { type: 'SAVE_PAC'; pac: PacSource }
  | { type: 'SET_MODE'; mode: ProxyMode; pac?: PacSource }
  | { type: 'SET_SELECTED_MODE'; mode: ForwardingMode }
  | { type: 'ENABLE' }
  | { type: 'DISABLE' }
  | { type: 'GET_STATUS' };

/**
 * Replies returned by the Service Worker. Both variants carry the current
 * {@link ProxyStatus}; the failure variant additionally lists the offending
 * fields so the popup can render validation messages next to the controls.
 */
export type Response =
  | { ok: true; status: ProxyStatus }
  | { ok: false; errors: FieldError[]; status: ProxyStatus };

/**
 * Load the current {@link PersistedState} from the Storage_Service.
 *
 * Falls back to a fresh copy of {@link DEFAULT_STATE} when nothing is stored,
 * the read fails, or the stored value cannot be deserialized/validated. The
 * returned object is always a deep copy, so callers may mutate it freely
 * without touching the shared default constant.
 */
async function loadState(): Promise<PersistedState> {
  let raw: string | null;
  try {
    raw = await readPersistedState();
  } catch {
    return structuredClone(DEFAULT_STATE);
  }

  if (raw === null) {
    return structuredClone(DEFAULT_STATE);
  }

  const result = deserializeConfiguration(raw);
  return result.ok ? result.value : structuredClone(DEFAULT_STATE);
}

/**
 * Build a {@link ProxyStatus} from a {@link PersistedState} plus the current
 * unresolved-error state tracked by errors.ts (Req 6.1, 6.2, 6.3, 7.4).
 */
function statusFor(state: PersistedState): ProxyStatus {
  const error = getErrorState();
  return buildProxyStatus(
    state.effectiveMode,
    state.configuration,
    error.errorActive,
    error.errorEndpoint,
    state.selectedMode,
  );
}

/** Convenience constructor for a failure {@link Response}. */
function failure(errors: FieldError[], state: PersistedState): Response {
  return { ok: false, errors, status: statusFor(state) };
}

/**
 * Persist the new state, then build a success response. When the
 * Storage_Service rejects the write (Req 5.5), report the persistence failure
 * and keep the previously stored state in the reported status.
 */
async function persistAndRespond(
  newState: PersistedState,
  previousState: PersistedState,
): Promise<Response> {
  const persistResult = await persistConfiguration(newState);
  if (!persistResult.ok) {
    return failure([{ field: 'config', message: persistResult.message }], previousState);
  }
  return { ok: true, status: statusFor(newState) };
}

/** Handle SAVE_ENDPOINT: validate and store the Proxy_Endpoint (Req 1.1–1.5). */
async function handleSaveEndpoint(input: EndpointInput): Promise<Response> {
  const state = await loadState();

  const result = validateEndpoint(input);
  if (!result.ok) {
    // Reject, leaving the previously stored endpoint unchanged (Req 1.2, 1.3, 1.5).
    return failure(result.errors, state);
  }

  const newState: PersistedState = {
    ...state,
    configuration: { ...state.configuration, endpoint: result.value },
  };
  return persistAndRespond(newState, state);
}

/** Handle SAVE_BYPASS: validate and store the Bypass_List (Req 4.1, 4.2). */
async function handleSaveBypass(entries: string[]): Promise<Response> {
  const state = await loadState();

  const result = validateBypassList(entries);
  if (!result.ok) {
    // Reject, leaving the previously stored Bypass_List unchanged (Req 4.2).
    return failure(result.errors, state);
  }

  const newState: PersistedState = {
    ...state,
    configuration: { ...state.configuration, bypassList: result.value },
  };
  return persistAndRespond(newState, state);
}

/**
 * Handle SAVE_PAC: validate and store the PAC source WITHOUT applying it.
 *
 * Mirrors SAVE_ENDPOINT / SAVE_BYPASS — the options page only persists the
 * configuration; switching the live proxy to PAC is done from the popup. This
 * keeps the three "保存" actions semantically uniform (store, don't apply).
 */
async function handleSavePac(pac: PacSource): Promise<Response> {
  const state = await loadState();

  const result = validatePacSource(pac);
  if (!result.ok) {
    // Reject, leaving the previously stored PAC source unchanged.
    return failure(result.errors, state);
  }

  const newState: PersistedState = {
    ...state,
    configuration: { ...state.configuration, pac: result.value },
  };
  return persistAndRespond(newState, state);
}

/**
 * Handle SET_SELECTED_MODE: record the forwarding mode chosen for the enable
 * switch WITHOUT applying it or changing the enabled state.
 *
 * Used by the popup when the user picks a mode while the proxy is disabled: the
 * choice is remembered (and highlighted as "pending") so flipping the master
 * switch later applies it (Req 2.9). Any prerequisite check (valid endpoint /
 * PAC source) happens at enable time, so recording the selection is permissive.
 */
async function handleSetSelectedMode(mode: ForwardingMode): Promise<Response> {
  const state = await loadState();
  const newState: PersistedState = { ...state, selectedMode: mode };
  return persistAndRespond(newState, state);
}

/**
 * Handle SET_MODE: select a Proxy_Mode and apply it to the Proxy_Service.
 *
 * - PAC: the submitted `pac` source (URL or inline script) is validated
 *   (Req 2.4, 2.6, 2.7, 2.10, 2.11) and staged into the configuration before
 *   applying.
 * - Fixed_Servers: `applyProxyMode` gates on a valid Proxy_Endpoint (Req 2.5).
 * - On success the accepted mode is persisted as the effective mode (Req 2.8)
 *   and, when it is a forwarding mode, also recorded as `selectedMode` so the
 *   enable switch can restore it later (Req 2.9). The runtime mode is tracked
 *   so proxy errors can be surfaced (Req 7.1).
 * - On failure the previously effective mode is preserved (Req 7.2).
 */
async function handleSetMode(mode: ProxyMode, pac?: PacSource): Promise<Response> {
  const state = await loadState();
  let config: ProxyConfiguration = state.configuration;

  // PAC mode requires a valid PAC source; stage it into the config.
  if (mode === 'PAC') {
    const pacResult = validatePacSource(pac);
    if (!pacResult.ok) {
      return failure(pacResult.errors, state);
    }
    config = { ...config, pac: pacResult.value };
  }

  const previousMode = state.effectiveMode;
  const applyResult = await applyProxyMode(mode, config, previousMode);
  if (!applyResult.ok) {
    // Preserve the previously effective mode (Req 2.5, 7.2).
    return failure(applyResult.errors, state);
  }

  const newState: PersistedState = {
    ...state,
    configuration: config,
    effectiveMode: applyResult.effectiveMode,
    // Remember the chosen forwarding mode so the enable switch can restore it.
    selectedMode: mode !== 'Direct' ? mode : state.selectedMode,
    enabled: mode !== 'Direct',
  };

  // Track the runtime mode (clears any prior error, refreshes the indicator).
  setCurrentMode(
    applyResult.effectiveMode,
    mode === 'Fixed_Servers' ? config.endpoint : null,
  );

  return persistAndRespond(newState, state);
}

/**
 * Handle ENABLE: apply the user's chosen forwarding mode using the stored
 * configuration, only when that configuration is valid (Req 3.1, 3.4).
 *
 * The target mode is the persisted `selectedMode` (System / Fixed_Servers /
 * PAC), so enabling restores whatever forwarding mode the user last chose
 * rather than always defaulting to Fixed_Servers (Req 2.9, 3.1). Fixed_Servers
 * requires a valid Proxy_Endpoint and PAC a valid URL; otherwise the action is
 * rejected with a message guiding the user to settings and the previously
 * effective mode is preserved (Req 3.4).
 */
async function handleEnable(): Promise<Response> {
  const state = await loadState();
  const target: ProxyMode = state.selectedMode;

  if (target === 'Fixed_Servers' && !hasValidEndpoint(state.configuration)) {
    return failure(
      [
        {
          field: 'config',
          message:
            '未配置有效的 Proxy_Endpoint，无法启用代理。请先配置代理端点的主机、端口和协议。',
        },
      ],
      state,
    );
  }

  const previousMode = state.effectiveMode;
  const applyResult = await applyProxyMode(target, state.configuration, previousMode);
  if (!applyResult.ok) {
    return failure(applyResult.errors, state);
  }

  const newState: PersistedState = {
    ...state,
    effectiveMode: applyResult.effectiveMode,
    enabled: true,
  };

  setCurrentMode(
    applyResult.effectiveMode,
    target === 'Fixed_Servers' ? state.configuration.endpoint : null,
  );

  return persistAndRespond(newState, state);
}

/**
 * Handle DISABLE: apply Direct Proxy_Mode while leaving the stored
 * Proxy_Configuration untouched (Req 3.2, 3.3).
 */
async function handleDisable(): Promise<Response> {
  const state = await loadState();
  const previousMode = state.effectiveMode;

  const applyResult = await applyProxyMode('Direct', state.configuration, previousMode);
  if (!applyResult.ok) {
    return failure(applyResult.errors, state);
  }

  // Configuration (endpoint / bypassList / pacUrl) is preserved (Req 3.3).
  const newState: PersistedState = {
    ...state,
    effectiveMode: 'Direct',
    enabled: false,
  };

  setCurrentMode('Direct', null);

  return persistAndRespond(newState, state);
}

/**
 * Handle GET_STATUS: report the current Proxy_Status (Req 6.1–6.3, 7.4).
 *
 * When startup restoration flagged the stored configuration as invalid
 * (Req 5.4), the response is a failure carrying that message so the popup can
 * inform the user, alongside the (Direct) status.
 */
async function handleGetStatus(): Promise<Response> {
  const state = await loadState();
  const status = statusFor(state);

  if (isStoredConfigInvalid()) {
    const message = getRestoreError() ?? '已存储的配置无效，已回退为直连模式。';
    return { ok: false, errors: [{ field: 'config', message }], status };
  }

  return { ok: true, status };
}

/**
 * Serializes message-driven mutations so concurrent popup/options requests
 * cannot interleave their read-modify-write of the persisted state.
 *
 * Each handler does `loadState()` → mutate → `persistConfiguration()`; without
 * serialization two requests arriving close together (e.g. a rapid mode switch
 * plus an enable toggle) could both read the old state and the later write
 * would clobber the earlier one. Chaining every request through a single
 * promise guarantees they run one-at-a-time in arrival order. A failure in one
 * task never breaks the chain (the catch keeps it alive for the next request).
 */
let requestQueue: Promise<unknown> = Promise.resolve();

function enqueueRequest(request: Request): Promise<Response> {
  const run = requestQueue.then(() => processRequest(request));
  requestQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Ensure the error-tracking module is rehydrated from `chrome.storage.session`
 * exactly once per Service Worker lifetime. The MV3 worker is ephemeral, so
 * after a respawn the in-memory tracked mode/error state must be restored
 * before any proxy-error event is interpreted.
 */
let hydration: Promise<void> | null = null;
function ensureHydrated(): Promise<void> {
  if (hydration === null) {
    hydration = hydrateErrorTracking();
  }
  return hydration;
}

/**
 * Process a popup {@link Request} and produce a {@link Response}. Unknown
 * request shapes yield a failure response describing the current default
 * status so the popup always receives a well-formed reply.
 */
async function processRequest(request: Request): Promise<Response> {
  switch (request.type) {
    case 'SAVE_ENDPOINT':
      return handleSaveEndpoint(request.endpoint);
    case 'SAVE_BYPASS':
      return handleSaveBypass(request.entries);
    case 'SAVE_PAC':
      return handleSavePac(request.pac);
    case 'SET_MODE':
      return handleSetMode(request.mode, request.pac);
    case 'SET_SELECTED_MODE':
      return handleSetSelectedMode(request.mode);
    case 'ENABLE':
      return handleEnable();
    case 'DISABLE':
      return handleDisable();
    case 'GET_STATUS':
      return handleGetStatus();
    default: {
      const exhaustive: never = request;
      void exhaustive;
      return failure(
        [{ field: 'config', message: '无法识别的请求类型。' }],
        structuredClone(DEFAULT_STATE),
      );
    }
  }
}

/**
 * `chrome.runtime.onMessage` handler. Processes the popup request
 * asynchronously and replies via `sendResponse`. Returns `true` to keep the
 * message channel open until the async reply is delivered.
 */
export function handleMessage(
  request: Request,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: Response) => void,
): boolean {
  void enqueueRequest(request).then(sendResponse);
  return true;
}

// --- Listener registration ---------------------------------------------------

// Rehydrate runtime error-tracking state as soon as the worker spins up, so a
// respawn doesn't lose the tracked mode / unresolved-error state (MV3).
void ensureHydrated();

// Restore proxy settings on browser startup and on install/update (Req 5.2).
chrome.runtime.onStartup.addListener(() => {
  void restoreOnStartup();
});
chrome.runtime.onInstalled.addListener(() => {
  void restoreOnStartup();
});

// Surface proxy errors via the toolbar indicator / popup (Req 7.1). Hydration
// is awaited first so a worker respawned by this very event interprets the
// error against the correct effective mode rather than the default Direct.
chrome.proxy.onProxyError.addListener((details) => {
  void ensureHydrated().then(() => handleProxyError(details));
});

// Dispatch requests from the Popup_Interface.
chrome.runtime.onMessage.addListener(handleMessage);
