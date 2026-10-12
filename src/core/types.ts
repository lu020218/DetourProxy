/**
 * Shared type definitions for the browser proxy extension.
 *
 * These types are decoupled from the browser runtime so the Shared Core
 * logic can be unit- and property-tested in a plain Node environment.
 * They mirror the Data Models section of design.md exactly.
 */

/**
 * The proxy protocol exposed by the v2raya Proxy_Endpoint.
 * Requirements: 1.4, 1.5
 */
export type Protocol = 'SOCKS5' | 'SOCKS4' | 'HTTP' | 'HTTPS';

/**
 * Browser proxy operating mode.
 */
export type ProxyMode = 'Direct' | 'System' | 'Fixed_Servers' | 'PAC';

/**
 * A forwarding Proxy_Mode — every mode except Direct. This is the set of modes
 * the user can pick in the mode selector; Direct is reached by turning the
 * master enable switch off rather than by selecting it as a mode.
 */
export type ForwardingMode = Exclude<ProxyMode, 'Direct'>;

/**
 * The source of the PAC script used in PAC mode. PAC mode accepts either a
 * remote URL the browser fetches (`kind: 'url'`) or an inline script whose
 * contents are embedded directly (`kind: 'inline'`). Both map to the same
 * `chrome.proxy` `pac_script` mode — `url` populates `pacScript.url`, `inline`
 * populates `pacScript.data`.
 */
export type PacSource =
  | { kind: 'url'; url: string }
  | { kind: 'inline'; script: string };

/**
 * A network target defined by host, port and protocol.
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
export interface ProxyEndpoint {
  /** 1–253 characters (Req 1.1, 1.3) */
  host: string;
  /** Integer in range 1–65535 (Req 1.1, 1.2) */
  port: number;
  /** One of SOCKS5 | SOCKS4 | HTTP | HTTPS (Req 1.4, 1.5) */
  protocol: Protocol;
}

/**
 * User-defined proxy configuration.
 */
export interface ProxyConfiguration {
  /** null when no endpoint has been configured */
  endpoint: ProxyEndpoint | null;
  /** Up to 100 entries, each 1–255 characters (Req 4.1, 4.2) */
  bypassList: string[];
  /**
   * The PAC script source used in PAC mode: a remote URL or an inline script.
   * null when no PAC source has been configured (Req 2.4, 2.7, 2.10).
   */
  pac: PacSource | null;
}

/**
 * Root state persisted to chrome.storage.
 */
export interface PersistedState {
  /** Used for future migrations */
  schemaVersion: number;
  configuration: ProxyConfiguration;
  /** Most recently effective Proxy_Mode (Req 2.8, 5.2) */
  effectiveMode: ProxyMode;
  /**
   * The forwarding mode the user has chosen for the enable switch. Turning the
   * master switch on applies this mode; disabling sets `effectiveMode` to
   * Direct but leaves `selectedMode` untouched so the choice is remembered
   * (Req 2.9, 3.1).
   */
  selectedMode: ForwardingMode;
  /** Enabled/disabled state (Req 3) */
  enabled: boolean;
}

/**
 * Runtime-reported proxy status (not persisted).
 */
export interface ProxyStatus {
  /** Req 6.1 */
  effectiveMode: ProxyMode;
  /**
   * The forwarding mode the user has selected, highlighted in the mode
   * selector even while the proxy is disabled (effectiveMode === Direct).
   */
  selectedMode: ForwardingMode;
  /** Shown in Fixed_Servers mode (Req 6.2) */
  endpoint: ProxyEndpoint | null;
  /** The PAC source shown in PAC mode; null otherwise (Req 6.3) */
  pac: PacSource | null;
  /** Whether an unresolved proxy error currently exists (Req 7.4) */
  errorActive: boolean;
  /** The endpoint reported as unreachable (Req 7.1) */
  errorEndpoint: { host: string; port: number } | null;
}

/**
 * Identifies which input field a validation error belongs to.
 */
export interface FieldError {
  field: 'host' | 'port' | 'protocol' | 'pacUrl' | 'pacScript' | 'bypassList' | 'config';
  /** User-facing validation message (Chinese) */
  message: string;
}

/**
 * Result of a validation operation: a tagged union of success/failure.
 */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

/**
 * Raw user input for a Proxy_Endpoint, prior to validation.
 * Fields are loosely typed because they come straight from form controls.
 */
export interface EndpointInput {
  host: string;
  port: string | number;
  protocol: string;
}
