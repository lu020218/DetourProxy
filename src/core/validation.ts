/**
 * Shared Core validation logic.
 *
 * Pure functions decoupled from the browser runtime so they can be unit-
 * and property-tested in a plain Node environment. All user-facing
 * validation messages are in Chinese.
 */
import { LIMITS } from './constants.js';
import type {
  EndpointInput,
  FieldError,
  PacSource,
  Protocol,
  ProxyConfiguration,
  ProxyEndpoint,
  ValidationResult,
} from './types.js';

/** Minimum/maximum host length in characters (Req 1.1, 1.3). */
const HOST_MIN_LENGTH = LIMITS.HOST_MIN;
const HOST_MAX_LENGTH = LIMITS.HOST_MAX;

/** Minimum/maximum port value (Req 1.1, 1.2). */
const PORT_MIN = LIMITS.PORT_MIN;
const PORT_MAX = LIMITS.PORT_MAX;

/** The exact set of accepted Protocol values (Req 1.4, 1.5). */
const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];

/** Minimum/maximum PAC script URL length in characters (Req 2.4, 2.7). */
const PAC_URL_MIN_LENGTH = LIMITS.PAC_URL_MIN;
const PAC_URL_MAX_LENGTH = LIMITS.PAC_URL_MAX;

/** Minimum/maximum inline PAC script length in characters (Req 2.10, 2.11). */
const PAC_SCRIPT_MIN_LENGTH = LIMITS.PAC_SCRIPT_MIN;
const PAC_SCRIPT_MAX_LENGTH = LIMITS.PAC_SCRIPT_MAX;

/**
 * Validate a single Proxy_Endpoint submitted by the user.
 *
 * Accepts the input if and only if:
 * - `host` is a string of 1–253 characters (Req 1.1, 1.3);
 * - `port` is an integer in the range 1–65535 (Req 1.1, 1.2);
 * - `protocol` is exactly one of SOCKS5/SOCKS4/HTTP/HTTPS (Req 1.4, 1.5).
 *
 * On failure it returns `ok: false` with a `FieldError` for each offending
 * field; the caller is responsible for leaving any previously stored
 * endpoint unchanged (Req 1.2, 1.3, 1.5).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
export function validateEndpoint(
  input: EndpointInput
): ValidationResult<ProxyEndpoint> {
  const errors: FieldError[] = [];

  // --- host (Req 1.1, 1.3) ---
  const host = typeof input.host === 'string' ? input.host : '';
  if (host.length < HOST_MIN_LENGTH || host.length > HOST_MAX_LENGTH) {
    errors.push({
      field: 'host',
      message: '主机地址为必填项，且长度必须在 1 到 253 个字符之间。',
    });
  }

  // --- port (Req 1.1, 1.2) ---
  const port = parsePort(input.port);
  if (port === null) {
    errors.push({
      field: 'port',
      message: '端口号无效，必须为 1 到 65535 之间的整数。',
    });
  }

  // --- protocol (Req 1.4, 1.5) ---
  const protocol = input.protocol;
  if (!isValidProtocol(protocol)) {
    errors.push({
      field: 'protocol',
      message: '协议无效，必须为 SOCKS5、SOCKS4、HTTP 或 HTTPS 之一。',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      host,
      // Safe: validated above, so `port` is a number and `protocol` a Protocol.
      port: port as number,
      protocol: protocol as Protocol,
    },
  };
}

/**
 * Parse a port value (string or number) into an integer in range 1–65535.
 * Returns the parsed integer, or `null` when the value is empty,
 * non-numeric, fractional or out of range (Req 1.2).
 */
function parsePort(value: string | number): number | null {
  let n: number;

  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    // Reject empty and any non-decimal-integer string (e.g. "80.5", "abc", "0x10").
    if (trimmed === '' || !/^\d+$/.test(trimmed)) {
      return null;
    }
    n = Number(trimmed);
  } else {
    return null;
  }

  if (!Number.isInteger(n) || n < PORT_MIN || n > PORT_MAX) {
    return null;
  }

  return n;
}

/** Type guard: is the value exactly one of the accepted Protocol literals? */
function isValidProtocol(value: unknown): value is Protocol {
  return (
    typeof value === 'string' &&
    (VALID_PROTOCOLS as readonly string[]).includes(value)
  );
}

/**
 * Validate a PAC script URL submitted by the user when selecting PAC mode.
 *
 * Accepts the input if and only if it is a string of 1–2048 characters
 * (Req 2.4). Rejects it when the value is missing/undefined (Req 2.6) or
 * empty/longer than 2048 characters (Req 2.7); in both rejection cases it
 * returns `ok: false` with a `FieldError` on the `pacUrl` field. The caller
 * is responsible for leaving the previously effective Proxy_Mode unchanged
 * (Req 2.6, 2.7).
 *
 * Requirements: 2.4, 2.6, 2.7
 */
export function validatePacUrl(
  input: string | undefined
): ValidationResult<string> {
  // Missing / not provided (Req 2.6).
  if (typeof input !== 'string') {
    return {
      ok: false,
      errors: [
        {
          field: 'pacUrl',
          message: 'PAC 脚本 URL 为必填项。',
        },
      ],
    };
  }

  // Empty or out of the accepted 1–2048 length range (Req 2.7).
  if (input.length < PAC_URL_MIN_LENGTH || input.length > PAC_URL_MAX_LENGTH) {
    return {
      ok: false,
      errors: [
        {
          field: 'pacUrl',
          message: 'PAC 脚本 URL 无效，长度必须在 1 到 2048 个字符之间。',
        },
      ],
    };
  }

  return { ok: true, value: input };
}

/**
 * Validate an inline PAC script submitted by the user when selecting PAC mode
 * with the "inline" source.
 *
 * Accepts the input if and only if it is a string of 1–100000 characters
 * (Req 2.10). Rejects missing/undefined values and empty/over-length scripts
 * (Req 2.11) with a `FieldError` on the `pacScript` field.
 *
 * Requirements: 2.10, 2.11
 */
export function validatePacScript(
  input: string | undefined
): ValidationResult<string> {
  if (typeof input !== 'string') {
    return {
      ok: false,
      errors: [{ field: 'pacScript', message: 'PAC 脚本内容为必填项。' }],
    };
  }

  if (input.length < PAC_SCRIPT_MIN_LENGTH || input.length > PAC_SCRIPT_MAX_LENGTH) {
    return {
      ok: false,
      errors: [
        {
          field: 'pacScript',
          message: 'PAC 脚本内容无效，长度必须在 1 到 100000 个字符之间。',
        },
      ],
    };
  }

  // Chromium's `pacScript.data` (inline PAC) only accepts ASCII; any non-ASCII
  // character (e.g. a Chinese comment) makes chrome.proxy.settings.set reject
  // with "'pacScript.data' supports only ASCII code". Catch it here with a clear
  // message instead of surfacing Chromium's cryptic error at apply time.
  // Non-ASCII is allowed via the remote-URL source, which Chromium fetches.
  if (!isAscii(input)) {
    return {
      ok: false,
      errors: [
        {
          field: 'pacScript',
          message:
            '内联 PAC 脚本只能包含 ASCII 字符（Chrome 限制）。请删除中文注释等非 ASCII 字符，或改用「远程 URL」来源。',
        },
      ],
    };
  }

  return { ok: true, value: input };
}

/** Whether every character in the string is ASCII (code point ≤ 0x7F). */
function isAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\x00-\x7F]/.test(value);
}

/**
 * Validate a {@link PacSource} (URL or inline script) submitted when selecting
 * PAC mode. Dispatches to {@link validatePacUrl} / {@link validatePacScript}
 * based on the source kind, and rejects a missing source (Req 2.6).
 *
 * Requirements: 2.4, 2.6, 2.7, 2.10, 2.11
 */
export function validatePacSource(
  source: PacSource | null | undefined
): ValidationResult<PacSource> {
  if (source == null || typeof source !== 'object') {
    return {
      ok: false,
      errors: [{ field: 'pacUrl', message: 'PAC 脚本来源为必填项。' }],
    };
  }

  if (source.kind === 'url') {
    const result = validatePacUrl(source.url);
    return result.ok
      ? { ok: true, value: { kind: 'url', url: result.value } }
      : result;
  }

  if (source.kind === 'inline') {
    const result = validatePacScript(source.script);
    return result.ok
      ? { ok: true, value: { kind: 'inline', script: result.value } }
      : result;
  }

  return {
    ok: false,
    errors: [{ field: 'pacUrl', message: 'PAC 脚本来源无效。' }],
  };
}
const BYPASS_LIST_MAX_ENTRIES = LIMITS.BYPASS_MAX_ENTRIES;

/** Minimum/maximum length of a single Bypass_List entry (Req 4.1, 4.2). */
const BYPASS_ENTRY_MIN_LENGTH = LIMITS.BYPASS_ENTRY_MIN;
const BYPASS_ENTRY_MAX_LENGTH = LIMITS.BYPASS_ENTRY_MAX;

/**
 * Validate a Bypass_List submitted by the user through the Popup_Interface.
 *
 * Accepts the input if and only if:
 * - the list contains at most 100 entries (Req 4.1, 4.2);
 * - every entry is a string of 1–255 characters, with no empty entries
 *   (Req 4.1, 4.2).
 *
 * On failure it returns `ok: false` with a single `FieldError` on the
 * `bypassList` field; the caller is responsible for leaving the previously
 * stored Bypass_List unchanged (Req 4.2).
 *
 * Requirements: 4.1, 4.2
 */
export function validateBypassList(
  entries: string[]
): ValidationResult<string[]> {
  // Too many entries (Req 4.2).
  if (!Array.isArray(entries) || entries.length > BYPASS_LIST_MAX_ENTRIES) {
    return {
      ok: false,
      errors: [
        {
          field: 'bypassList',
          message:
            '绕过列表无效，条目数量不能超过 100 条，且每个条目长度必须在 1 到 255 个字符之间，不能包含空条目。',
        },
      ],
    };
  }

  // Empty entries or entries out of the 1–255 length range (Req 4.2).
  const hasInvalidEntry = entries.some(
    (entry) =>
      typeof entry !== 'string' ||
      entry.length < BYPASS_ENTRY_MIN_LENGTH ||
      entry.length > BYPASS_ENTRY_MAX_LENGTH
  );

  if (hasInvalidEntry) {
    return {
      ok: false,
      errors: [
        {
          field: 'bypassList',
          message:
            '绕过列表无效，条目数量不能超过 100 条，且每个条目长度必须在 1 到 255 个字符之间，不能包含空条目。',
        },
      ],
    };
  }

  return { ok: true, value: entries };
}

/**
 * Determine whether a Proxy_Configuration contains a valid Proxy_Endpoint.
 *
 * Returns `true` if and only if `config.endpoint` is non-null and satisfies
 * the host (1–253 characters), port (integer 1–65535) and protocol
 * (exactly one of SOCKS5/SOCKS4/HTTP/HTTPS) constraints. This is the
 * predicate that gates operations requiring a valid endpoint, namely
 * selecting Fixed_Servers Proxy_Mode and activating the enable control
 * (Req 2.5, 3.1, 3.4).
 *
 * Requirements: 2.5, 3.1, 3.4
 */
export function hasValidEndpoint(config: ProxyConfiguration): boolean {
  const endpoint = config?.endpoint;
  if (endpoint === null || endpoint === undefined) {
    return false;
  }

  const host = typeof endpoint.host === 'string' ? endpoint.host : '';
  if (host.length < HOST_MIN_LENGTH || host.length > HOST_MAX_LENGTH) {
    return false;
  }

  if (parsePort(endpoint.port) === null) {
    return false;
  }

  if (!isValidProtocol(endpoint.protocol)) {
    return false;
  }

  return true;
}
