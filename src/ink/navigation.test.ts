import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { toDocument, toView } from '../staff/coordinates';
import { createNavigationState, endTouch, moveTouch, startTouch, suppressTouches } from './navigation';

const view = { offsetX: 40, offsetY: 100, pixelsPerSpace: 20 };

describe('touch navigation', () => {
  it('pans by CSS-pixel deltas without changing the scale', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 100, y: 100 }, false);
    expect(moveTouch(state, 1, { x: 130, y: 80 }, view)).toEqual({ ...view, offsetX: 70, offsetY: 80 });
  });

  it('anchors pinch zoom to the document point under the moving midpoint', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 100, y: 100 }, false);
    startTouch(state, 2, { x: 200, y: 100 }, false);
    const anchor = toDocument({ x: 150, y: 100 }, view);
    const next = moveTouch(state, 2, { x: 300, y: 100 }, view);
    expect(next.pixelsPerSpace).toBe(40);
    expect(toView(anchor, next)).toEqual({ x: 200, y: 100 });
  });

  it('handles sequential movement from both fingers without compounding error', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 100, y: 100 }, false);
    startTouch(state, 2, { x: 200, y: 100 }, false);
    const next = moveTouch(state, 1, { x: 110, y: 120 }, view);
    const final = moveTouch(state, 2, { x: 210, y: 120 }, next);
    expect(final.pixelsPerSpace).toBeCloseTo(view.pixelsPerSpace);
    expect(final.offsetX).toBeCloseTo(view.offsetX + 10);
    expect(final.offsetY).toBeCloseTo(view.offsetY + 20);
  });

  it('clamps zoom and keeps the pinch anchor stable at the limit', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 0, y: 0 }, false);
    startTouch(state, 2, { x: 100, y: 0 }, false);
    const anchor = toDocument({ x: 50, y: 0 }, view);
    const large = moveTouch(state, 2, { x: 10000, y: 0 }, view);
    expect(large.pixelsPerSpace).toBe(config.maxSpaceSize);
    expect(toView(anchor, large)).toEqual({ x: 5000, y: 0 });
    const small = moveTouch(state, 2, { x: 1, y: 0 }, large);
    expect(small.pixelsPerSpace).toBe(config.minSpaceSize);
    expect(toView(anchor, small).x).toBeCloseTo(0.5);
  });

  it('does not divide by zero for coincident fingers', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 100, y: 100 }, false);
    startTouch(state, 2, { x: 100, y: 100 }, false);
    const next = moveTouch(state, 2, { x: 110, y: 100 }, view);
    expect(next).toEqual({ ...view, offsetX: 45 });
    expect(moveTouch(state, 2, { x: 100, y: 100 }, next).pixelsPerSpace).toBe(view.pixelsPerSpace);
  });

  it('transitions from pinch to pan without a jump when a finger lifts', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 100, y: 100 }, false);
    startTouch(state, 2, { x: 200, y: 100 }, false);
    const next = moveTouch(state, 2, { x: 300, y: 100 }, view);
    endTouch(state, 2);
    expect(moveTouch(state, 1, { x: 100, y: 100 }, next)).toEqual(next);
    expect(moveTouch(state, 1, { x: 110, y: 100 }, next)).toEqual({ ...next, offsetX: next.offsetX + 10 });
  });

  it('ignores third fingers and unknown or ended pointers', () => {
    const state = createNavigationState();
    for (const id of [1, 2, 3]) startTouch(state, id, { x: id * 100, y: 100 }, false);
    expect(moveTouch(state, 3, { x: 400, y: 100 }, view)).toBe(view);
    expect(moveTouch(state, 99, { x: 400, y: 100 }, view)).toBe(view);
    endTouch(state, 1);
    // The remaining pair starts from its current positions, not old history.
    expect(moveTouch(state, 3, { x: 400, y: 100 }, view)).toEqual(view);
    endTouch(state, 3);
    expect(moveTouch(state, 3, { x: 500, y: 100 }, view)).toBe(view);
  });

  it('suppresses existing contacts when the Pencil starts, until they are lifted', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 100, y: 100 }, false);
    suppressTouches(state);
    expect(moveTouch(state, 1, { x: 200, y: 200 }, view)).toBe(view);
    endTouch(state, 1);
    startTouch(state, 1, { x: 200, y: 200 }, false);
    expect(moveTouch(state, 1, { x: 210, y: 200 }, view).offsetX).toBe(50);
  });

  it('suppresses contacts that start during Pencil drawing', () => {
    const state = createNavigationState();
    startTouch(state, 1, { x: 100, y: 100 }, true);
    expect(moveTouch(state, 1, { x: 200, y: 200 }, view)).toBe(view);
    // A fresh deliberate touch after the stroke can pan while the old palm is ignored.
    startTouch(state, 2, { x: 50, y: 50 }, false);
    expect(moveTouch(state, 2, { x: 60, y: 70 }, view)).toEqual({ ...view, offsetX: 50, offsetY: 120 });
  });
});
