import { createDocument } from '../model/document';
import type { SketchDocument } from '../model/document';
import type { Command } from './history';

/** A new page replaces the current document, without creating a sketch archive. */
export function newPageCommand(before: SketchDocument): Command<SketchDocument> {
  const blank = createDocument();
  return {
    label: 'New page',
    apply: () => blank,
    revert: () => before,
  };
}
