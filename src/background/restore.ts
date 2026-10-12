/**
 * Startup restoration for the Service Worker.
 *
 * On browser startup (`chrome.runtime.onStartup`) and on install/update
 * (`chrome.runtime.onInstalled`), the extension reads the persisted
 * Proxy_Configuration from chrome.storage, validates it, and applies the most
 * recently effective Proxy_Mode to the Proxy_Service:
 *
 * - When a valid Proxy_Configuration is stored, the most recent effective
 *   Proxy_Mode is applied; for Fixed_Servers this includes the stored
 *   Proxy_Endpoint and Bypass_List (Req 5.2).
 * - When nothing is stored, the Proxy_Service is configured for Direct
 *   Proxy_Mode (Req 5.3).
 * - When the stored configuration cannot be read or fails validation, the
 *   Proxy_Service falls back to Direct Proxy_Mode and the stored configuration
 *   is flagged as invalid so the Popup_Interface can surface a message
 *   (Req 5.4).
 *
 * Design notes:
 * - Reading the persisted value goes through `readPersistedState` from
 *   storage.ts, so both modules agree on a single chrome.storage key (the
 *   `STORAGE_KEY` exported by storage.ts). This avoids the two modules
 *   reading/writing under different keys.
 * - The persisted value is the JSON string produced by
 *   `serializeConfiguration`, parsed back via `deserializeConfiguration`.
 * - The "stored configuration is invalid" condition is recorded in a
 *   module-level flag exposed via {@link isStoredConfigInvalid} /
 *   {@link getRestoreError}. The Popup_Interface learns about it by querying
 *   the Service Worker (e.g. the future `GET_STATUS` message), which can read
 *   this flag and include it in the reported Proxy_Status.
 *
 * Requirements: 5.2, 5.3, 5.4
 */
import { DEFAULT_STATE } from '../core/constants.js';
import { toChromeProxyConfig } from '../core/convert.js';
import { deserializeConfiguration } from '../core/serialize.js';
import { hasValidEndpoint } from '../core/validation.js';
import type { PersistedState, ProxyMode } from '../core/types.js';
import { setCurrentMode } from './errors.js';
import { setProxySettings } from './proxy.js';
import { readPersistedState } from './storage.js';

/**
 * Module-level flag recording whether the most recent restore found the stored
 * configuration unreadable or invalid (Req 5.4). Reset to `false` on a clean
 * restore (valid config or no config stored).
 */
let storedConfigInvalid = false;

/**
 * Human-readable description of why the stored configuration was treated as
 * invalid, or `null` when the last restore was clean. The Popup_Interface can
 * surface this message.
 */
let restoreErrorMessage: string | null = null;

/** Whether the most recent restore flagged the stored configuration invalid. */
export function isStoredConfigInvalid(): boolean {
  return storedConfigInvalid;
}

/** The invalid-config message from the most recent restore, or `null`. */
export function getRestoreError(): string | null {
  return restoreErrorMessage;
}

/**
 * Restore proxy settings on browser startup / install.
 *
 * Reads and validates the persisted configuration, then applies the most
 * recently effective Proxy_Mode, falling back to Direct on any failure.
 *
 * Requirements: 5.2, 5.3, 5.4
 */
export async function restoreOnStartup(): Promise<void> {
  let raw: string | null;
  try {
    raw = await readPersistedState();
  } catch (error) {
    // Storage read failed → fall back to Direct and flag invalid (Req 5.4).
    await applyDirectFallback(
      `无法读取已存储的配置：${describeError(error)}`,
    );
    return;
  }

  // Nothing stored → configure Direct Proxy_Mode (Req 5.3).
  if (raw === null) {
    clearInvalidFlag();
    await applyMode('Direct', DEFAULT_STATE);
    return;
  }

  // Deserialize + validate (Req 5.4).
  const result = deserializeConfiguration(raw);
  if (!result.ok) {
    const message = result.errors[0]?.message ?? '已存储的配置无效。';
    await applyDirectFallback(message);
    return;
  }

  const state = result.value;
  const mode = state.effectiveMode;

  // Guard against a stored mode that requires data the configuration lacks
  // (e.g. Fixed_Servers without a valid endpoint, or PAC without a URL).
  // toChromeProxyConfig would throw in those cases, so treat them as invalid.
  if (mode === 'Fixed_Servers' && !hasValidEndpoint(state.configuration)) {
    await applyDirectFallback(
      '已存储的配置为 Fixed_Servers 模式，但缺少有效的 Proxy_Endpoint，已视为无效。',
    );
    return;
  }
  if (mode === 'PAC' && state.configuration.pac === null) {
    await applyDirectFallback(
      '已存储的配置为 PAC 模式，但缺少 PAC 来源，已视为无效。',
    );
    return;
  }

  // Valid configuration → apply the most recent effective Proxy_Mode (Req 5.2).
  // For Fixed_Servers this includes the endpoint and Bypass_List via
  // toChromeProxyConfig.
  clearInvalidFlag();
  await applyMode(mode, state);
}

/**
 * Apply a Proxy_Mode to the Proxy_Service using the Shared Core conversion.
 * Returns when the underlying chrome.proxy write settles.
 *
 * After the write succeeds it syncs the error-tracking module via
 * `setCurrentMode`, so the toolbar indicator reflects the restored mode and
 * subsequent `onProxyError` events are surfaced (errors are only relevant while
 * Fixed_Servers is active). Without this, a restored Fixed_Servers proxy would
 * show a stale Direct badge and swallow proxy errors until the user next
 * interacted with the popup (Req 6.5, 7.1).
 */
async function applyMode(mode: ProxyMode, state: PersistedState): Promise<void> {
  const proxyConfig = toChromeProxyConfig(mode, state.configuration);
  await setProxySettings(proxyConfig);
  setCurrentMode(
    mode,
    mode === 'Fixed_Servers' ? state.configuration.endpoint : null,
  );
}

/**
 * Fall back to Direct Proxy_Mode and flag the stored configuration as invalid
 * (Req 5.4).
 */
async function applyDirectFallback(message: string): Promise<void> {
  storedConfigInvalid = true;
  restoreErrorMessage = message;
  await applyMode('Direct', DEFAULT_STATE);
}

/** Clear the invalid-config flag after a clean restore. */
function clearInvalidFlag(): void {
  storedConfigInvalid = false;
  restoreErrorMessage = null;
}

/** Best-effort string description of an unknown thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
