import type { StaveNoteStruct } from 'vexflow/bravura';
import type { TimeSignature } from '../model/music';
import type { SimpleNoteCandidate } from '../recognize/assemble';

type SimpleDuration = SimpleNoteCandidate['duration'];
/** Pure written-pitch adapter; no sounding transposition or accidental defaults. */
export function notationSpec(note: Pick<SimpleNoteCandidate, 'pitch' | 'duration'>): StaveNoteStruct {
  const durations = { whole: 'w', half: 'h', quarter: 'q' } as const;
  return { clef: 'treble', keys: [`${note.pitch.step.toLowerCase()}/${note.pitch.octave}`], duration: durations[note.duration], autoStem: true };
}

/** A display total only, NOT resolution/alternative search or proof of intent. */
export function reviewDuration(durations: readonly SimpleDuration[], signature: TimeSignature): { units: number; target: number } {
  const values = { whole: 4, half: 2, quarter: 1 } as const;
  const units = durations.reduce((sum, d) => sum + values[d], 0);
  const [numerator, denominator] = signature.split('/').map(Number);
  return { units, target: numerator! * 4 / denominator! };
}
