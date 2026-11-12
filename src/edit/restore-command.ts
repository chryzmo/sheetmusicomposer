import type { SketchDocument } from '../model/document';
import type { Command } from './history';

/** Both documents are immutable, validated snapshots. Restore is one undo step. */
export function restoreCommand(before: SketchDocument, restored: SketchDocument): Command<SketchDocument> {
  return {
    label: 'Restore backup',
    apply: (document) => {
      if (document !== before) throw new Error('Cannot restore onto a changed document');
      return restored;
    },
    revert: (document) => {
      if (document !== restored) throw new Error('Cannot undo Restore out of order');
      return before;
    },
  };
}
