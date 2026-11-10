import { describe, expect, it } from 'vitest';
import { toDocument, toView } from './coordinates';

describe('staff-space coordinates', () => {
  const view = { offsetX: 40, offsetY: 120, pixelsPerSpace: 20 };
  it('removes CSS translation and scale, independently of device pixel ratio', () => {
    expect(toDocument({ x: 90, y: 150 }, view)).toEqual({ x: 2.5, y: 1.5 });
  });
  it('round trips ledger-line positions outside the staff', () => {
    const point = { x: 10, y: -2.5 };
    expect(toDocument(toView(point, view), view)).toEqual(point);
  });
  it('keeps document positions aligned under a different view', () => {
    const point = { x: 5, y: 3 };
    const resized = { offsetX: 20, offsetY: 80, pixelsPerSpace: 10 };
    expect(toView(point, resized)).toEqual({ x: 70, y: 110 });
    expect(toDocument(toView(point, resized), resized)).toEqual(point);
  });
  it.each([0, -1, Infinity, NaN])('rejects invalid scale %s', (pixelsPerSpace) => {
    expect(() => toDocument({ x: 0, y: 0 }, { ...view, pixelsPerSpace })).toThrow(RangeError);
    expect(() => toView({ x: 0, y: 0 }, { ...view, pixelsPerSpace })).toThrow(RangeError);
  });
  it('rejects non-finite offsets', () => {
    expect(() => toDocument({ x: 0, y: 0 }, { ...view, offsetX: NaN })).toThrow(RangeError);
  });
});
