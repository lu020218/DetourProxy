import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { indicatorFor } from '../src/core/indicator.js';
import type { ToolbarIndicator } from '../src/core/indicator.js';
import type { ProxyMode } from '../src/core/types.js';

const MODES: ProxyMode[] = ['Direct', 'System', 'Fixed_Servers', 'PAC'];

/**
 * A visual state is one of the five distinguishable toolbar states:
 *  - the four normal Proxy_Modes (errorActive = false), or
 *  - the "unresolved error" state (errorActive = true; error takes
 *    precedence over the mode, so any mode collapses to one error state).
 *
 * We label each state so distinct labels denote states that must produce
 * distinct indicator descriptors, while every error-state representation
 * (regardless of underlying mode) shares the same label.
 */
interface VisualState {
  label: string;
  mode: ProxyMode;
  errorActive: boolean;
}

// Generator for an arbitrary visual state. Error states are produced from any
// mode (label collapsed to 'error') since error takes precedence.
const visualStateArb: fc.Arbitrary<VisualState> = fc
  .record({
    mode: fc.constantFrom(...MODES),
    errorActive: fc.boolean(),
  })
  .map(({ mode, errorActive }) => ({
    label: errorActive ? 'error' : mode,
    mode,
    errorActive,
  }));

// Stable serialization of an indicator descriptor for equality comparison.
const serialize = (i: ToolbarIndicator): string => JSON.stringify(i);

describe('indicatorFor (Property 14)', () => {
  // Feature: browser-proxy-extension, Property 14: 工具栏指示器两两可区分
  it('produces pairwise-distinct indicators for distinct visual states; identical states match (Req 6.5, 7.4)', () => {
    fc.assert(
      fc.property(visualStateArb, visualStateArb, (a, b) => {
        const sa = serialize(indicatorFor(a.mode, a.errorActive));
        const sb = serialize(indicatorFor(b.mode, b.errorActive));

        if (a.label === b.label) {
          // Same visual state (including any two error states) => same indicator.
          expect(sa).toBe(sb);
        } else {
          // Different visual states => distinct indicators. This covers
          // Direct differing from every other mode (Req 6.5) and the error
          // state differing from every normal Proxy_Status (Req 7.4).
          expect(sa).not.toBe(sb);
        }
      }),
      { numRuns: 100 },
    );
  });
});
