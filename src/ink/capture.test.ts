import { describe, expect, it } from 'vitest';
import { appendPoints, beginStroke, createInkState, finishStroke } from './capture';
import type { InkPoint } from './types';

const point: InkPoint = { x: 1, y: 2, t: 100, pressure: 0.6, tiltX: 12, tiltY: -4 };

describe('ink capture', () => {
  it.each(['touch', 'mouse', ''])('ignores %s input', (type) => {
    const state = createInkState();
    expect(beginStroke(state, type, 1, 'a', [point])).toBe(false);
    expect(state).toEqual({ active: null });
  });
  it('detaches all samples and metadata after pen up for a document command', () => {
    const state = createInkState();
    expect(beginStroke(state, 'pen', 1, 'a', [point])).toBe(true);
    const next = { ...point, x: 2, t: 110 };
    appendPoints(state, 1, [next]);
    expect(finishStroke(state, 1, 'complete')).toEqual({ id: 'a', points: [point, next], completion: 'complete' });
    expect(state.active).toBeNull();
  });
  it('ignores other pointers and does not replace an active stroke', () => {
    const state = createInkState();
    beginStroke(state, 'pen', 1, 'a', [point]);
    expect(beginStroke(state, 'pen', 2, 'b', [point])).toBe(false);
    expect(appendPoints(state, 2, [point])).toBe(false);
    expect(finishStroke(state, 2, 'complete')).toBeNull();
    expect(state.active?.stroke.points).toHaveLength(1);
    expect(state.active?.stroke.id).toBe('a');
  });
  it('keeps interrupted ink without detaching it twice or mutating earlier ink', () => {
    const state = createInkState();
    beginStroke(state, 'pen', 1, 'a', [point]);
    const first = finishStroke(state, 1, 'complete');
    beginStroke(state, 'pen', 2, 'b', [point]);
    const second = finishStroke(state, 2, 'interrupted');
    expect(finishStroke(state, 2, 'interrupted')).toBeNull();
    expect(first).toEqual({ id: 'a', points: [point], completion: 'complete' });
    expect(second).toEqual({ id: 'b', points: [point], completion: 'interrupted' });
  });
  it('keeps a single-point tap but refuses an empty stroke', () => {
    const state = createInkState();
    expect(beginStroke(state, 'pen', 1, 'a', [])).toBe(false);
    beginStroke(state, 'pen', 1, 'tap', [point]);
    expect(finishStroke(state, 1, 'complete')?.points).toEqual([point]);
  });
});
