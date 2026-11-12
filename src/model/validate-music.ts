import { config } from '../config';
import type { Stroke } from '../ink/types';
import { accidentals, durations, isPitch, timeSignatures } from './music';
import type { Measure, MusicEvent } from './music';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a music object');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > config.maxMusicIdLength) throw new Error('Invalid music ID');
  return value;
}
function choice<const T extends readonly string[]>(value: unknown, choices: T): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error('Invalid music vocabulary');
  return value as T[number];
}

/** Validate/copy ordered single-voice measures against already validated ink.
 * Unassigned raw ink is allowed. Assigned references must be globally disjoint
 * across events/unresolved lists/measures. No source is deleted, no IDs/scores
 * are generated, and no duration total or recognition quality is inferred.
 */
export function decodeMeasures(value: unknown, strokes: readonly Stroke[]): readonly Measure[] {
  if (!Array.isArray(value) || value.length > config.maxMusicMeasures) throw new Error('Invalid measure list');
  const source = new Map(strokes.map((s) => [s.id, s]));
  const measureIds = new Set<string>(), eventIds = new Set<string>(), used = new Set<string>();
  function references(value: unknown, event: boolean): string[] {
    if (!Array.isArray(value) || value.length > config.maxStoredStrokes || (event && value.length === 0)) throw new Error('Invalid music stroke references');
    return value.map((ref: unknown) => {
      if (typeof ref !== 'string' || !source.has(ref) || used.has(ref)) throw new Error('Unknown or repeated music stroke reference');
      if (event && source.get(ref)!.completion !== 'complete') throw new Error('Events cannot consume interrupted ink');
      used.add(ref); return ref;
    });
  }
  return value.map((raw: unknown): Measure => {
    const m = record(raw), measureId = id(m.id);
    if (measureIds.has(measureId)) throw new Error('Duplicate measure ID');
    measureIds.add(measureId);
    if (m.clef !== 'treble') throw new Error('Only treble clef is supported');
    const timeSignature = choice(m.timeSignature, timeSignatures);
    if (!Array.isArray(m.events) || m.events.length > config.maxStoredStrokes) throw new Error('Invalid event list');
    const events = m.events.map((raw: unknown): MusicEvent => {
      const e = record(raw), eventId = id(e.id);
      if (eventIds.has(eventId)) throw new Error('Duplicate event ID');
      eventIds.add(eventId);
      const duration = choice(e.duration, durations);
      if (typeof e.dots !== 'number' || !Number.isInteger(e.dots) || e.dots < 0 || e.dots > config.maxMusicDots) throw new Error('Invalid music dots');
      if (typeof e.confidence !== 'number' || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1) throw new Error('Invalid music confidence');
      const base = { id: eventId, duration, dots: e.dots, confidence: e.confidence, strokeIds: references(e.strokeIds, true) };
      if (e.kind === 'rest') {
        if ('pitch' in e || 'accidental' in e) throw new Error('Rest cannot have pitch or accidental');
        return { ...base, kind: 'rest' };
      }
      if (e.kind !== 'note' || !isPitch(e.pitch)) throw new Error('Invalid note kind or pitch');
      const accidental = e.accidental === null ? null : choice(e.accidental, accidentals);
      return { ...base, kind: 'note', pitch: { step: e.pitch.step, octave: e.pitch.octave }, accidental };
    });
    return { id: measureId, clef: 'treble', timeSignature, events, unresolvedStrokeIds: references(m.unresolvedStrokeIds, false) };
  });
}
