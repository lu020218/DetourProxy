import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizeBypassList } from '../src/core/convert.js';
import { DEFAULT_BYPASS_LIST } from '../src/core/constants.js';

describe('normalizeBypassList', () => {
  // Feature: browser-proxy-extension, Property 4: Bypass_List 默认规范化
  it('returns the default list for empty input and the list itself for non-empty valid lists (Req 4.4)', () => {
    // Generator for non-empty, valid Bypass_List entries (1–255 chars, no empty entries).
    const validEntry = fc.string({ minLength: 1, maxLength: 255 });
    const nonEmptyValidList = fc.array(validEntry, { minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(
        fc.oneof(
          // Empty inputs: empty array, or unset (undefined / null).
          fc.constant<string[]>([]),
          fc.constant(undefined as unknown as string[]),
          fc.constant(null as unknown as string[]),
          // Non-empty valid lists.
          nonEmptyValidList,
        ),
        (input) => {
          const result = normalizeBypassList(input);

          if (input == null || input.length === 0) {
            // For any empty input, the default list is applied exactly.
            expect(result).toEqual([...DEFAULT_BYPASS_LIST]);
          } else {
            // For any non-empty valid list, the same contents are returned.
            expect(result).toEqual(input);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
