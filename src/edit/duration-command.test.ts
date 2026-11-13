import { describe, expect, it } from 'vitest';
import type { SketchDocument } from '../model/document';
import { nextDuration, setDurationCommand } from './duration-command';
import { createHistory, executeCommand, redo, undo } from './history';

const point = { x: 1, y: 1, t: 0, pressure: 0.5, tiltX: 0, tiltY: 0 };
const document: SketchDocument = {
  strokes: [{ id: 's1', points: [point], completion: 'complete' }, { id: 's2', points: [point], completion: 'complete' }],
  measures: [{ id: 'm', clef: 'treble', timeSignature: '4/4', unresolvedStrokeIds: ['s2'], events: [
    { id: 'n1', kind: 'note', pitch: { step: 'E', octave: 4 }, duration: 'quarter', dots: 0, accidental: null, strokeIds: ['s1'], confidence: 0.4 },
  ] }],
};

describe('nextDuration', () => {
  it('cycles quarter, half, whole, and steps unreadable-so-far values to a quarter', () => {
    expect(nextDuration('quarter')).toBe('half');
    expect(nextDuration('half')).toBe('whole');
    expect(nextDuration('whole')).toBe('quarter');
    expect(nextDuration('eighth')).toBe('quarter');
    expect(nextDuration('sixteenth')).toBe('quarter');
  });
});

describe('setDurationCommand', () => {
  it('changes only the duration and undoes/redoes exactly', () => {
    const history = createHistory(document);
    executeCommand(history, setDurationCommand(document, 'n1', 'half'));
    expect(history.document.measures![0]!.events[0]).toEqual({ ...document.measures![0]!.events[0]!, duration: 'half' });
    expect(history.document.strokes).toBe(document.strokes);
    const after = history.document;
    expect(undo(history)).toBe(true);
    expect(history.document).toBe(document);
    expect(redo(history)).toBe(true);
    expect(history.document).toBe(after);
  });

  it('refuses unknown events, unchanged durations and music-free documents', () => {
    expect(() => setDurationCommand(document, 'nope', 'half')).toThrow('Unknown event');
    expect(() => setDurationCommand(document, 'n1', 'quarter')).toThrow('unchanged');
    expect(() => setDurationCommand({ strokes: document.strokes }, 'n1', 'half')).toThrow('Unknown event');
  });

  it('refuses a stale document and out-of-order undo', () => {
    const command = setDurationCommand(document, 'n1', 'half');
    expect(() => command.apply({ ...document })).toThrow('Stale');
    expect(() => command.revert(document)).toThrow('out of order');
  });
});
