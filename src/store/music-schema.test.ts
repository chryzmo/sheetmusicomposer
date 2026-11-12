import { expect, it } from 'vitest';
import { musicalDocument } from '../../tests/helpers/music';
import { decodeSketch, parseBackup, serializeBackup, sketchFile } from './schema';

it('round-trips version-2 music, unresolved/unassigned ink, exact samples, and explicit evidence', () => {
  const document = musicalDocument(), before = structuredClone(document);
  expect(sketchFile(document).version).toBe(2);
  expect(parseBackup(serializeBackup(document))).toEqual(document);
  expect(decodeSketch(sketchFile(document))).toEqual(document);
  expect(document).toEqual(before);
  expect(decodeSketch(sketchFile(document)).measures).not.toBe(document.measures);
});

it('retains v1 serialization for legacy ink and explicitly supports empty v2 scores', () => {
  const ink = { strokes: musicalDocument().strokes };
  expect(sketchFile(ink).version).toBe(1);
  expect(decodeSketch(sketchFile(ink))).toEqual(ink);
  expect(decodeSketch({ format: 'sheetmusicomposer', version: 1, document: { ...ink, measures: undefined } })).toEqual(ink);
  expect(parseBackup(serializeBackup({ ...ink, measures: [] }))).toEqual({ ...ink, measures: [] });
  expect(sketchFile({ strokes: [], measures: [] }).version).toBe(2);
});

it('never silently discards measures from a v1 envelope or invents a missing v2 score', () => {
  expect(() => decodeSketch({ format: 'sheetmusicomposer', version: 1, document: musicalDocument() })).toThrow('version 2');
  expect(() => decodeSketch({ format: 'sheetmusicomposer', version: 2, document: { strokes: [] } })).toThrow('measure list');
  for (const measures of [null, {}, 'music']) {
    expect(() => decodeSketch({ format: 'sheetmusicomposer', version: 2, document: { strokes: [], measures } })).toThrow();
  }
});

it('continues to fail closed on unknown versions and rejects malformed v2 music/ink', () => {
  for (const version of [0, 3, 99, '2', undefined]) {
    expect(() => decodeSketch({ format: 'sheetmusicomposer', version, document: musicalDocument() })).toThrow('version');
  }
  const document = musicalDocument();
  expect(() => decodeSketch({ format: 'sheetmusicomposer', version: 2, document: { ...document, strokes: [] } })).toThrow('reference');
  expect(() => decodeSketch({ format: 'sheetmusicomposer', version: 2, document: { ...document,
    strokes: [{ ...document.strokes[0]!, points: [{ ...document.strokes[0]!.points[0]!, t: -1 }] }],
  } })).toThrow('timestamp');
});
