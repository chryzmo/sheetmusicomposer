import type { SketchDocument } from '../model/document';
import type { Pitch } from '../model/music';
import { decodeMeasures } from '../model/validate-music';
import type { Command } from './history';

/** Change one kept note's written pitch. Ink, stroke references, duration and the
 * recognizer's support score are untouched; only the pitch is a user decision.
 * Validated through decodeMeasures like every other music write, and tied to the
 * exact document it was built from so undo/redo cannot apply out of order.
 */
export function repitchCommand(before: SketchDocument, eventId: string, pitch: Pitch): Command<SketchDocument> {
  let found = false;
  const measures = before.measures?.map((measure) => ({ ...measure, events: measure.events.map((event) => {
    if (event.id !== eventId) return event;
    if (event.kind !== 'note') throw new Error('Only notes have a pitch');
    if (event.pitch.step === pitch.step && event.pitch.octave === pitch.octave) throw new Error('Pitch unchanged');
    found = true;
    return { ...event, pitch };
  }) }));
  if (!measures || !found) throw new Error('Unknown note');
  const after: SketchDocument = { ...before, measures: decodeMeasures(measures, before.strokes) };
  return {
    label: 'Change pitch',
    apply: (document) => {
      if (document !== before) throw new Error('Stale pitch change: document changed');
      return after;
    },
    revert: (document) => {
      if (document !== after) throw new Error('Cannot undo pitch change out of order');
      return before;
    },
  };
}
