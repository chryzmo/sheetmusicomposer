import type { Stroke } from '../ink/types';
import type { SketchDocument } from '../model/document';
import type { Command } from './history';

export function addStrokeCommand(stroke: Stroke): Command<SketchDocument> {
  // Snapshot raw samples once at the command boundary. Later capture mutations
  // must not change a completed stroke or its redo result.
  const snapshot: Stroke = { ...stroke, points: stroke.points.map((point) => ({ ...point })) };
  let before: SketchDocument | null = null, after: SketchDocument | null = null;
  return {
    label: 'Add stroke',
    apply: (document) => {
      if (before !== null) {
        if (document !== before) throw new Error('Cannot redo stroke on a changed document');
        return after!;
      }
      if (document.strokes.some((item) => item.id === snapshot.id)) {
        throw new Error(`Stroke ${snapshot.id} already exists`);
      }
      // Without region/gesture interpretation, new ink could alter ANY note.
      // Invalidate music conservatively, preserving all assigned sources as
      // unresolved. The new stroke stays unassigned ink; Undo restores music.
      const order = document.measures === undefined ? null : new Map(document.strokes.map((s, i) => [s.id, i]));
      const measures = document.measures?.map((m) => ({ ...m, events: [],
        unresolvedStrokeIds: [...m.events.flatMap((e) => e.strokeIds), ...m.unresolvedStrokeIds]
          .sort((a, b) => order!.get(a)! - order!.get(b)!),
      }));
      const next: SketchDocument = { ...document, strokes: [...document.strokes, snapshot],
        ...(measures === undefined ? {} : { measures }) };
      before = document; after = next;
      return next;
    },
    revert: (document) => {
      if (document !== after || before === null) throw new Error(`Cannot undo stroke ${snapshot.id} out of order`);
      return before;
    },
  };
}
