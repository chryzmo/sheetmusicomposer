import type { Stroke } from '../ink/types';
import type { Measure } from './music';

/** The document is independent of pointer state, navigation, and undo history. */
export interface SketchDocument {
  readonly strokes: readonly Stroke[];
  /** Absent on legacy ink-only documents. Presence selects sketch format v2.
   * Raw strokes not assigned to any measure remain visible, unrecognized ink.
   */
  readonly measures?: readonly Measure[];
}

export function createDocument(): SketchDocument {
  return { strokes: [] };
}
