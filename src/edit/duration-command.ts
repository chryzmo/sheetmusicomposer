import type { SketchDocument } from '../model/document';
import type { Duration } from '../model/music';
import { decodeMeasures } from '../model/validate-music';
import type { Command } from './history';

/** Durations a tap steps through: the ones the recognizer can read today. Flags
 * (milestone 3) will extend this list. Anything else steps back to a quarter.
 */
export const tapDurations = ['quarter', 'half', 'whole'] as const satisfies readonly Duration[];

export function nextDuration(duration: Duration): Duration {
  const index = tapDurations.findIndex((d) => d === duration);
  return tapDurations[(index + 1) % tapDurations.length]!;
}

/** Change one kept event's duration. Pitch, ink references and the support
 * score are untouched. Like repitchCommand: validated, and tied to the exact
 * document it was built from so undo/redo cannot apply out of order. It does
 * not check the measure total; the caller reports over/underfull measures.
 */
export function setDurationCommand(before: SketchDocument, eventId: string, duration: Duration): Command<SketchDocument> {
  let found = false;
  const measures = before.measures?.map((measure) => ({ ...measure, events: measure.events.map((event) => {
    if (event.id !== eventId) return event;
    if (event.duration === duration) throw new Error('Duration unchanged');
    found = true;
    return { ...event, duration };
  }) }));
  if (!measures || !found) throw new Error('Unknown event');
  const after: SketchDocument = { ...before, measures: decodeMeasures(measures, before.strokes) };
  return {
    label: 'Change duration',
    apply: (document) => {
      if (document !== before) throw new Error('Stale duration change: document changed');
      return after;
    },
    revert: (document) => {
      if (document !== after) throw new Error('Cannot undo duration change out of order');
      return before;
    },
  };
}
