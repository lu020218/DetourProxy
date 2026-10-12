import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateBypassList } from '../src/core/validation.js';

/**
 * Property test for `validateBypassList`.
 *
 * The generators intelligently cover the boundaries called out in the design's
 * Testing Strategy: list size 0/100/101, entry length 0/1/255/256, plus
 * whitespace and Unicode characters.
 */

const MAX_ENTRIES = 100;
const ENTRY_MIN = 1;
const ENTRY_MAX = 255;

// --- Oracle: independent re-statement of the spec rule ---

/**
 * A Bypass_List is valid iff it has at most 100 entries and every entry is a
 * string of length 1–255 (no empty entries) (Req 4.1, 4.2).
 */
function bypassListIsValid(entries: string[]): boolean {
  return (
    entries.length <= MAX_ENTRIES &&
    entries.every(
      (entry) =>
        typeof entry === 'string' &&
        entry.length >= ENTRY_MIN &&
        entry.length <= ENTRY_MAX,
    )
  );
}

// --- Generators ---

/**
 * A single Bypass_List entry whose length covers the 0/1/255/256 boundaries
 * and random sizes, built from a mix of ASCII, whitespace and Unicode
 * characters.
 */
const entryArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(
      fc.constantFrom(0, 1, 2, 254, 255, 256, 257),
      fc.integer({ min: 0, max: 300 }),
    ),
    // Pick a fill character: plain ASCII, whitespace, or a Unicode codepoint.
    fc.constantFrom('a', ' ', '\t', '例', '😀', '\u00a0'),
  )
  .map(([len, ch]) => ch.repeat(len));

/**
 * A Bypass_List whose size covers the 0/100/101 boundaries and random sizes.
 */
const bypassListArb: fc.Arbitrary<string[]> = fc
  .oneof(
    fc.constantFrom(0, 1, 99, 100, 101, 102),
    fc.integer({ min: 0, max: 150 }),
  )
  .chain((size) => fc.array(entryArb, { minLength: size, maxLength: size }));

describe('validateBypassList (Property 3)', () => {
  // Feature: browser-proxy-extension, Property 3: Bypass_List 校验
  it('accepts lists with <=100 entries each of length 1-255 and rejects others with a bypassList error', () => {
    fc.assert(
      fc.property(bypassListArb, (entries) => {
        const expectedOk = bypassListIsValid(entries);

        const result = validateBypassList(entries);

        // ok:true iff every entry is a 1–255 char string and count <= 100.
        expect(result.ok).toBe(expectedOk);

        if (result.ok) {
          // The accepted list is returned unchanged.
          expect(result.value).toEqual(entries);
        } else {
          // Rejection must flag the bypassList field (Req 4.2).
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors.every((e) => e.field === 'bypassList')).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
