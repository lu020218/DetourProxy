/**
 * Conversion and normalization helpers for the Shared Core.
 *
 * Pure functions decoupled from the browser runtime so they can be
 * unit- and property-tested in a plain Node environment.
 */
import { DEFAULT_BYPASS_LIST } from './constants.js';
import type { ProxyConfiguration, ProxyMode, Protocol } from './types.js';

/**
 * Normalize a Bypass_List, falling back to the default list when the
 * stored/submitted list is empty or unset.
 *
 * When no Bypass_List is stored or an empty list is submitted, the default
 * Bypass_List containing `localhost` and the loopback address `127.0.0.1`
 * is applied. A non-empty list is returned unchanged.
 *
 * Requirements: 4.4
 *
 * @param entries The stored or submitted Bypass_List entries. May be empty
 *   or `undefined`/`null` when nothing has been stored.
 * @returns The default Bypass_List when `entries` is empty, otherwise a copy
 *   of `entries`.
 */
export function normalizeBypassList(entries: string[]): string[] {
  if (entries == null || entries.length === 0) {
    return [...DEFAULT_BYPASS_LIST];
  }
  return [...entries];
}

/**
 * Mapping from a {@link Protocol} value to its corresponding lowercase
 * `chrome.proxy` proxy server scheme.
 *
 * Requirements: 2.1, 4.3, 8.4
 */
const PROTOCOL_TO_SCHEME: Readonly<Record<Protocol, string>> = {
  SOCKS5: 'socks5',
  SOCKS4: 'socks4',
  HTTP: 'http',
  HTTPS: 'https',
};

/**
 * Convert a Proxy_Mode plus Proxy_Configuration into the `ProxyConfig` object
 * expected by the `chrome.proxy` API.
 *
 * The mapping follows the "chrome.proxy 配置映射" table in design.md:
 * - `Direct` → `{ mode: 'direct' }`
 * - `System` → `{ mode: 'system' }`
 * - `Fixed_Servers` → `{ mode: 'fixed_servers', rules: { singleProxy, bypassList } }`
 *   where `singleProxy.scheme` is the lowercase scheme derived from the
 *   endpoint protocol and `bypassList` is the normalized Bypass_List.
 * - `PAC` → `{ mode: 'pac_script', pacScript: { url } | { data } }` depending
 *   on whether the PAC source is a URL or an inline script.
 *
 * This is a deterministic, pure function: the same `(mode, config)` input
 * always produces a deeply-equal result, which guarantees identical behavior
 * across Chrome and Edge (Req 8.4).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 4.3, 8.4
 *
 * @param mode The Proxy_Mode to convert.
 * @param config The Proxy_Configuration providing the endpoint, Bypass_List
 *   and PAC URL.
 * @returns A `chrome.proxy.ProxyConfig` describing the requested mode.
 */
export function toChromeProxyConfig(
  mode: ProxyMode,
  config: ProxyConfiguration,
): chrome.proxy.ProxyConfig {
  switch (mode) {
    case 'Direct':
      return { mode: 'direct' };

    case 'System':
      return { mode: 'system' };

    case 'Fixed_Servers': {
      const endpoint = config.endpoint;
      if (endpoint == null) {
        throw new Error(
          'toChromeProxyConfig: Fixed_Servers mode requires a Proxy_Endpoint',
        );
      }
      return {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme: PROTOCOL_TO_SCHEME[endpoint.protocol],
            host: endpoint.host,
            port: endpoint.port,
          },
          bypassList: normalizeBypassList(config.bypassList),
        },
      };
    }

    case 'PAC': {
      const pac = config.pac;
      if (pac == null) {
        throw new Error('toChromeProxyConfig: PAC mode requires a PAC source');
      }
      return {
        mode: 'pac_script',
        pacScript:
          pac.kind === 'url' ? { url: pac.url } : { data: pac.script },
      };
    }

    default: {
      // Exhaustiveness guard: all ProxyMode values are handled above.
      const exhaustive: never = mode;
      throw new Error(`toChromeProxyConfig: unsupported Proxy_Mode: ${String(exhaustive)}`);
    }
  }
}
