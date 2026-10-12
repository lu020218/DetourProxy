/**
 * Options (settings) page controller.
 *
 * The options page owns all detailed configuration that used to crowd the
 * popup: the Proxy_Endpoint (Req 1), the Bypass_List (Req 4) and the PAC URL
 * (Req 2.4, 2.6, 2.7). Each section validates inline using the Shared Core
 * validators (Req 9.4) and persists via the Service Worker, showing visual
 * feedback for the result (Req 9.2). Enable/disable and mode switching are
 * intentionally NOT here — they live in the compact popup.
 *
 * Build mapping: authored as `src/options/options.ts`; emitted to
 * `dist/src/options/options.js`; packaged alongside `options.html` as
 * `options.js`.
 *
 * Testability: chrome.* is only touched inside event handlers and {@link init}.
 * The pure helpers operate on plain DOM and are exercisable under jsdom.
 */
import { DEFAULT_BYPASS_LIST } from '../core/constants.js';
import {
  validateBypassList,
  validateEndpoint,
  validatePacScript,
  validatePacUrl,
} from '../core/validation.js';
import type {
  EndpointInput,
  FieldError,
  PacSource,
  ProxyEndpoint,
} from '../core/types.js';
import {
  firstMessage,
  readStoredState,
  sendRequest,
} from '../ui/messaging.js';
import {
  clearFieldErrors,
  hideMessage,
  renderFieldErrors,
  required,
  setFeedback,
  withBusy,
  type FieldTargets,
} from '../ui/dom.js';

/** Strongly-typed bundle of the options page's controls and containers. */
export interface OptionsDom {
  hostInput: HTMLInputElement;
  portInput: HTMLInputElement;
  protocolSelect: HTMLSelectElement;
  saveEndpointBtn: HTMLButtonElement;
  hostError: HTMLElement;
  portError: HTMLElement;
  protocolError: HTMLElement;
  endpointFeedback: HTMLElement;
  bypassInput: HTMLTextAreaElement;
  saveBypassBtn: HTMLButtonElement;
  bypassError: HTMLElement;
  bypassFeedback: HTMLElement;
  pacSourceRadios: HTMLInputElement[];
  pacUrlField: HTMLElement;
  pacScriptField: HTMLElement;
  pacUrlInput: HTMLInputElement;
  pacScriptInput: HTMLTextAreaElement;
  savePacBtn: HTMLButtonElement;
  pacError: HTMLElement;
  pacScriptError: HTMLElement;
  pacFeedback: HTMLElement;
}

/** Collect every control and message container the options page operates on. */
export function queryDom(root: ParentNode): OptionsDom {
  return {
    hostInput: required(root, '#host-input'),
    portInput: required(root, '#port-input'),
    protocolSelect: required(root, '#protocol-select'),
    saveEndpointBtn: required(root, '#save-endpoint'),
    hostError: required(root, '#host-error'),
    portError: required(root, '#port-error'),
    protocolError: required(root, '#protocol-error'),
    endpointFeedback: required(root, '#endpoint-feedback'),
    bypassInput: required(root, '#bypass-input'),
    saveBypassBtn: required(root, '#save-bypass'),
    bypassError: required(root, '#bypass-error'),
    bypassFeedback: required(root, '#bypass-feedback'),
    pacSourceRadios: Array.from(
      root.querySelectorAll<HTMLInputElement>('input[name="pac-source"]'),
    ),
    pacUrlField: required(root, '#pac-url-field'),
    pacScriptField: required(root, '#pac-script-field'),
    pacUrlInput: required(root, '#pac-url-input'),
    pacScriptInput: required(root, '#pac-script-input'),
    savePacBtn: required(root, '#save-pac'),
    pacError: required(root, '#pac-error'),
    pacScriptError: required(root, '#pac-script-error'),
    pacFeedback: required(root, '#pac-feedback'),
  };
}

// ---------------------------------------------------------------------------
// Pure rendering / parsing helpers (no chrome.*)
// ---------------------------------------------------------------------------

/** Parse the Bypass_List textarea into trimmed, non-empty entries (one per line). */
export function parseBypassText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Render a Bypass_List back into newline-separated textarea text. */
export function buildBypassDisplay(list: string[]): string {
  return list.join('\n');
}

/** Fill the endpoint controls from the stored Proxy_Endpoint, or clear them (Req 1.6). */
export function renderEndpoint(endpoint: ProxyEndpoint | null, dom: OptionsDom): void {
  if (endpoint) {
    dom.hostInput.value = endpoint.host;
    dom.portInput.value = String(endpoint.port);
    dom.protocolSelect.value = endpoint.protocol;
  } else {
    dom.hostInput.value = '';
    dom.portInput.value = '';
    dom.protocolSelect.selectedIndex = 0;
  }
}

/** Render the Bypass_List textarea, defaulting to localhost/127.0.0.1 when empty (Req 4.5, 4.6). */
export function renderBypass(list: string[] | null | undefined, dom: OptionsDom): void {
  const effective = list && list.length > 0 ? list : [...DEFAULT_BYPASS_LIST];
  dom.bypassInput.value = buildBypassDisplay(effective);
}

/** Show the URL field or the inline-script field according to the source kind. */
export function setPacSourceVisibility(
  kind: 'url' | 'inline',
  dom: OptionsDom,
): void {
  dom.pacUrlField.hidden = kind !== 'url';
  dom.pacScriptField.hidden = kind !== 'inline';
  for (const radio of dom.pacSourceRadios) {
    radio.checked = radio.value === kind;
  }
}

/** Read the currently selected PAC source kind from the radios (defaults to url). */
export function selectedPacSourceKind(dom: OptionsDom): 'url' | 'inline' {
  const checked = dom.pacSourceRadios.find((r) => r.checked);
  return checked?.value === 'inline' ? 'inline' : 'url';
}

/**
 * Render the PAC controls from the stored {@link PacSource}: select the source,
 * fill the matching input, and toggle field visibility. Defaults to the URL
 * source when nothing is stored.
 */
export function renderPac(pac: PacSource | null | undefined, dom: OptionsDom): void {
  if (pac && pac.kind === 'inline') {
    dom.pacScriptInput.value = pac.script;
    dom.pacUrlInput.value = '';
    setPacSourceVisibility('inline', dom);
  } else {
    dom.pacUrlInput.value = pac && pac.kind === 'url' ? pac.url : '';
    dom.pacScriptInput.value = '';
    setPacSourceVisibility('url', dom);
  }
}

/** Field → DOM target mapping for inline validation messages (Req 9.4). */
function fieldTargets(dom: OptionsDom): FieldTargets {
  return {
    host: { msg: dom.hostError, control: dom.hostInput },
    port: { msg: dom.portError, control: dom.portInput },
    protocol: { msg: dom.protocolError, control: dom.protocolSelect },
    bypassList: { msg: dom.bypassError, control: dom.bypassInput },
    pacUrl: { msg: dom.pacError, control: dom.pacUrlInput },
    pacScript: { msg: dom.pacScriptError, control: dom.pacScriptInput },
  };
}

/** Render validation messages next to the relevant controls (Req 9.4). */
export function applyValidationErrors(errors: FieldError[], dom: OptionsDom): void {
  renderFieldErrors(errors, fieldTargets(dom));
}

/** Hide every validation message and clear `aria-invalid` on every control. */
export function clearValidationErrors(dom: OptionsDom): void {
  clearFieldErrors(fieldTargets(dom));
}

// ---------------------------------------------------------------------------
// chrome.*-dependent glue (only reached from init / event handlers)
// ---------------------------------------------------------------------------

/** Save-endpoint handler (Req 1.1–1.5, 9.2, 9.4). */
async function onSaveEndpoint(dom: OptionsDom): Promise<void> {
  clearValidationErrors(dom);
  hideMessage(dom.endpointFeedback);

  const input: EndpointInput = {
    host: dom.hostInput.value,
    port: dom.portInput.value,
    protocol: dom.protocolSelect.value,
  };

  const result = validateEndpoint(input);
  if (!result.ok) {
    applyValidationErrors(result.errors, dom);
    setFeedback(dom.endpointFeedback, '保存失败，请修正输入后重试。', 'error');
    return;
  }

  const response = await sendRequest({ type: 'SAVE_ENDPOINT', endpoint: input });
  if (response.ok) {
    setFeedback(dom.endpointFeedback, '代理端点已保存。', 'success');
  } else {
    applyValidationErrors(response.errors, dom);
    setFeedback(dom.endpointFeedback, firstMessage(response.errors), 'error');
  }
}

/** Save-bypass handler (Req 4.1, 4.2, 9.2, 9.4). */
async function onSaveBypass(dom: OptionsDom): Promise<void> {
  clearValidationErrors(dom);
  hideMessage(dom.bypassFeedback);

  const entries = parseBypassText(dom.bypassInput.value);

  const result = validateBypassList(entries);
  if (!result.ok) {
    applyValidationErrors(result.errors, dom);
    setFeedback(dom.bypassFeedback, '保存失败，请修正绕过列表后重试。', 'error');
    return;
  }

  const response = await sendRequest({ type: 'SAVE_BYPASS', entries });
  if (response.ok) {
    setFeedback(dom.bypassFeedback, '绕过列表已保存。', 'success');
  } else {
    applyValidationErrors(response.errors, dom);
    setFeedback(dom.bypassFeedback, firstMessage(response.errors), 'error');
  }
}

/**
 * Save-PAC handler: validate the selected PAC source (URL or inline script)
 * and STORE it, without changing the live proxy mode (Req 2.4, 2.6, 2.7, 2.10,
 * 2.11, 9.2). Switching to PAC is done from the popup, keeping the options
 * page's three "保存" actions uniformly store-only.
 */
async function onSavePac(dom: OptionsDom): Promise<void> {
  clearValidationErrors(dom);
  hideMessage(dom.pacFeedback);

  const kind = selectedPacSourceKind(dom);

  let pac: PacSource;
  if (kind === 'inline') {
    const result = validatePacScript(dom.pacScriptInput.value);
    if (!result.ok) {
      applyValidationErrors(result.errors, dom);
      setFeedback(dom.pacFeedback, '保存失败，请修正 PAC 脚本内容后重试。', 'error');
      return;
    }
    pac = { kind: 'inline', script: result.value };
  } else {
    const result = validatePacUrl(dom.pacUrlInput.value);
    if (!result.ok) {
      applyValidationErrors(result.errors, dom);
      setFeedback(dom.pacFeedback, '保存失败，请修正 PAC 脚本 URL 后重试。', 'error');
      return;
    }
    pac = { kind: 'url', url: result.value };
  }

  const response = await sendRequest({ type: 'SAVE_PAC', pac });
  if (response.ok) {
    setFeedback(dom.pacFeedback, 'PAC 配置已保存。在弹窗中切换到 PAC 模式即可生效。', 'success');
  } else {
    applyValidationErrors(response.errors, dom);
    setFeedback(dom.pacFeedback, firstMessage(response.errors), 'error');
  }
}

/** Read stored config and render the initial settings view (Req 1.6, 4.5, 4.6). */
async function loadAndRender(dom: OptionsDom): Promise<void> {
  const state = await readStoredState();
  const config = state?.configuration ?? null;
  renderEndpoint(config?.endpoint ?? null, dom);
  renderBypass(config?.bypassList ?? [], dom);
  renderPac(config?.pac ?? null, dom);
}

/** Clear a field's validation message as soon as the user edits it (Req 9.4). */
function bindInputClearing(
  control: HTMLElement,
  message: HTMLElement,
): void {
  control.addEventListener('input', () => {
    hideMessage(message);
    control.removeAttribute('aria-invalid');
  });
}

/** Wire DOM event listeners for the options controls. */
function bindEventHandlers(dom: OptionsDom): void {
  // Each save disables its button while the request is in flight (Req 9.2).
  dom.saveEndpointBtn.addEventListener('click', () =>
    void withBusy(dom.saveEndpointBtn, () => onSaveEndpoint(dom)),
  );
  dom.saveBypassBtn.addEventListener('click', () =>
    void withBusy(dom.saveBypassBtn, () => onSaveBypass(dom)),
  );
  dom.savePacBtn.addEventListener('click', () =>
    void withBusy(dom.savePacBtn, () => onSavePac(dom)),
  );

  // Toggle the URL / inline-script fields when the PAC source changes.
  for (const radio of dom.pacSourceRadios) {
    radio.addEventListener('change', () => {
      setPacSourceVisibility(radio.value === 'inline' ? 'inline' : 'url', dom);
    });
  }

  bindInputClearing(dom.hostInput, dom.hostError);
  bindInputClearing(dom.portInput, dom.portError);
  bindInputClearing(dom.bypassInput, dom.bypassError);
  bindInputClearing(dom.pacUrlInput, dom.pacError);
  bindInputClearing(dom.pacScriptInput, dom.pacScriptError);
}

/** Initialise the options page: query the DOM, bind handlers, render stored config. */
export async function init(): Promise<void> {
  const dom = queryDom(document);
  bindEventHandlers(dom);
  await loadAndRender(dom);
}

// Bootstrap on DOM ready. Registering the listener does not touch chrome.*.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });
}
