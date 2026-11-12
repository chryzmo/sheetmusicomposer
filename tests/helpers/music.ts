import type { SketchDocument } from '../../src/model/document';
import type { Stroke } from '../../src/ink/types';

/** Authored schema/command test data, NOT recognition or calibrated evidence. */
export function testStroke(id: string, completion: Stroke['completion'] = 'complete'): Stroke {
  return { id, completion, points: [
    { x: 4, y: 5, t: 100, pressure: 0.7, tiltX: 10, tiltY: -20 },
    { x: 4.5, y: 4.8, t: 0, pressure: 0, tiltX: -10, tiltY: 20 },
  ] };
}
export function musicalDocument(): SketchDocument {
  return { strokes: [testStroke('h'), testStroke('s'), testStroke('u', 'interrupted'), testStroke('r'), testStroke('loose')], measures: [
    { id: 'm1', clef: 'treble', timeSignature: '3/4', events: [
      { id: 'n1', kind: 'note', pitch: { step: 'C', octave: 4 }, duration: 'half', dots: 1,
        accidental: 'natural', confidence: 0.42, strokeIds: ['h', 's'] },
    ], unresolvedStrokeIds: ['u'] },
    { id: 'm2', clef: 'treble', timeSignature: '4/4', events: [
      { id: 'r1', kind: 'rest', duration: 'whole', dots: 0, confidence: 0, strokeIds: ['r'] },
    ], unresolvedStrokeIds: [] },
  ] };
}
