/**
 * Proxy_Status construction for the browser proxy extension.
 *
 * Pure logic decoupled from the browser runtime so it can be unit- and
 * property-tested in a plain Node environment.
 */
import type {
  ForwardingMode,
  ProxyConfiguration,
  ProxyEndpoint,
  ProxyMode,
  ProxyStatus,
} from './types.js';

/**
 * Builds a {@link ProxyStatus} from the effective Proxy_Mode and the current
 * Proxy_Configuration.
 *
 * - `effectiveMode` always equals the supplied mode (Req 6.1).
 * - `endpoint` is populated only in Fixed_Servers mode; null otherwise (Req 6.2).
 * - `pacUrl` is populated only in PAC mode; null otherwise (Req 6.3).
 * - `errorActive` / `errorEndpoint` carry the current unresolved error state (Req 7.4, 7.1).
 *
 * @param mode The currently effective Proxy_Mode.
 * @param config The current Proxy_Configuration.
 * @param errorActive Whether an unresolved proxy error currently exists.
 * @param errorEndpoint The endpoint reported as unreachable, or null.
 * @param selectedMode The forwarding mode chosen for the enable switch. When
 *   omitted it defaults to the effective mode (or Fixed_Servers when the
 *   effective mode is Direct), so callers that don't track a selection still
 *   get a sensible highlight.
 *
 * Requirements: 6.1, 6.2, 6.3, 7.4
 */
export function buildProxyStatus(
  mode: ProxyMode,
  config: ProxyConfiguration,
  errorActive: boolean,
  errorEndpoint: { host: string; port: number } | null,
  selectedMode?: ForwardingMode,
): ProxyStatus {
  // Only Fixed_Servers mode reports a routing endpoint (Req 6.2).
  const endpoint: ProxyEndpoint | null =
    mode === 'Fixed_Servers' ? config.endpoint : null;

  // Only PAC mode reports a PAC source (Req 6.3).
  const pac = mode === 'PAC' ? config.pac : null;

  // The selected forwarding mode stays highlighted even while disabled.
  const resolvedSelectedMode: ForwardingMode =
    selectedMode ?? (mode !== 'Direct' ? mode : 'Fixed_Servers');

  return {
    effectiveMode: mode,
    selectedMode: resolvedSelectedMode,
    endpoint,
    pac,
    errorActive,
    errorEndpoint,
  };
}
