import type { Stroke } from '../ink/types';

/** The document is independent of pointer state, navigation, and undo history. */
export interface SketchDocument {
  readonly strokes: readonly Stroke[];
}

export function createDocument(): SketchDocument {
  return { strokes: [] };
}
