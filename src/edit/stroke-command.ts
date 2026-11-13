import type { Stroke } from '../ink/types';
import type { SketchDocument } from '../model/document';
import type { Command } from './history';
import { touchedEventIds } from './invalidation';

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
      // New ink invalidates only the kept events it comes near (see
      // touchedEventIds): their sources return to the measure's unresolved
      // list, in capture order, and stay visible. Events elsewhere are kept.
      // The new stroke stays unassigned ink; Undo restores the music.
      const touched = touchedEventIds(document, snapshot);
      const order = new Map(document.strokes.map((s, i) => [s.id, i]));
      const measures = touched.size === 0 ? document.measures : document.measures?.map((m) => {
        const gone = m.events.filter((e) => touched.has(e.id));
        if (gone.length === 0) return m;
        return { ...m, events: m.events.filter((e) => !touched.has(e.id)),
          unresolvedStrokeIds: [...gone.flatMap((e) => e.strokeIds), ...m.unresolvedStrokeIds]
            .sort((a, b) => order.get(a)! - order.get(b)!) };
      });
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
