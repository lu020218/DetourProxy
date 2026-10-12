import { describe, it, expect } from 'vitest';
import { validatePacScript } from '../src/core/validation.js';

/**
 * Example tests for inline PAC script validation (Req 2.10, 2.11) plus the
 * ASCII-only guard that mirrors Chromium's `pacScript.data` restriction.
 */
describe('validatePacScript', () => {
  it('accepts a valid ASCII inline script', () => {
    const script = 'function FindProxyForURL(url, host) { return "DIRECT"; }';
    const result = validatePacScript(script);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(script);
    }
  });

  it('rejects a non-string / missing script', () => {
    const result = validatePacScript(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].field).toBe('pacScript');
    }
  });

  it('rejects an empty script', () => {
    const result = validatePacScript('');
    expect(result.ok).toBe(false);
  });

  it('rejects a script containing non-ASCII characters (Chromium pacScript.data limit)', () => {
    // The comment is in Chinese — Chromium would reject this at apply time.
    const script =
      'function FindProxyForURL(url, host) { /* 代理 */ return "DIRECT"; }';
    const result = validatePacScript(script);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].field).toBe('pacScript');
      expect(result.errors[0].message).toContain('ASCII');
    }
  });
});
