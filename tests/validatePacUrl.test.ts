import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePacUrl } from '../src/core/validation.js';

/**
 * Property test for `validatePacUrl`.
 *
 * The generators intelligently cover the boundaries called out in the design's
 * Testing Strategy: PAC URL length 0/1/2048/2049, plus `undefined` (the
 * "not provided" case, Req 2.6).
 */

const PAC_URL_MIN = 1;
const PAC_URL_MAX = 2048;

// --- Oracle: independent re-statement of the spec rule ---

/** A PAC URL is valid iff it is a string of length 1–2048. */
function pacUrlIsValid(input: string | undefined): boolean {
  return (
    typeof input === 'string' &&
    input.length >= PAC_URL_MIN &&
    input.length <= PAC_URL_MAX
  );
}

// --- Generator ---

/**
 * A PAC URL input covering the length boundaries 0/1/2048/2049, a spread of
 * random lengths, and the `undefined` (not-provided) case.
 */
const pacUrlArb: fc.Arbitrary<string | undefined> = fc.oneof(
  // Boundary and random lengths, materialised as strings of that length.
  fc
    .oneof(
      fc.constantFrom(0, 1, 2, 2047, 2048, 2049, 2050),
      fc.integer({ min: 0, max: 2100 }),
    )
    .map((len) => 'a'.repeat(len)),
  // Arbitrary-content strings (may include unicode/whitespace).
  fc.string({ maxLength: 2100 }),
  // The not-provided case.
  fc.constant(undefined),
);

describe('validatePacUrl (Property 2)', () => {
  // Feature: browser-proxy-extension, Property 2: PAC URL 校验
  it('accepts strings of length 1–2048 and rejects empty/undefined/over-length with a pacUrl error', () => {
    fc.assert(
      fc.property(pacUrlArb, (input) => {
        const expectedOk = pacUrlIsValid(input);

        const result = validatePacUrl(input);

        // ok:true iff the input is a string of length 1–2048.
        expect(result.ok).toBe(expectedOk);

        if (result.ok) {
          // The accepted value is returned unchanged.
          expect(result.value).toBe(input);
        } else {
          // Rejection must flag the pacUrl field (Req 2.6, 2.7).
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors.every((e) => e.field === 'pacUrl')).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
