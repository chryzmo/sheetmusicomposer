import { describe, expect, it } from 'vitest';
import type { SketchDocument } from '../model/document';
import { deleteEventsCommand } from './delete-command';
import { createHistory, executeCommand, redo, undo } from './history';

const point = { x: 1, y: 1, t: 0, pressure: 0.5, tiltX: 0, tiltY: 0 };
const stroke = (id: string) => ({ id, points: [point], completion: 'complete' as const });
const note = (id: string, strokeIds: string[]) => ({ id, kind: 'note' as const, pitch: { step: 'E' as const, octave: 4 }, duration: 'quarter' as const,
  dots: 0, accidental: null, strokeIds, confidence: 0.4 });
const document: SketchDocument = {
  strokes: ['s1', 's2', 's3', 's4'].map(stroke),
  measures: [{ id: 'm', clef: 'treble', timeSignature: '4/4', unresolvedStrokeIds: ['s4'], events: [note('n1', ['s1', 's2']), note('n2', ['s3'])] }],
};

describe('deleteEventsCommand', () => {
  it('removes events, returns their ink to unresolved in capture order, and undoes exactly', () => {
    const history = createHistory(document);
    executeCommand(history, deleteEventsCommand(document, ['n1']));
    const measure = history.document.measures![0]!;
    expect(measure.events.map((e) => e.id)).toEqual(['n2']);
    expect(measure.unresolvedStrokeIds).toEqual(['s1', 's2', 's4']);
    expect(history.document.strokes).toBe(document.strokes);
    const after = history.document;
    expect(undo(history)).toBe(true);
    expect(history.document).toBe(document);
    expect(redo(history)).toBe(true);
    expect(history.document).toBe(after);
  });

  it('can delete several notes at once', () => {
    const after = deleteEventsCommand(document, ['n2', 'n1']).apply(document);
    expect(after.measures![0]!.events).toEqual([]);
    expect(after.measures![0]!.unresolvedStrokeIds).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('refuses empty, repeated, unknown and music-free requests', () => {
    expect(() => deleteEventsCommand(document, [])).toThrow('distinct');
    expect(() => deleteEventsCommand(document, ['n1', 'n1'])).toThrow('distinct');
    expect(() => deleteEventsCommand(document, ['nope'])).toThrow('Unknown event');
    expect(() => deleteEventsCommand({ strokes: document.strokes }, ['n1'])).toThrow('Unknown event');
  });

  it('refuses a stale document and out-of-order undo', () => {
    const command = deleteEventsCommand(document, ['n1']);
    expect(() => command.apply({ ...document })).toThrow('Stale');
    expect(() => command.revert(document)).toThrow('out of order');
  });
});
