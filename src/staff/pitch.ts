import { isPitch, maxPitchOctave, minPitchOctave, pitchSteps } from '../model/music';
import type { Pitch } from '../model/music';

// The top treble line is F5 at y=0; positive staff-space y points downward.
// One line/space step is half a staff space, independent of canvas/view scale.
const topLineIndex = 5 * pitchSteps.length + pitchSteps.indexOf('F');

/** Nearest written pitch, including ledger positions. Invalid/out-of-domain
 * input returns null rather than clamping to an unrelated note. No confidence
 * or notehead detection is implied by snapping an arbitrary coordinate.
 */
export function pitchAtStaffY(y: number): Pitch | null {
  if (!Number.isFinite(y)) return null;
  // Deterministic tie policy: exact midpoints choose the lower written pitch,
  // including above the staff. This is quantization, not a recognition threshold.
  const index = topLineIndex - Math.round(y * 2);
  if (index < minPitchOctave * pitchSteps.length || index >= (maxPitchOctave + 1) * pitchSteps.length) return null;
  const step = pitchSteps[index % pitchSteps.length];
  if (!step) return null;
  return { step, octave: Math.floor(index / pitchSteps.length) };
}

/** Staff-space center for a written pitch; accidentals never change this y. */
export function staffYFromPitch(pitch: Pitch): number {
  if (!isPitch(pitch)) throw new RangeError('Pitch must be a written note from C0 through B9');
  const index = pitch.octave * pitchSteps.length + pitchSteps.indexOf(pitch.step);
  return (topLineIndex - index) / 2;
}
