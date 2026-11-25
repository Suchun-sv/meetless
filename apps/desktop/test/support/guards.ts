import { expect } from 'vitest';
import { DOT_RE } from '@meetless/core';
import { marksBeforeCodes, nonGeometryStyles, wrappingAvatars } from './markup';

export { avatarTextOk, GEOMETRY_STYLE_KEYS, marksBeforeCodes, nonGeometryStyles, wrappingAvatars } from './markup';

/*
 * Page-level markup guards for rendered renderer markup (contract §8, controller ruling 2). Blocks
 * reuse them in their component tests: `guards(name, html)` asserts all four checks.
 */

/** (a) no DOT_RE character, (b) no mark before a need code, (c) no inline style but geometry, (d) avatar text fits its circle. */
export function guards(name: string, html: string): void {
  expect(DOT_RE.test(html), `${name}: dot character`).toBe(false);
  expect(marksBeforeCodes(html), `${name}: mark before a need code`).toEqual([]);
  expect(nonGeometryStyles(html), `${name}: inline style`).toEqual([]);
  expect(wrappingAvatars(html), `${name}: avatar text that does not fit`).toEqual([]);
}
