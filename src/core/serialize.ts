/**
 * Serialization / deserialization for the persisted root state.
 *
 * `serializeConfiguration` converts a {@link PersistedState} into the JSON
 * string stored in chrome.storage. `deserializeConfiguration` parses such a
 * string back into a {@link PersistedState}, returning `ok:false` for any
 * input that cannot be parsed or that fails structural validation. This is
 * the basis for falling back to Direct Proxy_Mode on corrupt configuration.
 *
 * Requirements: 5.1, 5.4
 */
import { LIMITS } from './constants.js';
import type {
  FieldError,
  ForwardingMode,
  PacSource,
  PersistedState,
  Protocol,
  ProxyConfiguration,
  ProxyEndpoint,
  ProxyMode,
  ValidationResult,
} from './types.js';

const VALID_PROTOCOLS: readonly Protocol[] = ['SOCKS5', 'SOCKS4', 'HTTP', 'HTTPS'];
const VALID_MODES: readonly ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];
const VALID_FORWARDING_MODES: readonly ForwardingMode[] = [
  'System',
  'Fixed_Servers',
  'PAC',
];

// Field bounds are shared with the input validators via core/constants.ts so
// the two modules never drift apart.
const {
  HOST_MIN,
  HOST_MAX,
  PORT_MIN,
  PORT_MAX,
  BYPASS_MAX_ENTRIES,
  BYPASS_ENTRY_MIN,
  BYPASS_ENTRY_MAX,
  PAC_URL_MIN,
  PAC_URL_MAX,
  PAC_SCRIPT_MIN,
  PAC_SCRIPT_MAX,
} = LIMITS;

/**
 * Serialize a PersistedState to its JSON string representation.
 * Requirements: 5.1
 */
export function serializeConfiguration(config: PersistedState): string {
  return JSON.stringify(config);
}

/**
 * Deserialize a raw string into a PersistedState.
 *
 * Returns `ok:false` when the string is not valid JSON or when the parsed
 * value does not match the expected PersistedState structure (schemaVersion,
 * configuration shape, a valid ProxyMode, a boolean enabled flag, and valid
 * endpoint/bypassList/pacUrl shapes).
 *
 * Requirements: 5.1, 5.4
 */
export function deserializeConfiguration(raw: string): ValidationResult<PersistedState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('已存储的配置无法解析（非法 JSON），已视为无效。');
  }

  if (!isObject(parsed)) {
    return fail('已存储的配置结构无效。');
  }

  // schemaVersion: finite number
  if (typeof parsed.schemaVersion !== 'number' || !Number.isFinite(parsed.schemaVersion)) {
    return fail('已存储的配置缺少有效的 schemaVersion。');
  }

  // enabled: boolean
  if (typeof parsed.enabled !== 'boolean') {
    return fail('已存储的配置缺少有效的 enabled 标志。');
  }

  // effectiveMode: a valid ProxyMode
  if (!isProxyMode(parsed.effectiveMode)) {
    return fail('已存储的配置包含无效的 Proxy_Mode。');
  }

  // configuration: must be a structurally valid ProxyConfiguration
  const configResult = parseConfiguration(parsed.configuration);
  if (!configResult.ok) {
    return configResult;
  }

  // selectedMode: a forwarding mode the user chose for the enable switch.
  // Tolerate legacy/missing values by deriving a sensible default so older
  // stored states still load instead of being discarded.
  const selectedMode = isForwardingMode(parsed.selectedMode)
    ? parsed.selectedMode
    : parsed.effectiveMode !== 'Direct'
      ? parsed.effectiveMode
      : 'Fixed_Servers';

  const state: PersistedState = {
    schemaVersion: parsed.schemaVersion,
    configuration: configResult.value,
    effectiveMode: parsed.effectiveMode,
    selectedMode,
    enabled: parsed.enabled,
  };
  return { ok: true, value: state };
}

/** Validate the configuration sub-object structurally. */
function parseConfiguration(raw: unknown): ValidationResult<ProxyConfiguration> {
  if (!isObject(raw)) {
    return fail('已存储的配置缺少有效的 configuration 对象。');
  }

  // endpoint: null or a valid ProxyEndpoint
  let endpoint: ProxyEndpoint | null;
  if (raw.endpoint === null) {
    endpoint = null;
  } else {
    const endpointResult = parseEndpoint(raw.endpoint);
    if (!endpointResult.ok) {
      return endpointResult;
    }
    endpoint = endpointResult.value;
  }

  // bypassList: array of valid entries
  if (!Array.isArray(raw.bypassList)) {
    return fail('已存储的 Bypass_List 结构无效。');
  }
  if (raw.bypassList.length > BYPASS_MAX_ENTRIES) {
    return fail('已存储的 Bypass_List 条目数量超过上限。');
  }
  for (const entry of raw.bypassList) {
    if (
      typeof entry !== 'string' ||
      entry.length < BYPASS_ENTRY_MIN ||
      entry.length > BYPASS_ENTRY_MAX
    ) {
      return fail('已存储的 Bypass_List 包含无效条目。');
    }
  }
  const bypassList: string[] = [...raw.bypassList];

  // pac: null or a valid PacSource (url 1–2048 / inline script 1–100000)
  let pac: PacSource | null;
  if (raw.pac === null || raw.pac === undefined) {
    pac = null;
  } else {
    const pacResult = parsePacSource(raw.pac);
    if (!pacResult.ok) {
      return pacResult;
    }
    pac = pacResult.value;
  }

  return { ok: true, value: { endpoint, bypassList, pac } };
}

/** Validate the PAC source sub-object structurally (Req 2.4, 2.7, 2.10). */
function parsePacSource(raw: unknown): ValidationResult<PacSource> {
  if (!isObject(raw)) {
    return fail('已存储的 PAC 来源结构无效。');
  }

  if (raw.kind === 'url') {
    if (
      typeof raw.url === 'string' &&
      raw.url.length >= PAC_URL_MIN &&
      raw.url.length <= PAC_URL_MAX
    ) {
      return { ok: true, value: { kind: 'url', url: raw.url } };
    }
    return fail('已存储的 PAC 脚本 URL 无效。');
  }

  if (raw.kind === 'inline') {
    if (
      typeof raw.script === 'string' &&
      raw.script.length >= PAC_SCRIPT_MIN &&
      raw.script.length <= PAC_SCRIPT_MAX
    ) {
      return { ok: true, value: { kind: 'inline', script: raw.script } };
    }
    return fail('已存储的内联 PAC 脚本无效。');
  }

  return fail('已存储的 PAC 来源类型无效。');
}

/** Validate the endpoint sub-object structurally (Req 1.1–1.5). */
function parseEndpoint(raw: unknown): ValidationResult<ProxyEndpoint> {
  if (!isObject(raw)) {
    return fail('已存储的 Proxy_Endpoint 结构无效。');
  }

  if (
    typeof raw.host !== 'string' ||
    raw.host.length < HOST_MIN ||
    raw.host.length > HOST_MAX
  ) {
    return fail('已存储的 Proxy_Endpoint 主机地址无效。');
  }

  if (
    typeof raw.port !== 'number' ||
    !Number.isInteger(raw.port) ||
    raw.port < PORT_MIN ||
    raw.port > PORT_MAX
  ) {
    return fail('已存储的 Proxy_Endpoint 端口号无效。');
  }

  if (!isProtocol(raw.protocol)) {
    return fail('已存储的 Proxy_Endpoint 协议无效。');
  }

  return {
    ok: true,
    value: { host: raw.host, port: raw.port, protocol: raw.protocol },
  };
}

/** Build a uniform structural-validation failure result. */
function fail(message: string): ValidationResult<never> {
  const error: FieldError = { field: 'config', message };
  return { ok: false, errors: [error] };
}

/** Narrow an unknown value to a plain (non-array, non-null) object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProxyMode(value: unknown): value is ProxyMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value);
}

function isForwardingMode(value: unknown): value is ForwardingMode {
  return (
    typeof value === 'string' &&
    (VALID_FORWARDING_MODES as readonly string[]).includes(value)
  );
}

function isProtocol(value: unknown): value is Protocol {
  return typeof value === 'string' && (VALID_PROTOCOLS as readonly string[]).includes(value);
}
