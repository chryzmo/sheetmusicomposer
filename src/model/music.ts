/** Shared written-music vocabulary; independent of fixtures and browser APIs. */
export const pitchSteps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export const durations = ['whole', 'half', 'quarter', 'eighth', 'sixteenth'] as const;
export const accidentals = ['sharp', 'flat', 'natural'] as const;
export const timeSignatures = ['4/4', '3/4', '2/4', '6/8'] as const;
export const minPitchOctave = 0;
export const maxPitchOctave = 9;

export type PitchStep = typeof pitchSteps[number];
export type Duration = typeof durations[number];
export type Accidental = typeof accidentals[number];
export type TimeSignature = typeof timeSignatures[number];

/** Written diatonic pitch. Accidentals belong to the event, not staff geometry. */
export interface Pitch {
  readonly step: PitchStep;
  readonly octave: number;
}

/** The initial model/fixture domain is C0–B9, not a MIDI/playback range. */
export function isPitch(value: unknown): value is Pitch {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    'step' in value && pitchSteps.some((step) => step === value.step) &&
    'octave' in value && typeof value.octave === 'number' &&
    Number.isInteger(value.octave) && value.octave >= minPitchOctave && value.octave <= maxPitchOctave;
}

interface EventBase {
  readonly id: string;
  readonly duration: Duration;
  readonly dots: number;
  /** IDs of the original ink, which recognition must never delete or rewrite. */
  readonly strokeIds: readonly string[];
  /** Bounded evidence score in [0,1], not a calibrated probability. */
  readonly confidence: number;
}

export interface NoteEvent extends EventBase {
  readonly kind: 'note';
  readonly pitch: Pitch;
  /** null = no explicit written accidental; natural is an explicit symbol. */
  readonly accidental: Accidental | null;
}

/** Data vocabulary only: rest recognition still belongs to milestone 4. */
export interface RestEvent extends EventBase {
  readonly kind: 'rest';
}

export type MusicEvent = NoteEvent | RestEvent;

/** Single staff/voice. Events are in musical order, not pointer-time order.
 * These are core types only: the ink-only saved document remains version 1.
 * Validate IDs, references, dots, and confidence before future model commands
 * or persistence accept events; a TypeScript interface is not a file decoder.
 */
export interface Measure {
  readonly id: string;
  readonly clef: 'treble';
  readonly timeSignature: TimeSignature;
  readonly events: readonly MusicEvent[];
  readonly unresolvedStrokeIds: readonly string[];
}
