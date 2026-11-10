import { describe, expect, it } from 'vitest';
import { staffLines } from './geometry';

describe('staffLines', () => {
  it('produces five lines spaced one staff space apart', () => {
    expect(staffLines(20)).toEqual([
      { x1: 0, x2: 20, y: 0 },
      { x1: 0, x2: 20, y: 1 },
      { x1: 0, x2: 20, y: 2 },
      { x1: 0, x2: 20, y: 3 },
      { x1: 0, x2: 20, y: 4 },
    ]);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid width %s', (width) => {
    expect(() => staffLines(width)).toThrow(RangeError);
  });
});
