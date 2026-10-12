/**
 * Service Worker: apply a Proxy_Mode to the browser's Proxy_Service.
 *
 * `applyProxyMode` is the single write point for `chrome.proxy.settings`.
 * It validates prerequisites via the Shared Core, converts the configuration
 * to a `chrome.proxy.ProxyConfig`, writes it through `chrome.proxy.settings.set`
 * and inspects `chrome.runtime.lastError` to detect rejection.
 *
 * Storage decoupling
 * ------------------
 * To avoid tight coupling with Storage_Service internals, `applyProxyMode`
 * does NOT read or write `chrome.storage` itself. Instead it accepts the
 * previously effective Proxy_Mode and returns the mode that remains in effect
 * (`effectiveMode`). The caller (e.g. the message handler / startup restore)
 * is responsible for persisting the returned `effectiveMode` via
 * `persistConfiguration` ONLY when `ok` is `true`. On failure the returned
 * `effectiveMode` equals `previousMode`, so the caller leaves both the
 * Proxy_Service and the Storage_Service unchanged (Req 7.2).
 *
 * The function never mutates `config`; disabling the proxy is performed by
 * calling `applyProxyMode('Direct', config, previousMode)`, which applies
 * Direct to the Proxy_Service while leaving the stored Proxy_Configuration
 * (endpoint / bypassList / pacUrl) untouched (Req 3.2, 3.3).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 7.2, 7.3
 */
import { toChromeProxyConfig } from '../core/convert.js';
import { hasValidEndpoint, validatePacSource } from '../core/validation.js';
import type {
  FieldError,
  ProxyConfiguration,
  ProxyMode,
} from '../core/types.js';
import { setProxySettings } from './proxy.js';

/**
 * Result of an attempt to apply a Proxy_Mode.
 *
 * `effectiveMode` always reflects the Proxy_Mode that remains in effect after
 * the attempt: the newly applied `mode` on success, or the unchanged
 * `previousMode` on failure.
 */
export type ApplyResult =
  | { ok: true; effectiveMode: ProxyMode }
  | { ok: false; errors: FieldError[]; effectiveMode: ProxyMode };

/**
 * Apply the requested Proxy_Mode to the Proxy_Service.
 *
 * Steps:
 * 1. Validate prerequisites via the Shared Core. Fixed_Servers requires a
 *    valid Proxy_Endpoint (`hasValidEndpoint`, Req 3.1); PAC requires a valid
 *    `config.pacUrl` (`validatePacUrl`, Req 2.4). When a prerequisite fails,
 *    return `ok: false` WITHOUT touching the Proxy_Service, preserving the
 *    previously effective Proxy_Mode (Req 7.2).
 * 2. Convert via `toChromeProxyConfig` and write through
 *    `chrome.proxy.settings.set`, then check `chrome.runtime.lastError`.
 *    On rejection, do not update the effective mode; return `ok: false` with a
 *    message stating the configuration was not applied and which mode remains
 *    (Req 7.2, 7.3).
 * 3. On success, return `ok: true` with `effectiveMode` set to the new `mode`,
 *    which the caller then persists (Req 2.1–2.4, 3.1, 3.2).
 *
 * @param mode The Proxy_Mode to apply.
 * @param config The Proxy_Configuration providing endpoint / bypassList / pacUrl.
 * @param previousMode The Proxy_Mode currently in effect, preserved on failure.
 * @returns An {@link ApplyResult} whose `effectiveMode` is the mode that
 *   remains in effect after the attempt.
 */
export async function applyProxyMode(
  mode: ProxyMode,
  config: ProxyConfiguration,
  previousMode: ProxyMode,
): Promise<ApplyResult> {
  // --- 1. Validate prerequisites (no Proxy_Service writes on failure) ---
  if (mode === 'Fixed_Servers' && !hasValidEndpoint(config)) {
    // Req 2.5, 3.1, 3.4, 7.2: reject and preserve previous mode.
    return {
      ok: false,
      errors: [
        {
          field: 'config',
          message:
            '未配置有效的 Proxy_Endpoint，无法启用固定服务器模式。请先配置代理端点的主机、端口和协议。',
        },
      ],
      effectiveMode: previousMode,
    };
  }

  if (mode === 'PAC') {
    const pacResult = validatePacSource(config.pac);
    if (!pacResult.ok) {
      // Req 2.6, 2.7, 2.11, 7.2: reject and preserve previous mode.
      return {
        ok: false,
        errors: pacResult.errors,
        effectiveMode: previousMode,
      };
    }
  }

  // --- 2. Convert and write to the Proxy_Service ---
  const value = toChromeProxyConfig(mode, config);

  try {
    await setProxySettings(value);
  } catch (error) {
    // Req 7.2, 7.3: the Proxy_Service rejected the configuration. Do not update
    // the effective mode; report that the configuration was not applied and
    // which mode remains in effect. The caller leaves Storage_Service unchanged.
    //
    // Surface the underlying chrome.runtime.lastError detail so the user (and
    // the Service Worker console) can see WHY the write was rejected — without
    // it, every rejection looked identical and the root cause was hidden.
    const detail = error instanceof Error && error.message ? error.message : '';
    // eslint-disable-next-line no-console
    console.error('[proxy] chrome.proxy.settings.set rejected', { mode, detail, value });
    return {
      ok: false,
      errors: [
        {
          field: 'config',
          message: detail
            ? `代理配置未被应用（${detail}），当前仍然生效的模式为 ${previousMode}。`
            : `代理配置未被应用，当前仍然生效的模式为 ${previousMode}。`,
        },
      ],
      effectiveMode: previousMode,
    };
  }

  // --- 3. Success: the new mode is now in effect (caller persists it) ---
  return { ok: true, effectiveMode: mode };
}
