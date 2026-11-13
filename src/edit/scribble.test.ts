import { describe, expect, it } from 'vitest';
import { scribbleBounds, scribbleTargets } from './scribble';

const pts = (list: [number, number][]) => list.map(([x, y]) => ({ x, y }));
/** Horizontal zigzag over [x0,x1], `legs` passes, drifting down across `drop`. */
const zigzag = (x0: number, x1: number, y: number, legs: number, drop = 0.6) =>
  pts(Array.from({ length: legs + 1 }, (_, i): [number, number] => [i % 2 === 0 ? x0 : x1, y + (drop * i) / legs]));
const anchor = (eventId: string, x: number, y: number) => ({ eventId, pitch: { step: 'E' as const, octave: 4 }, x, y });

describe('scribbleBounds', () => {
  it('accepts a back-and-forth scribble and reports its bounds', () => {
    expect(scribbleBounds(zigzag(0, 3, 3.7, 5))).toMatchObject({ left: 0, right: 3 });
  });

  it('rejects straight lines, a single arc and a lone back-and-forth', () => {
    expect(scribbleBounds(pts([[0, 0], [1, 0], [2, 0], [3, 0]]))).toBeNull();
    expect(scribbleBounds(pts([[0, 0], [1.5, 1], [3, 0], [4, -1]]))).toBeNull();
    expect(scribbleBounds(zigzag(0, 3, 4, 2))).toBeNull(); // only two reversals' worth: out and back
  });

  it('rejects a head-sized scribble and jitter on a long line', () => {
    expect(scribbleBounds(zigzag(0, 1.2, 4, 7))).toBeNull(); // a scribbled-in head, below the size floor
    const jitter = pts(Array.from({ length: 40 }, (_, i): [number, number] => [i * 0.1, i % 2 ? 0.02 : 0]));
    expect(scribbleBounds(jitter)).toBeNull();
  });

  it('needs enough points', () => {
    expect(scribbleBounds(pts([[0, 0], [3, 0], [0, 0]]))).toBeNull();
  });

  it('counts vertical scribbles too', () => {
    const vertical = pts([[0, 0], [0.2, 3], [0.4, 0], [0.6, 3], [0.8, 0]]);
    expect(scribbleBounds(vertical)).not.toBeNull();
  });
});

describe('scribbleTargets', () => {
  const scribble = zigzag(3, 6, 3.7, 5);
  it('returns every kept note whose head center the scribble covers', () => {
    const anchors = [anchor('a', 4, 4), anchor('b', 5.5, 4), anchor('far', 12, 4), anchor('above', 4.5, 1)];
    expect(scribbleTargets(scribble, anchors)).toEqual(['a', 'b']);
  });
  it('returns nothing for a non-scribble or no notes', () => {
    expect(scribbleTargets(pts([[3, 4], [4, 4], [5, 4], [6, 4]]), [anchor('a', 4, 4)])).toEqual([]);
    expect(scribbleTargets(scribble, [])).toEqual([]);
  });
});
