import type { SketchDocument } from '../model/document';
import { decodeMeasures } from '../model/validate-music';
import type { Command } from './history';

/** Remove kept events. Their ink is never deleted: every stroke a removed event
 * used returns to its measure's unresolved list, in original capture order, so
 * it stays visible. Validated like every other music write and tied to the
 * exact document it was built from, so undo/redo cannot apply out of order.
 */
export function deleteEventsCommand(before: SketchDocument, eventIds: readonly string[]): Command<SketchDocument> {
  const remove = new Set(eventIds);
  if (remove.size === 0 || remove.size !== eventIds.length) throw new Error('Expected distinct events to delete');
  const order = new Map(before.strokes.map((s, i) => [s.id, i]));
  let removed = 0;
  const measures = before.measures?.map((measure) => {
    const gone = measure.events.filter((e) => remove.has(e.id));
    if (gone.length === 0) return measure;
    removed += gone.length;
    return { ...measure, events: measure.events.filter((e) => !remove.has(e.id)),
      unresolvedStrokeIds: [...measure.unresolvedStrokeIds, ...gone.flatMap((e) => e.strokeIds)].sort((a, b) => order.get(a)! - order.get(b)!) };
  });
  if (!measures || removed !== remove.size) throw new Error('Unknown event');
  const after: SketchDocument = { ...before, measures: decodeMeasures(measures, before.strokes) };
  return {
    label: 'Delete notes',
    apply: (document) => {
      if (document !== before) throw new Error('Stale delete: document changed');
      return after;
    },
    revert: (document) => {
      if (document !== after) throw new Error('Cannot undo delete out of order');
      return before;
    },
  };
}
