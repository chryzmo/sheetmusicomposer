import { describe, expect, it } from 'vitest';
import type { Measure, MusicEvent } from '../model/music';
import { eventBeats, midiFrequency, midiNumber, scheduleMeasures } from './schedule';

const base = { strokeIds: [], confidence: 1, dots: 0 } as const;
const measure = (events: MusicEvent[]): Measure => ({ id: 'm', clef: 'treble', timeSignature: '4/4', events, unresolvedStrokeIds: [] });

describe('midiNumber', () => {
  it('maps written pitch to MIDI with explicit accidentals only', () => {
    expect(midiNumber({ step: 'C', octave: 4 }, null)).toBe(60);
    expect(midiNumber({ step: 'A', octave: 4 }, null)).toBe(69);
    expect(midiNumber({ step: 'F', octave: 4 }, 'sharp')).toBe(66);
    expect(midiNumber({ step: 'B', octave: 4 }, 'flat')).toBe(70);
    expect(midiNumber({ step: 'F', octave: 4 }, 'natural')).toBe(65);
    expect(midiNumber({ step: 'C', octave: 0 }, null)).toBe(12);
  });
  it('gives concert A as 440 Hz', () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(81)).toBeCloseTo(880, 6);
  });
});

describe('eventBeats', () => {
  it('counts dots', () => {
    expect(eventBeats('quarter', 0)).toBe(1);
    expect(eventBeats('half', 1)).toBe(3);
    expect(eventBeats('eighth', 2)).toBe(0.875);
    expect(eventBeats('sixteenth', 0)).toBe(0.25);
  });
});

describe('scheduleMeasures', () => {
  it('lays events end to end across measures, including rests', () => {
    const { events, totalBeats } = scheduleMeasures([
      measure([
        { ...base, id: 'a', kind: 'note', duration: 'quarter', pitch: { step: 'E', octave: 4 }, accidental: null },
        { ...base, id: 'r', kind: 'rest', duration: 'eighth' },
      ]),
      measure([{ ...base, id: 'b', kind: 'note', duration: 'half', dots: 1, pitch: { step: 'G', octave: 4 }, accidental: 'sharp' }]),
    ]);
    expect(events).toEqual([
      { eventId: 'a', startBeats: 0, durationBeats: 1, midi: 64 },
      { eventId: 'r', startBeats: 1, durationBeats: 0.5, midi: null },
      { eventId: 'b', startBeats: 1.5, durationBeats: 3, midi: 68 },
    ]);
    expect(totalBeats).toBe(4.5);
  });
  it('is empty for no measures', () => {
    expect(scheduleMeasures([])).toEqual({ events: [], totalBeats: 0 });
  });
});
