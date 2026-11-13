import { describe, expect, it } from 'vitest';
import type { SketchDocument } from '../model/document';
import { createHistory, executeCommand, redo, undo } from './history';
import { repitchCommand } from './repitch-command';

const point = { x: 1, y: 1, t: 0, pressure: 0.5, tiltX: 0, tiltY: 0 };
const document: SketchDocument = {
  strokes: [{ id: 's1', points: [point], completion: 'complete' }, { id: 's2', points: [point], completion: 'complete' }, { id: 's3', points: [point], completion: 'complete' }],
  measures: [{ id: 'm', clef: 'treble', timeSignature: '4/4', unresolvedStrokeIds: ['s2'], events: [
    { id: 'n1', kind: 'note', pitch: { step: 'E', octave: 4 }, duration: 'quarter', dots: 0, accidental: null, strokeIds: ['s1'], confidence: 0.4 },
    { id: 'r1', kind: 'rest', duration: 'quarter', dots: 0, strokeIds: ['s3'], confidence: 0.4 },
  ] }],
};

describe('repitchCommand', () => {
  it('changes only the pitch and undoes/redoes exactly', () => {
    const history = createHistory(document);
    executeCommand(history, repitchCommand(document, 'n1', { step: 'G', octave: 4 }));
    const event = history.document.measures![0]!.events[0]!;
    expect(event).toEqual({ ...document.measures![0]!.events[0]!, pitch: { step: 'G', octave: 4 } });
    expect(history.document.strokes).toBe(document.strokes);
    expect(history.document.measures![0]!.unresolvedStrokeIds).toEqual(['s2']);
    const after = history.document;
    expect(undo(history)).toBe(true);
    expect(history.document).toBe(document);
    expect(redo(history)).toBe(true);
    expect(history.document).toBe(after);
  });

  it('refuses unknown notes, rests, unchanged and out-of-domain pitches', () => {
    expect(() => repitchCommand(document, 'nope', { step: 'G', octave: 4 })).toThrow('Unknown note');
    expect(() => repitchCommand(document, 'r1', { step: 'G', octave: 4 })).toThrow('Only notes');
    expect(() => repitchCommand(document, 'n1', { step: 'E', octave: 4 })).toThrow('unchanged');
    expect(() => repitchCommand(document, 'n1', { step: 'E', octave: 12 })).toThrow();
    expect(() => repitchCommand({ strokes: document.strokes }, 'n1', { step: 'G', octave: 4 })).toThrow('Unknown note');
  });

  it('refuses a stale document and out-of-order undo', () => {
    const command = repitchCommand(document, 'n1', { step: 'G', octave: 4 });
    expect(() => command.apply({ ...document })).toThrow('Stale');
    expect(() => command.revert(document)).toThrow('out of order');
  });
});
