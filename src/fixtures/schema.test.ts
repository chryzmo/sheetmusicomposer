import { expect, it } from 'vitest';
import { config } from '../config';
import { parseBackup } from '../store/schema';
import { strokeIdsFromNumbers } from './annotations';
import { decodeFixture, parseFixture, serializeFixture } from './schema';
import type { InkFixture } from './schema';

const fixture: InkFixture = {
  format: 'sheetmusicomposer-fixture', version: 1, name: 'quarter-c4', set: 'test', notes: '', provenance: 'recorded',
  staff: { units: 'staff-space', lineYs: [0, 1, 2, 3, 4], width: 40, clef: 'treble', timeSignature: '4/4' },
  document: { strokes: [
    { id: 'head', completion: 'interrupted', points: [
      { x: -1, y: 5, t: 120, pressure: 0.7, tiltX: 10, tiltY: -20 },
      { x: 0, y: 5, t: 100, pressure: 0.2, tiltX: -10, tiltY: 0 },
      { x: 1, y: 5, t: 0, pressure: 0, tiltX: 0, tiltY: 0 },
    ] },
    { id: 'stem', completion: 'complete', points: [{ x: 1, y: 2, t: 140, pressure: 1, tiltX: 90, tiltY: -90 }] },
  ] },
  expected: {
    primitives: [{ label: 'noteheadFilled', strokeIds: ['head'] }, { label: 'stem', strokeIds: ['stem'] }],
    events: [{ kind: 'note', pitch: { step: 'C', octave: 4 }, duration: 'quarter', dots: 0, accidental: null, strokeIds: ['head', 'stem'] }],
  },
};

it('round-trips all raw sample metadata and manually ordered annotations without modifying the source', () => {
  const before = structuredClone(fixture);
  expect(parseFixture(serializeFixture(fixture))).toEqual(fixture);
  expect(fixture).toEqual(before);
});

it('accepts primitive-only fixtures, including deliberately unknown ink', () => {
  const result = decodeFixture({ ...fixture, expected: { primitives: [{ label: 'unknown', strokeIds: ['head', 'stem'] }], events: [] } });
  expect(result.expected.events).toEqual([]);
});

it('accepts event-only annotations, rests, all durations/dots/accidentals, and partial measures', () => {
  for (const duration of ['whole', 'half', 'quarter', 'eighth', 'sixteenth']) {
    for (const accidental of [null, 'sharp', 'flat', 'natural']) {
      const note = { ...fixture.expected.events[0], duration, accidental, dots: 2 };
      const input = { ...fixture, expected: { primitives: [], events: [note] } };
      expect(decodeFixture(input).expected.events).toEqual([note]);
    }
    const rest = { kind: 'rest', duration, dots: 1, strokeIds: ['head', 'stem'] };
    expect(decodeFixture({ ...fixture, expected: { primitives: [], events: [rest] } }).expected.events).toEqual([rest]);
  }
});

const badInputs: [string, unknown][] = [
  ['backup format', { ...fixture, format: 'sheetmusicomposer' }],
  ['version', { ...fixture, version: 2 }],
  ['blank name', { ...fixture, name: '  ' }],
  ['long name', { ...fixture, name: 'a'.repeat(config.maxFixtureTextLength + 1) }],
  ['blank set', { ...fixture, set: '' }],
  ['notes type', { ...fixture, notes: null }],
  ['provenance', { ...fixture, provenance: 'guessed' }],
  ['empty ink', { ...fixture, document: { strokes: [] } }],
  ['missing ink', { ...fixture, document: null }],
  ['units', { ...fixture, staff: { ...fixture.staff, units: 'pixels' } }],
  ['staff lines', { ...fixture, staff: { ...fixture.staff, lineYs: [0, 1, 2, 3, 5] } }],
  ['staff width', { ...fixture, staff: { ...fixture.staff, width: Infinity } }],
  ['clef', { ...fixture, staff: { ...fixture.staff, clef: 'bass' } }],
  ['time signature', { ...fixture, staff: { ...fixture.staff, timeSignature: '5/4' } }],
  ['no labels', { ...fixture, expected: { primitives: [], events: [] } }],
  ['missing stroke', { ...fixture, expected: { primitives: [{ label: 'stem', strokeIds: ['stem'] }], events: [] } }],
  ['unknown stroke', { ...fixture, expected: { primitives: [{ label: 'stem', strokeIds: ['missing'] }], events: [] } }],
  ['empty stroke group', { ...fixture, expected: { primitives: [{ label: 'stem', strokeIds: [] }], events: [] } }],
  ['repeated stroke in group', { ...fixture, expected: { primitives: [{ label: 'stem', strokeIds: ['head', 'head'] }], events: [] } }],
  ['overlapping primitive groups', { ...fixture, expected: { primitives: [{ label: 'stem', strokeIds: ['head', 'stem'] }, { label: 'dot', strokeIds: ['head'] }], events: [] } }],
  ['bad primitive', { ...fixture, expected: { ...fixture.expected, primitives: [{ label: 'chord', strokeIds: ['head', 'stem'] }] } }],
  ['rest with pitch/accidental', { ...fixture, expected: { ...fixture.expected, events: [{ ...fixture.expected.events[0], kind: 'rest' }] } }],
  ['repeated event source', { ...fixture, expected: { ...fixture.expected, events: [fixture.expected.events[0], fixture.expected.events[0]] } }],
];
for (const [field, patch] of Object.entries({ kind: 'chord', duration: 'triplet', dots: -1, accidental: 'doubleSharp', pitch: { step: 'H', octave: 4 } })) {
  badInputs.push([`event ${field}`, { ...fixture, expected: { primitives: [], events: [{ ...fixture.expected.events[0], [field]: patch }] } }]);
}
for (const dots of [0.5, 3, NaN]) badInputs.push(['dots', { ...fixture, expected: { ...fixture.expected, events: [{ ...fixture.expected.events[0], dots }] } }]);
for (const octave of [-1, 10, 4.5, '4']) badInputs.push(['octave', { ...fixture, expected: { ...fixture.expected, events: [{ ...fixture.expected.events[0], pitch: { step: 'C', octave } }] } }]);

it.each(badInputs)('rejects invalid fixture: %s', (_, input) => {
  expect(() => decodeFixture(input)).toThrow();
});

it('rejects malformed JSON, oversized input/output, and backup/fixture format confusion', () => {
  expect(() => parseFixture('{bad')).toThrow();
  expect(() => parseFixture(' '.repeat(config.maxBackupBytes + 1))).toThrow('10 MiB');
  expect(() => parseBackup(serializeFixture(fixture))).toThrow('Not a Sheet Music Composer backup');
  const point = fixture.document.strokes[0]!.points[0]!;
  const large = { ...fixture, document: { strokes: [
    { ...fixture.document.strokes[0], points: Array.from({ length: 160000 }, () => point) }, fixture.document.strokes[1],
  ] } };
  expect(() => serializeFixture(large)).toThrow('10 MiB');
});

it('maps 1-based stroke numbers to stable IDs in entered order', () => {
  expect(strokeIdsFromNumbers(' 2, 1 ', fixture.document)).toEqual(['stem', 'head']);
});

it.each(['', '0', '3', '-1', '1.5', '1,', '1 2', '1e0', 'NaN', '99999999999999999999'])('rejects invalid stroke numbers: %s', (text) => {
  expect(() => strokeIdsFromNumbers(text, fixture.document)).toThrow();
});
