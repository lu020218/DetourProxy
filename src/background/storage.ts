/**
 * Persistence layer for the browser proxy extension.
 *
 * This module is the bridge between the Shared Core's serialization logic and
 * the Chromium Storage_Service (`chrome.storage`). It persists the
 * {@link PersistedState} as a serialized string under a single stable key and
 * exposes a helper to read it back.
 *
 * Writes are wrapped in try/catch and also inspect `chrome.runtime.lastError`.
 * When the Storage_Service rejects a write, the previously stored configuration
 * is left untouched (we never partially write) and a failure result carrying a
 * Chinese message is returned, so the popup can surface a persistence-failure
 * message.
 *
 * Requirements: 5.1, 5.5
 */
import { serializeConfiguration } from '../core/serialize.js';
import type { PersistedState } from '../core/types.js';

/**
 * Stable storage key under which the serialized {@link PersistedState} is kept.
 * Keeping a single key makes reads/writes atomic with respect to the root
 * state and simplifies migrations via `schemaVersion`.
 */
export const STORAGE_KEY = 'browserProxyExtension.persistedState';

/**
 * Result of attempting to persist a {@link PersistedState}.
 *
 * On success `ok` is true. On failure `ok` is false and `message` describes the
 * persistence failure for display to the user (Req 5.5).
 */
export type PersistResult = { ok: true } | { ok: false; message: string };

/**
 * Persist a {@link PersistedState} to the Storage_Service.
 *
 * The state is serialized via the Shared Core and written under
 * {@link STORAGE_KEY}. The write is guarded by try/catch and an explicit
 * `chrome.runtime.lastError` check; if either signals failure, the previously
 * stored configuration is preserved (no write is committed) and a failure
 * result is returned.
 *
 * Requirements: 5.1, 5.5
 */
export async function persistConfiguration(state: PersistedState): Promise<PersistResult> {
  let serialized: string;
  try {
    serialized = serializeConfiguration(state);
  } catch {
    return { ok: false, message: '配置序列化失败，未能持久化，已保留先前已存储的配置。' };
  }

  try {
    await setInStorage({ [STORAGE_KEY]: serialized });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error && error.message ? `：${error.message}` : '。';
    return {
      ok: false,
      message: `持久化配置失败，已保留先前已存储的配置${detail}`,
    };
  }
}

/**
 * Read the raw serialized {@link PersistedState} string from the
 * Storage_Service. Returns `null` when nothing has been stored yet.
 *
 * The returned string is intended to be passed to
 * `deserializeConfiguration` by callers (e.g. startup restore).
 *
 * Requirements: 5.1
 */
export async function readPersistedState(): Promise<string | null> {
  const result = await getFromStorage(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return typeof value === 'string' ? value : null;
}

/**
 * Wrap `chrome.storage.local.set` so that a rejected write (signaled via
 * `chrome.runtime.lastError`) is turned into a rejected Promise. This lets
 * {@link persistConfiguration} catch storage rejections uniformly.
 */
function setInStorage(items: Record<string, string>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? 'storage.set rejected'));
        return;
      }
      resolve();
    });
  });
}

/**
 * Wrap `chrome.storage.local.get` for a single key, surfacing
 * `chrome.runtime.lastError` as a rejected Promise.
 */
function getFromStorage(key: string): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? 'storage.get rejected'));
        return;
      }
      resolve(result);
    });
  });
}
