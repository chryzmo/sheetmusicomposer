import type { SketchDocument } from '../model/document';
import { decodeMeasures } from '../model/validate-music';
import type { Command } from './history';

/** Commit explicit caller-supplied IDs/evidence, not raw recognizer candidates.
 * The input measure tree is validated/copied at construction. This command
 * cannot invent confidence, erase ink, or replace a newer document snapshot.
 * Captured before/after documents follow the immutable document contract.
 */
export function replaceMeasuresCommand(before: SketchDocument, measures: unknown): Command<SketchDocument> {
  const after: SketchDocument = { ...before, measures: decodeMeasures(measures, before.strokes) };
  return {
    label: 'Replace music',
    apply: (document) => {
      if (document !== before) throw new Error('Stale music result: document changed');
      return after;
    },
    revert: (document) => {
      if (document !== after) throw new Error('Cannot undo music out of order');
      return before;
    },
  };
}
