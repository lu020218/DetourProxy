/**
 * Default constants for the browser proxy extension.
 */
import type { PersistedState } from './types.js';

/**
 * Field bounds shared by the input validators (`validation.ts`) and the
 * structural deserializer (`serialize.ts`). Keeping a single source of truth
 * prevents the two modules from drifting apart when a limit changes.
 *
 * Requirements: 1.1, 1.2, 1.3, 2.4, 2.7, 2.10, 2.11, 4.1, 4.2
 */
export const LIMITS = {
  /** Proxy_Endpoint host length, in characters (Req 1.1, 1.3). */
  HOST_MIN: 1,
  HOST_MAX: 253,
  /** Proxy_Endpoint port value (Req 1.1, 1.2). */
  PORT_MIN: 1,
  PORT_MAX: 65535,
  /** Bypass_List size and per-entry length (Req 4.1, 4.2). */
  BYPASS_MAX_ENTRIES: 100,
  BYPASS_ENTRY_MIN: 1,
  BYPASS_ENTRY_MAX: 255,
  /** PAC_URL length (Req 2.4, 2.7). */
  PAC_URL_MIN: 1,
  PAC_URL_MAX: 2048,
  /** PAC_Inline_Script length (Req 2.10, 2.11). */
  PAC_SCRIPT_MIN: 1,
  PAC_SCRIPT_MAX: 100000,
} as const;

/**
 * Default Bypass_List applied when none is stored or an empty list is
 * submitted (Req 4.4, 4.6).
 */
export const DEFAULT_BYPASS_LIST: readonly string[] = ['localhost', '127.0.0.1'];

/**
 * Default persisted state used on first run or as a safe fallback.
 * Falls back to Direct Proxy_Mode (Req 5.3).
 */
export const DEFAULT_STATE: PersistedState = {
  schemaVersion: 1,
  configuration: {
    endpoint: null,
    bypassList: [...DEFAULT_BYPASS_LIST],
    pac: null,
  },
  effectiveMode: 'Direct',
  selectedMode: 'Fixed_Servers',
  enabled: false,
};
