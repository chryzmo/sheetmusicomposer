import type { SketchDocument } from '../model/document';

/** Human-facing stroke numbers are 1-based drawing order, never persisted IDs. */
export function strokeIdsFromNumbers(text: string, document: SketchDocument): string[] {
  if (!/^\s*\d+(\s*,\s*\d+)*\s*$/.test(text)) throw new Error('Enter stroke numbers separated by commas, for example 1,2');
  return text.split(',').map((part) => {
    const index = Number(part.trim());
    if (!Number.isSafeInteger(index) || index < 1 || index > document.strokes.length) throw new Error(`Unknown stroke number: ${part.trim()}`);
    return document.strokes[index - 1]!.id;
  });
}
