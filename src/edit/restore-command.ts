import type { SketchDocument } from '../model/document';
import type { Command } from './history';

/** Both documents are immutable, validated snapshots. Restore is one undo step. */
export function restoreCommand(before: SketchDocument, restored: SketchDocument): Command<SketchDocument> {
  return {
    label: 'Restore backup',
    apply: () => restored,
    revert: () => before,
  };
}
