import { expect, it } from 'vitest';
import { pitchSteps } from '../model/music';
import type { Pitch, PitchStep } from '../model/music';
import { toDocument, toView } from './coordinates';
import { pitchAtStaffY, staffYFromPitch } from './pitch';

const positions: [number, PitchStep, number][] = [
  [0, 'F', 5], [0.5, 'E', 5], [1, 'D', 5], [1.5, 'C', 5],
  [2, 'B', 4], [2.5, 'A', 4], [3, 'G', 4], [3.5, 'F', 4], [4, 'E', 4],
  [4.5, 'D', 4], [5, 'C', 4], [5.5, 'B', 3], [6, 'A', 3],
  [-0.5, 'G', 5], [-1, 'A', 5], [-1.5, 'B', 5], [-2, 'C', 6],
];

it.each(positions)('maps treble staff y=%s to %s%s and back', (y, step, octave) => {
  expect(pitchAtStaffY(y)).toEqual({ step, octave });
  expect(staffYFromPitch({ step, octave })).toBe(y);
});

it.each<[number, PitchStep, number]>([
  [0.249, 'F', 5], [0.25, 'E', 5], [0.251, 'E', 5],
  [-0.249, 'F', 5], [-0.25, 'F', 5], [-0.251, 'G', 5],
  [3.99, 'E', 4], [4.01, 'E', 4],
])('snaps y=%s to %s%s, with exact ties choosing the lower pitch', (y, step, octave) => {
  expect(pitchAtStaffY(y)).toEqual({ step, octave });
});

it('round-trips the entire domain, including octave boundaries and nearby ink', () => {
  for (let octave = 0; octave <= 9; octave++) {
    for (const step of pitchSteps) {
      const pitch = { step, octave };
      const y = staffYFromPitch(pitch);
      for (const offset of [-0.249, 0, 0.249]) expect(pitchAtStaffY(y + offset)).toEqual(pitch);
    }
  }
  expect(staffYFromPitch({ step: 'C', octave: 0 })).toBe(19);
  expect(staffYFromPitch({ step: 'B', octave: 9 })).toBe(-15.5);
});

it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, 19.25, -15.751])('returns no pitch for invalid/out-of-domain staff y=%s instead of clamping', (y) => {
  expect(pitchAtStaffY(y)).toBeNull();
});

it.each([
  { step: 'C', octave: -1 }, { step: 'C', octave: 10 },
  { step: 'C', octave: 4.5 }, { step: 'C', octave: NaN },
  { step: 'H', octave: 4 }, null,
])('rejects invalid pitch in reverse conversion: %j', (value: unknown) => {
  expect(() => staffYFromPitch(value as Pitch)).toThrow(RangeError);
});

it('uses document staff spaces, never pan/zoom/CSS pixels, to read pitch', () => {
  const point = { x: 10, y: 4 };
  for (const view of [
    { offsetX: 0, offsetY: 0, pixelsPerSpace: 18 },
    { offsetX: -100, offsetY: 250, pixelsPerSpace: 72 },
    { offsetX: 900, offsetY: -100, pixelsPerSpace: 2 },
  ]) {
    const restored = toDocument(toView(point, view), view);
    expect(pitchAtStaffY(restored.y)).toEqual({ step: 'E', octave: 4 });
  }
});
