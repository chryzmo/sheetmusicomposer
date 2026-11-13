import type { Accidental, Duration, Measure, Pitch } from '../model/music';

/** One sounding or silent span, in quarter notes from the start of the page. */
export interface ScheduledEvent {
  readonly eventId: string;
  readonly startBeats: number;
  readonly durationBeats: number;
  /** MIDI note number, or null for a rest. */
  readonly midi: number | null;
}

const quarterBeats: Record<Duration, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;
const alters: Record<Accidental, number> = { sharp: 1, flat: -1, natural: 0 };

/** Written pitch to MIDI (C4 = 60). Only the note's own accidental applies; this
 * is written pitch, not a transposed or key-signature-aware sounding pitch.
 */
export function midiNumber(pitch: Pitch, accidental: Accidental | null): number {
  return 12 * (pitch.octave + 1) + semitones[pitch.step] + (accidental === null ? 0 : alters[accidental]);
}

export function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Each dot adds half the previous value. */
export function eventBeats(duration: Duration, dots: number): number {
  return quarterBeats[duration] * (2 - 0.5 ** dots);
}

/** Events run back to back in model order, exactly as written. A measure that is
 * over- or underfull is played at its written length, with no padding or trimming,
 * matching what the MusicXML export does.
 */
export function scheduleMeasures(measures: readonly Measure[]): { events: readonly ScheduledEvent[]; totalBeats: number } {
  let cursor = 0;
  const events = measures.flatMap((measure) => measure.events.map((event): ScheduledEvent => {
    const durationBeats = eventBeats(event.duration, event.dots);
    const scheduled = {
      eventId: event.id, startBeats: cursor, durationBeats,
      midi: event.kind === 'note' ? midiNumber(event.pitch, event.accidental) : null,
    };
    cursor += durationBeats;
    return scheduled;
  }));
  return { events, totalBeats: cursor };
}
