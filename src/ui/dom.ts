/**
 * Tiny DOM utilities shared by the popup and options controllers.
 *
 * These are pure helpers operating on plain DOM nodes (no chrome.*), so they
 * are fully exercisable under jsdom.
 */
import type { FieldError } from '../core/types.js';

/** Visual feedback severity used for the *-feedback containers (Req 9.2). */
export type FeedbackKind = 'success' | 'error' | 'info' | 'warning';

/** Query a required element, throwing a clear error when the markup is missing. */
export function required<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector(selector);
  if (found === null) {
    throw new Error(`UI DOM 缺少元素: ${selector}`);
  }
  return found as T;
}

/** Show a message in a container, unhiding it. */
export function showMessage(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.hidden = false;
}

/** Hide and clear a message container. */
export function hideMessage(el: HTMLElement): void {
  el.textContent = '';
  el.hidden = true;
}

/** How long transient positive feedback stays before auto-dismissing (Req 9.2). */
const FEEDBACK_DISMISS_MS = 4000;

/** Per-element auto-dismiss timers, so repeated feedback resets rather than stacks. */
const dismissTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Show operation feedback (success/error/...) in a *-feedback container (Req 9.2).
 *
 * Transient positive feedback (`success` / `info`) auto-dismisses after a few
 * seconds so stale confirmations don't pile up; `error` / `warning` persist
 * until the next action clears them.
 */
export function setFeedback(
  el: HTMLElement,
  message: string,
  kind: FeedbackKind,
): void {
  el.classList.remove('success', 'error', 'info', 'warning');
  el.classList.add(kind);
  showMessage(el, message);

  const existing = dismissTimers.get(el);
  if (existing !== undefined) {
    clearTimeout(existing);
    dismissTimers.delete(el);
  }
  if (kind === 'success' || kind === 'info') {
    const timer = setTimeout(() => {
      hideMessage(el);
      dismissTimers.delete(el);
    }, FEEDBACK_DISMISS_MS);
    dismissTimers.set(el, timer);
  }
}

/**
 * Run an async action while marking a control busy: it is disabled and gets
 * `aria-busy="true"` for the duration, preventing double-submit and signalling
 * "in progress" to assistive tech. The prior disabled state is restored on
 * completion or failure (Req 9.2).
 */
export async function withBusy<T>(
  control: HTMLButtonElement | HTMLInputElement,
  action: () => Promise<T>,
): Promise<T> {
  const wasDisabled = control.disabled;
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  try {
    return await action();
  } finally {
    control.disabled = wasDisabled;
    control.removeAttribute('aria-busy');
  }
}

/** A validation target: the message container and its (optional) control. */
export interface FieldTarget {
  msg: HTMLElement;
  control: HTMLElement | null;
}

/** A mapping from FieldError fields to their DOM targets on a given page. */
export type FieldTargets = Partial<Record<FieldError['field'], FieldTarget>>;

/**
 * Render validation messages next to the relevant controls (Req 9.4). Each
 * offending field's message container is unhidden with the Chinese message and
 * the associated control is marked `aria-invalid="true"`.
 */
export function renderFieldErrors(errors: FieldError[], targets: FieldTargets): void {
  for (const error of errors) {
    const target = targets[error.field];
    if (!target) {
      continue;
    }
    showMessage(target.msg, error.message);
    target.control?.setAttribute('aria-invalid', 'true');
  }
}

/** Hide every validation message and clear `aria-invalid` on every control. */
export function clearFieldErrors(targets: FieldTargets): void {
  for (const key of Object.keys(targets) as FieldError['field'][]) {
    const target = targets[key];
    if (!target) {
      continue;
    }
    hideMessage(target.msg);
    target.control?.removeAttribute('aria-invalid');
  }
}
