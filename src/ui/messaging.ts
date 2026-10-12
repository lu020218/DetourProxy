/**
 * Shared messaging layer for the extension UI surfaces (popup + options).
 *
 * Both the compact popup and the full options page talk to the Service Worker
 * using the same request/response protocol and need to read the persisted
 * state from chrome.storage. This module centralises that glue so the two UI
 * controllers stay small and consistent.
 *
 * chrome.* is only touched inside functions, never at import time, so these
 * helpers can be imported under jsdom without a chrome global.
 */
import { deserializeConfiguration } from '../core/serialize.js';
import { STORAGE_KEY } from '../background/storage.js';
import type {
  EndpointInput,
  FieldError,
  ForwardingMode,
  PacSource,
  PersistedState,
  ProxyMode,
  ProxyStatus,
} from '../core/types.js';

/** Requests a UI surface sends to the Service Worker. */
export type Request =
  | { type: 'SAVE_ENDPOINT'; endpoint: EndpointInput }
  | { type: 'SAVE_BYPASS'; entries: string[] }
  | { type: 'SAVE_PAC'; pac: PacSource }
  | { type: 'SET_MODE'; mode: ProxyMode; pac?: PacSource }
  | { type: 'SET_SELECTED_MODE'; mode: ForwardingMode }
  | { type: 'ENABLE' }
  | { type: 'DISABLE' }
  | { type: 'GET_STATUS' };

/** Replies returned by the Service Worker. */
export type Response =
  | { ok: true; status: ProxyStatus }
  | { ok: false; errors: FieldError[]; status: ProxyStatus };

/** Human-readable Chinese labels for each Proxy_Mode. */
export const MODE_LABELS: Record<ProxyMode, string> = {
  Direct: '直连',
  System: '系统代理',
  Fixed_Servers: '固定服务器',
  PAC: '自动配置 (PAC)',
};

/** A safe default status used when the Service Worker cannot be reached. */
export function fallbackStatus(): ProxyStatus {
  return {
    effectiveMode: 'Direct',
    selectedMode: 'Fixed_Servers',
    endpoint: null,
    pac: null,
    errorActive: false,
    errorEndpoint: null,
  };
}

/** First message from a list of FieldErrors, or a generic fallback. */
export function firstMessage(errors: FieldError[]): string {
  return errors[0]?.message ?? '操作失败。';
}

/** Send a request to the Service Worker, resolving to its {@link Response}. */
export function sendRequest(request: Request): Promise<Response> {
  return new Promise<Response>((resolve) => {
    chrome.runtime.sendMessage(request, (response: Response | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError || !response) {
        resolve({
          ok: false,
          errors: [
            {
              field: 'config',
              message: `与后台服务通信失败：${lastError?.message ?? '无响应'}。`,
            },
          ],
          status: fallbackStatus(),
        });
        return;
      }
      resolve(response);
    });
  });
}

/** Read and deserialize the full PersistedState from chrome.storage.local. */
export function readStoredState(): Promise<PersistedState | null> {
  return new Promise<PersistedState | null>((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result: Record<string, unknown>) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const raw = result[STORAGE_KEY];
      if (typeof raw !== 'string') {
        resolve(null);
        return;
      }
      const parsed = deserializeConfiguration(raw);
      resolve(parsed.ok ? parsed.value : null);
    });
  });
}

/**
 * Subscribe to persisted-state changes written by the Service Worker. Invokes
 * `onState` with the freshly deserialized PersistedState whenever it changes,
 * so a UI surface can refresh within 1 second (Req 6.4).
 */
export function subscribeToState(onState: (state: PersistedState) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    const change = changes[STORAGE_KEY];
    if (!change || typeof change.newValue !== 'string') {
      return;
    }
    const parsed = deserializeConfiguration(change.newValue);
    if (parsed.ok) {
      onState(parsed.value);
    }
  });
}

/** Open the full settings (options) page from a UI surface. */
export function openSettingsPage(): void {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    void chrome.tabs?.create({ url: chrome.runtime.getURL('options.html') });
  }
}
