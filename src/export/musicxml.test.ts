import { describe, expect, it } from 'vitest';
import type { Measure, MusicEvent } from '../model/music';
import { eventDivisions, measuresToMusicXml } from './musicxml';

const base = { strokeIds: [], confidence: 1 } as const;
const note = (id: string, duration: MusicEvent['duration'], extra: Partial<Extract<MusicEvent, { kind: 'note' }>> = {}): MusicEvent => (
  { ...base, id, kind: 'note', duration, dots: 0, pitch: { step: 'E', octave: 4 }, accidental: null, ...extra }
);
const measure = (events: MusicEvent[], timeSignature: Measure['timeSignature'] = '4/4'): Measure => (
  { id: 'm', clef: 'treble', timeSignature, events, unresolvedStrokeIds: [] }
);

describe('eventDivisions', () => {
  it('counts each duration and dot in whole divisions', () => {
    expect(eventDivisions({ duration: 'quarter', dots: 0 })).toBe(16);
    expect(eventDivisions({ duration: 'whole', dots: 0 })).toBe(64);
    expect(eventDivisions({ duration: 'half', dots: 1 })).toBe(48);
    expect(eventDivisions({ duration: 'eighth', dots: 1 })).toBe(12);
    expect(eventDivisions({ duration: 'sixteenth', dots: 2 })).toBe(7);
  });
});

describe('measuresToMusicXml', () => {
  it('writes attributes once, then notes with type, dots and accidentals', () => {
    const xml = measuresToMusicXml([
      measure([note('a', 'quarter', { dots: 1, accidental: 'sharp', pitch: { step: 'F', octave: 5 } })]),
      measure([note('b', 'sixteenth')], '3/4'),
    ]);
    expect(xml).toContain('<divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>');
    expect(xml.match(/<attributes>/g)).toHaveLength(1);
    expect(xml).toContain('<pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>24</duration><type>quarter</type><dot/><accidental>sharp</accidental>');
    expect(xml).toContain('<measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>16th</type></note>');
  });

  it('writes flats and an explicit natural as alterations', () => {
    expect(measuresToMusicXml([measure([note('a', 'half', { accidental: 'flat' })])])).toContain('<alter>-1</alter>');
    const natural = measuresToMusicXml([measure([note('a', 'half', { accidental: 'natural' })])]);
    expect(natural).toContain('<alter>0</alter>');
    expect(natural).toContain('<accidental>natural</accidental>');
  });

  it('writes rests and a whole-measure rest for an empty measure', () => {
    const xml = measuresToMusicXml([
      measure([{ ...base, id: 'r', kind: 'rest', duration: 'eighth', dots: 0 }]),
      measure([], '6/8'),
    ]);
    expect(xml).toContain('<note><rest/><duration>8</duration><type>eighth</type></note>');
    expect(xml).toContain('<note><rest measure="yes"/><duration>48</duration></note>');
  });

  it('keeps a measure that does not fill its time signature as written', () => {
    const xml = measuresToMusicXml([measure([note('a', 'whole'), note('b', 'whole')])]);
    expect(xml.match(/<note>/g)).toHaveLength(2);
  });

  it('escapes the title and is well-formed', () => {
    const xml = measuresToMusicXml([measure([note('a', 'quarter')])], 'A & <B>');
    expect(xml).toContain('<work-title>A &#38; &#60;B&#62;</work-title>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.match(/<note>/g)?.length).toBe(xml.match(/<\/note>/g)?.length);
  });
});
