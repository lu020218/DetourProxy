/**
 * Shared low-level wrapper around `chrome.proxy.settings.set`.
 *
 * Both the message-driven apply path (`apply.ts`) and the startup-restore path
 * (`restore.ts`) need to write a `chrome.proxy.ProxyConfig` to the regular
 * scope and detect rejection via `chrome.runtime.lastError`. Keeping a single
 * implementation here avoids the two modules duplicating the exact same
 * promisified callback wrapper.
 */

/**
 * Write a `chrome.proxy.ProxyConfig` to the regular scope.
 *
 * Uses the callback form so `chrome.runtime.lastError` can be inspected in the
 * exact context where the API reports rejection; a rejected write becomes a
 * rejected Promise so callers can `try/catch` uniformly.
 */
export function setProxySettings(value: chrome.proxy.ProxyConfig): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.proxy.settings.set({ value, scope: 'regular' }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? 'chrome.proxy.settings.set 失败'));
        return;
      }
      resolve();
    });
  });
}
