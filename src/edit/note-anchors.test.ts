import { describe, expect, it } from 'vitest';
import type { Stroke } from '../ink/types';
import type { SketchDocument } from '../model/document';
import { noteAnchors, noteAt, pitchName } from './note-anchors';

const stroke = (id: string, pts: [number, number][]): Stroke => ({ id, completion: 'complete',
  points: pts.map(([x, y], t) => ({ x, y, t, pressure: 0.5, tiltX: 0, tiltY: 0 })) });
const base = (events: SketchDocument['measures'] extends readonly (infer M)[] | undefined ? M extends { events: infer E } ? E : never : never,
  strokes: Stroke[]): SketchDocument => ({ strokes, measures: [{ id: 'm', clef: 'treble', timeSignature: '4/4', unresolvedStrokeIds: [], events }] });
const note = (id: string, strokeIds: string[], step: 'E' | 'G' = 'E') => ({ id, kind: 'note' as const, pitch: { step, octave: 4 }, duration: 'quarter' as const,
  dots: 0, accidental: null, strokeIds, confidence: 0.5 });

describe('noteAnchors', () => {
  it('is empty without measures and skips rests', () => {
    expect(noteAnchors({ strokes: [] })).toEqual([]);
    expect(noteAnchors(base([{ id: 'r', kind: 'rest', duration: 'quarter', dots: 0, strokeIds: [], confidence: 0.5 }], []))).toEqual([]);
  });

  it('puts x at the head and y at the written pitch, ignoring the stem', () => {
    const head = stroke('h', [[3.5, 3.5], [4.5, 4.5]]), stem = stroke('s', [[4.4, 1], [4.4, 4]]);
    const [anchor] = noteAnchors(base([note('n', ['h', 's'])], [head, stem]));
    expect(anchor).toEqual({ eventId: 'n', pitch: { step: 'E', octave: 4 }, x: 4, y: 4 });
  });

  it('treats a lone short stroke as the head, and moves y with a corrected pitch', () => {
    const whole = stroke('w', [[9.5, 3.7], [10.5, 4.3]]);
    const [anchor] = noteAnchors(base([note('n', ['w'], 'G')], [whole]));
    expect(anchor).toMatchObject({ x: 10, y: 3 });
    expect(pitchName(anchor!.pitch)).toBe('G4');
  });
});

describe('noteAt', () => {
  const anchors = [{ eventId: 'a', pitch: { step: 'E' as const, octave: 4 }, x: 0, y: 4 }, { eventId: 'b', pitch: { step: 'G' as const, octave: 4 }, x: 1.5, y: 3 }];
  it('picks the nearest note within the radius, else null', () => {
    expect(noteAt(anchors, { x: 0.2, y: 4.1 }, 1)?.eventId).toBe('a');
    expect(noteAt(anchors, { x: 1.2, y: 3.2 }, 1)?.eventId).toBe('b');
    expect(noteAt(anchors, { x: 0.7, y: 3.5 }, 1)?.eventId).toBe('a');
    expect(noteAt(anchors, { x: 5, y: 0 }, 1)).toBeNull();
  });
});
