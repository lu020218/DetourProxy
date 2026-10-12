/**
 * Toolbar indicator mapping for the browser proxy extension.
 *
 * Pure logic that maps a visual state — one of the four Proxy_Modes plus the
 * "unresolved error" state — to a distinct toolbar indicator descriptor
 * (badge text, badge color and accessible title). The mapping is pairwise
 * distinct so the Direct state is visually distinguishable from every other
 * mode (Req 6.5) and the error state is distinguishable from every normal
 * Proxy_Status (Req 7.4).
 *
 * Requirements: 6.5, 7.4
 */
import type { ProxyMode } from './types.js';

/**
 * A toolbar indicator descriptor rendered onto the extension's
 * chrome.action badge/icon.
 */
export interface ToolbarIndicator {
  /** Short badge text overlaid on the toolbar icon ('' renders no badge). */
  badgeText: string;
  /** Badge background color as a CSS hex string. */
  badgeColor: string;
  /** Accessible title / tooltip describing the current state. */
  title: string;
}

/**
 * Indicator descriptors keyed by normal Proxy_Mode. Each descriptor is
 * pairwise distinct from the others (distinct badgeText, badgeColor and
 * title), so Direct is visually distinguishable from System, Fixed_Servers
 * and PAC (Req 6.5).
 */
const MODE_INDICATORS: Record<ProxyMode, ToolbarIndicator> = {
  Direct: {
    badgeText: '',
    badgeColor: '#9e9e9e',
    title: '直连（不使用代理）',
  },
  System: {
    badgeText: 'SYS',
    badgeColor: '#1976d2',
    title: '使用系统代理设置',
  },
  Fixed_Servers: {
    badgeText: 'ON',
    badgeColor: '#2e7d32',
    title: '通过固定代理服务器转发',
  },
  PAC: {
    badgeText: 'PAC',
    badgeColor: '#6a1b9a',
    title: '使用 PAC 脚本',
  },
};

/**
 * Indicator descriptor for the unresolved-error state. Distinct from every
 * normal mode indicator above so the error state is unambiguous (Req 7.4).
 */
const ERROR_INDICATOR: ToolbarIndicator = {
  badgeText: '!',
  badgeColor: '#c62828',
  title: '代理错误：端点不可达',
};

/**
 * Map a visual state to its toolbar indicator descriptor.
 *
 * When an unresolved proxy error is active, the error indicator takes
 * precedence over the mode indicator and is returned regardless of the
 * current mode, guaranteeing the error state differs from every normal
 * Proxy_Status (Req 7.4). Otherwise the descriptor for the given mode is
 * returned (Req 6.5).
 *
 * @param mode        The current effective Proxy_Mode.
 * @param errorActive Whether an unresolved proxy error currently exists.
 */
export function indicatorFor(
  mode: ProxyMode,
  errorActive: boolean
): ToolbarIndicator {
  if (errorActive) {
    return { ...ERROR_INDICATOR };
  }
  return { ...MODE_INDICATORS[mode] };
}
