import type { Stroke } from '../ink/types';
import type { SketchDocument } from '../model/document';
import type { Command } from './history';

export function addStrokeCommand(stroke: Stroke): Command<SketchDocument> {
  // Snapshot raw samples once at the command boundary. Later capture mutations
  // must not change a completed stroke or its redo result.
  const snapshot: Stroke = { ...stroke, points: stroke.points.map((point) => ({ ...point })) };
  return {
    label: 'Add stroke',
    apply: (document) => {
      if (document.strokes.some((item) => item.id === snapshot.id)) {
        throw new Error(`Stroke ${snapshot.id} already exists`);
      }
      return { ...document, strokes: [...document.strokes, snapshot] };
    },
    revert: (document) => {
      if (document.strokes.at(-1)?.id !== snapshot.id) {
        throw new Error(`Cannot undo stroke ${snapshot.id} out of order`);
      }
      return { ...document, strokes: document.strokes.slice(0, -1) };
    },
  };
}
