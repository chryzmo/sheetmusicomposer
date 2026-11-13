import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { Stroke } from '../ink/types';
import type { SketchDocument } from '../model/document';
import { createHistory, executeCommand, redo, undo } from './history';
import { touchedEventIds } from './invalidation';
import { addStrokeCommand } from './stroke-command';

const stroke = (id: string, pts: [number, number][]): Stroke => ({ id, completion: 'complete',
  points: pts.map(([x, y], t) => ({ x, y, t, pressure: 0.5, tiltX: 0, tiltY: 0 })) });
const note = (id: string, strokeIds: string[], step: 'E' | 'C' = 'E') => ({ id, kind: 'note' as const, pitch: { step, octave: 4 },
  duration: 'quarter' as const, dots: 0, accidental: null, strokeIds, confidence: 0.5 });
// Two notes: E4 head at x 4 (staff y 4), and a note 10 spaces right.
const document: SketchDocument = {
  strokes: [stroke('a', [[3.5, 3.6], [4.5, 4.4]]), stroke('b', [[13.5, 3.6], [14.5, 4.4]]), stroke('loose', [[30, 1], [31, 1]])],
  measures: [{ id: 'm', clef: 'treble', timeSignature: '4/4', unresolvedStrokeIds: ['loose'], events: [note('n1', ['a']), note('n2', ['b'])] }],
};
const near = (x: number, y = 4) => stroke('new', [[x, y], [x + 0.3, y + 0.2]]);

describe('touchedEventIds', () => {
  it('touches only notes whose padded region the stroke reaches', () => {
    expect([...touchedEventIds(document, near(5.5))]).toEqual(['n1']);
    expect([...touchedEventIds(document, near(14))]).toEqual(['n2']);
    expect([...touchedEventIds(document, near(25))]).toEqual([]);
  });

  it('uses the margin: just inside touches, just outside does not', () => {
    const edge = 4.5 + config.inkInvalidationMargin;
    expect(touchedEventIds(document, near(edge - 0.05)).has('n1')).toBe(true);
    expect(touchedEventIds(document, near(edge + 0.5)).has('n1')).toBe(false);
  });

  it('a long stroke touches every note its box reaches, and a vertical reach counts', () => {
    expect([...touchedEventIds(document, stroke('w', [[3, 4], [15, 4]]))].sort()).toEqual(['n1', 'n2']);
    expect(touchedEventIds(document, near(4, 4.4 + config.inkInvalidationMargin + 0.3)).has('n1')).toBe(false);
    expect(touchedEventIds(document, near(4, 4.4 + config.inkInvalidationMargin - 0.1)).has('n1')).toBe(true);
  });

  it('follows a corrected pitch: the written head position is part of the region', () => {
    // Pitch C4 is staff y 5 but the ink is at y 4; ink near the new head still touches.
    const moved: SketchDocument = { ...document, measures: [{ ...document.measures![0]!, events: [note('n1', ['a'], 'C'), note('n2', ['b'])] }] };
    expect(touchedEventIds(moved, near(4, 5 + 1.4)).has('n1')).toBe(true);
  });

  it('is empty for ink-only documents and for strokes without points', () => {
    expect(touchedEventIds({ strokes: document.strokes }, near(4)).size).toBe(0);
    expect(touchedEventIds(document, stroke('e', [])).size).toBe(0);
  });
});

describe('addStrokeCommand invalidation', () => {
  it('keeps music far from the new ink and undoes/redoes by identity', () => {
    const history = createHistory(document);
    executeCommand(history, addStrokeCommand(near(25)));
    expect(history.document.measures).toBe(document.measures);
    undo(history); expect(history.document).toBe(document);
    redo(history);
  });

  it('moves only the touched note to unresolved, in capture order, keeping the other', () => {
    const history = createHistory(document);
    executeCommand(history, addStrokeCommand(near(5.5)));
    const measure = history.document.measures![0]!;
    expect(measure.events.map((e) => e.id)).toEqual(['n2']);
    expect(measure.unresolvedStrokeIds).toEqual(['a', 'loose']);
    expect(history.document.strokes.map((s) => s.id)).toEqual(['a', 'b', 'loose', 'new']); // ink never lost
    const after = history.document;
    undo(history); expect(history.document).toBe(document);
    redo(history); expect(history.document).toBe(after);
  });
});
