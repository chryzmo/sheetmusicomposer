import type { StaveNoteStruct } from 'vexflow/bravura';
import type { Duration, TimeSignature } from '../model/music';
import type { SimpleNoteCandidate } from '../recognize/assemble';

/** Pure written-pitch adapter; no sounding transposition or accidental defaults. */
export function notationSpec(note: Pick<SimpleNoteCandidate, 'pitch' | 'duration'>): StaveNoteStruct {
  const durations = { whole: 'w', half: 'h', quarter: 'q' } as const;
  return { clef: 'treble', keys: [`${note.pitch.step.toLowerCase()}/${note.pitch.octave}`], duration: durations[note.duration], autoStem: true };
}

/** A display total only, NOT resolution/alternative search or proof of intent. */
export function reviewDuration(durations: readonly Duration[], signature: TimeSignature): { units: number; target: number } {
  const values = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 } as const;
  const units = durations.reduce((sum, d) => sum + values[d], 0);
  const [numerator, denominator] = signature.split('/').map(Number);
  return { units, target: numerator! * 4 / denominator! };
}

export type ReviewDurationState = 'empty' | 'under' | 'match' | 'over';

/** Display wording for a selected total. The leading word carries the state so
 * it is never conveyed by color alone. No repair is offered or implied.
 */
export function reviewDurationMessage(units: number, target: number, signature: TimeSignature): { state: ReviewDurationState; text: string } {
  const unit = (n: number): string => `${n} quarter-note unit${n === 1 ? '' : 's'}`;
  if (units === 0) return { state: 'empty', text: `No notes selected. A ${signature} measure holds ${unit(target)}.` };
  if (units < target) return { state: 'under', text: `Underfull: ${units} of ${unit(target)} in ${signature}; ${unit(target - units)} short. No rests or durations are added automatically.` };
  if (units > target) return { state: 'over', text: `Overfull: ${unit(units)} selected but a ${signature} measure holds ${target}; ${unit(units - target)} over. Durations are not repaired automatically.` };
  return { state: 'match', text: `Total matches: ${unit(units)} in ${signature}. This does not prove the notes are correct.` };
}
