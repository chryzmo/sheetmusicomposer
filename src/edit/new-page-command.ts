import { createDocument } from '../model/document';
import type { SketchDocument } from '../model/document';
import type { Command } from './history';

/** A new page replaces the current document, without creating a sketch archive. */
export function newPageCommand(before: SketchDocument): Command<SketchDocument> {
  const blank = createDocument();
  return {
    label: 'New page',
    apply: (document) => {
      if (document !== before) throw new Error('Cannot clear a changed document');
      return blank;
    },
    revert: (document) => {
      if (document !== blank) throw new Error('Cannot undo New out of order');
      return before;
    },
  };
}
