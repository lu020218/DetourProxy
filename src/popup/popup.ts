/**
 * Compact popup controller.
 *
 * The popup is the quick-access surface shown when the toolbar icon is clicked.
 * It is deliberately small and focused on three things:
 *   - showing the current Proxy_Status (Req 6.1, 6.2, 6.3, 7.1);
 *   - the master enable/disable switch (Req 3);
 *   - a mode quick-switch (Req 2, 9.3).
 *
 * All detailed configuration (endpoint, bypass list, PAC URL) lives on the
 * separate options page, opened via the "设置" buttons. Switching to a mode
 * whose configuration is missing (Fixed_Servers without an endpoint, PAC
 * without a URL) is rejected by the Service Worker and surfaced here with a
 * hint to open settings (Req 2.5, 3.4).
 *
 * Build mapping: authored as `src/popup/popup.ts`; emitted to
 * `dist/src/popup/popup.js`; packaged alongside `popup.html` as `popup.js`.
 *
 * Testability: chrome.* is only touched inside event handlers and {@link init}.
 * The pure helpers (queryDom, renderStatus, highlightMode, applyValidationErrors,
 * clearValidationErrors) operate on plain DOM and are exercisable under jsdom.
 */
import type {
  FieldError,
  ForwardingMode,
  PacSource,
  ProxyMode,
  ProxyStatus,
} from '../core/types.js';
import {
  MODE_LABELS,
  firstMessage,
  openSettingsPage,
  readStoredState,
  sendRequest,
  subscribeToState,
} from '../ui/messaging.js';
import {
  clearFieldErrors,
  hideMessage,
  renderFieldErrors,
  required,
  setFeedback,
  showMessage,
  withBusy,
  type FieldTargets,
} from '../ui/dom.js';

/** Strongly-typed bundle of the popup's controls and message containers. */
export interface PopupDom {
  modeRadios: HTMLInputElement[];
  modeError: HTMLElement;
  enableToggle: HTMLInputElement;
  toggleFeedback: HTMLElement;
  statusIndicator: HTMLElement;
  statusStateText: HTMLElement;
  statusMode: HTMLElement;
  statusEndpoint: HTMLElement;
  statusPac: HTMLElement;
  statusPacTerm: HTMLElement;
  statusEndpointRow: HTMLElement;
  statusPacRow: HTMLElement;
  statusError: HTMLElement;
  openSettingsButtons: HTMLElement[];
}

/** Collect every control and message container the popup operates on. */
export function queryDom(root: ParentNode): PopupDom {
  const openSettingsButtons = Array.from(
    root.querySelectorAll<HTMLElement>('#open-settings, #open-settings-link'),
  );
  return {
    modeRadios: Array.from(
      root.querySelectorAll<HTMLInputElement>('input[name="proxy-mode"]'),
    ),
    modeError: required(root, '#mode-error'),
    enableToggle: required(root, '#enable-toggle'),
    toggleFeedback: required(root, '#toggle-feedback'),
    statusIndicator: required(root, '#status-indicator'),
    statusStateText: required(root, '#status-state-text'),
    statusMode: required(root, '#status-mode'),
    statusEndpoint: required(root, '#status-endpoint'),
    statusPac: required(root, '#status-pac'),
    statusPacTerm: required(root, '#status-pac-term'),
    statusEndpointRow: required(root, '#status-endpoint-row'),
    statusPacRow: required(root, '#status-pac-row'),
    statusError: required(root, '#status-error'),
    openSettingsButtons,
  };
}

/** Config-level errors surface next to the mode controls (Req 2.5, 3.4, 9.4). */
function fieldTargets(dom: PopupDom): FieldTargets {
  return { config: { msg: dom.modeError, control: null } };
}

/** Render config-level validation/hint messages (Req 9.4). */
export function applyValidationErrors(errors: FieldError[], dom: PopupDom): void {
  renderFieldErrors(errors, fieldTargets(dom));
}

/** Clear config-level validation/hint messages. */
export function clearValidationErrors(dom: PopupDom): void {
  clearFieldErrors(fieldTargets(dom));
}

/**
 * Highlight the supplied Proxy_Mode as the *active* (currently routing) option:
 * a filled style plus the checked radio (Req 9.3). Used while the proxy is
 * enabled, where the highlighted mode is the one actually in effect.
 */
export function highlightMode(mode: ProxyMode, dom: PopupDom): void {
  for (const radio of dom.modeRadios) {
    const isActive = radio.value === mode;
    radio.checked = isActive;
    const label = radio.closest('.mode-option');
    if (label) {
      label.classList.toggle('active', isActive);
      label.classList.remove('selected');
      label.setAttribute('aria-checked', String(isActive));
    }
  }
}

/**
 * Mark the supplied forwarding mode as *selected-but-pending*: an outline style
 * distinct from the active fill, shown while the proxy is disabled so the user
 * sees which mode the master switch will turn on without it looking already
 * active (Req 9.3).
 *
 * No radio is left checked, so the shared `.mode-option:has(input:checked)`
 * fill (used by the options PAC-source selector) does not paint the pending
 * mode as active here.
 */
export function selectMode(mode: ForwardingMode, dom: PopupDom): void {
  for (const radio of dom.modeRadios) {
    const isSelected = radio.value === mode;
    radio.checked = false;
    const label = radio.closest('.mode-option');
    if (label) {
      label.classList.toggle('selected', isSelected);
      label.classList.remove('active');
      label.setAttribute('aria-checked', 'false');
    }
  }
}

/**
 * Render the Proxy_Status: the on/off pill, state text, current mode, the
 * endpoint/PAC summary rows, and any unresolved-error message. Also reconciles
 * the enable switch and the mode highlight (Req 6.1–6.3, 7.1, 9.3).
 */
export function renderStatus(status: ProxyStatus, dom: PopupDom): void {
  const enabled = status.effectiveMode !== 'Direct';

  // On/off pill + state text.
  dom.statusIndicator.classList.toggle('active', enabled && !status.errorActive);
  dom.statusIndicator.classList.toggle('error', status.errorActive);
  dom.statusStateText.textContent = status.errorActive
    ? '代理错误'
    : enabled
      ? '已启用'
      : '已禁用';

  // Master switch reflects whether a forwarding mode is active.
  dom.enableToggle.checked = enabled;
  dom.enableToggle.setAttribute('aria-checked', String(enabled));

  // Current mode label.
  dom.statusMode.textContent = MODE_LABELS[status.effectiveMode] ?? status.effectiveMode;

  // Endpoint row (Fixed_Servers only).
  if (status.endpoint) {
    dom.statusEndpoint.textContent = `${status.endpoint.host}:${status.endpoint.port} (${status.endpoint.protocol})`;
    dom.statusEndpointRow.hidden = false;
  } else {
    dom.statusEndpoint.textContent = '—';
    dom.statusEndpointRow.hidden = true;
  }

  // PAC row (PAC only). The term label tracks the source kind so it never reads
  // "PAC URL" while the value shows an inline script.
  if (status.pac) {
    if (status.pac.kind === 'url') {
      dom.statusPacTerm.textContent = 'PAC URL';
      dom.statusPac.textContent = status.pac.url;
    } else {
      dom.statusPacTerm.textContent = 'PAC 内联脚本';
      dom.statusPac.textContent = '内联脚本';
    }
    dom.statusPacRow.hidden = false;
  } else {
    dom.statusPacTerm.textContent = 'PAC 来源';
    dom.statusPac.textContent = '—';
    dom.statusPacRow.hidden = true;
  }

  // Unresolved proxy error (Req 7.1).
  if (status.errorActive && status.errorEndpoint) {
    showMessage(
      dom.statusError,
      `代理端点 ${status.errorEndpoint.host}:${status.errorEndpoint.port} 不可达，浏览器无法通过该端点转发流量。`,
    );
  } else {
    hideMessage(dom.statusError);
  }

  // Mode highlight distinguishes "currently routing" from "selected, pending":
  // - enabled  → the effective mode gets the filled ACTIVE style;
  // - disabled → the selected forwarding mode gets the outline SELECTED style,
  //   so it stays visible (Req 9.3) without looking like the proxy is on.
  if (enabled) {
    highlightMode(status.effectiveMode, dom);
  } else {
    const selected: ForwardingMode = status.selectedMode ?? 'Fixed_Servers';
    selectMode(selected, dom);
  }
}

// ---------------------------------------------------------------------------
// chrome.*-dependent glue (only reached from init / event handlers)
// ---------------------------------------------------------------------------

/** Append a "打开设置" hint to a config message so the user knows where to go. */
function withSettingsHint(message: string): string {
  return `${message}（点击“高级设置”进行配置）`;
}

/**
 * Mode selector handler (Req 2, 9.3).
 *
 * The master switch is the single on/off control (model 1A). So:
 * - while DISABLED, picking a mode only records the pending selection
 *   (SET_SELECTED_MODE) and the proxy stays off;
 * - while ENABLED, picking a mode switches the live route immediately
 *   (SET_MODE), gated on the mode's prerequisites.
 *
 * The highlight is driven by `renderStatus` from the authoritative reply, not
 * optimistically, so a rejected/pending switch never flashes the wrong mode.
 */
async function onModeChange(mode: ProxyMode, dom: PopupDom): Promise<void> {
  clearValidationErrors(dom);
  hideMessage(dom.toggleFeedback);

  // While off, the selector is just a pre-selection for the enable switch.
  if (!dom.enableToggle.checked) {
    const response = await sendRequest({
      type: 'SET_SELECTED_MODE',
      mode: mode as ForwardingMode,
    });
    if (!response.ok) {
      applyValidationErrors(
        [{ field: 'config', message: firstMessage(response.errors) }],
        dom,
      );
    }
    renderStatus(response.status, dom);
    return;
  }

  // Enabled: switch the live mode now.
  let pac: PacSource | undefined;
  if (mode === 'PAC') {
    // PAC needs a stored source (configured on the options page). Send it
    // along; if none is stored, prompt the user to configure it in settings.
    const state = await readStoredState();
    pac = state?.configuration.pac ?? undefined;
    if (!pac) {
      applyValidationErrors(
        [{ field: 'config', message: withSettingsHint('尚未配置 PAC 脚本来源。') }],
        dom,
      );
      const status = await sendRequest({ type: 'GET_STATUS' });
      renderStatus(status.status, dom);
      return;
    }
  }

  const response = await sendRequest({ type: 'SET_MODE', mode, pac });
  if (!response.ok) {
    // e.g. Fixed_Servers without an endpoint (Req 2.5) — hint towards settings.
    const msg = response.errors[0]?.message ?? '切换失败。';
    applyValidationErrors([{ field: 'config', message: withSettingsHint(msg) }], dom);
  }
  renderStatus(response.status, dom);
}

/** Enable/disable master switch handler (Req 3.1, 3.2, 3.4, 9.2). */
async function onToggle(dom: PopupDom): Promise<void> {
  clearValidationErrors(dom);
  hideMessage(dom.toggleFeedback);

  const enable = dom.enableToggle.checked;
  const response = await sendRequest({ type: enable ? 'ENABLE' : 'DISABLE' });

  if (response.ok) {
    setFeedback(dom.toggleFeedback, enable ? '代理已启用。' : '代理已禁用。', 'success');
  } else {
    // e.g. enabling without a valid Proxy_Configuration (Req 3.4).
    applyValidationErrors(
      [{ field: 'config', message: withSettingsHint(firstMessage(response.errors)) }],
      dom,
    );
    setFeedback(dom.toggleFeedback, firstMessage(response.errors), 'error');
  }

  renderStatus(response.status, dom);
}

/** Read current status and render the initial popup view (Req 6.1). */
async function loadAndRender(dom: PopupDom): Promise<void> {
  const response = await sendRequest({ type: 'GET_STATUS' });
  renderStatus(response.status, dom);
  if (!response.ok) {
    showMessage(dom.statusError, firstMessage(response.errors));
  }
}

/** Wire DOM event listeners for the popup controls. */
function bindEventHandlers(dom: PopupDom): void {
  for (const radio of dom.modeRadios) {
    radio.addEventListener('change', () => {
      void withBusy(radio, () => onModeChange(radio.value as ProxyMode, dom));
    });
  }
  dom.enableToggle.addEventListener('change', () =>
    void withBusy(dom.enableToggle, () => onToggle(dom)),
  );
  for (const btn of dom.openSettingsButtons) {
    btn.addEventListener('click', () => openSettingsPage());
  }
}

/**
 * Initialise the popup: query the DOM, bind handlers, render the initial status
 * and subscribe to state changes so the view stays fresh within 1s (Req 6.4).
 */
export async function init(): Promise<void> {
  const dom = queryDom(document);
  bindEventHandlers(dom);
  // On any persisted-state change, re-query the authoritative status from the
  // Service Worker rather than rebuilding it locally. Rebuilding here forced
  // errorActive=false, which would momentarily wipe an active "endpoint
  // unreachable" message on every unrelated storage write (Req 6.4, 7.1).
  subscribeToState(() => {
    void loadAndRender(dom);
  });
  await loadAndRender(dom);
}

// Bootstrap on DOM ready. Registering the listener does not touch chrome.*.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });
}
