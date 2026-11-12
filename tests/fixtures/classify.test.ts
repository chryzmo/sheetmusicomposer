import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createBuiltinTemplates } from '../../src/recognize/builtins';
import { classificationReport, evaluatePrimitives } from './classification';
import { loadFixtures } from './load';
import { fixtureRole } from './roles';

// Keep the original regression baseline separate from template development and
// the reserved evaluation session. Never score a new export by glob accident.
const fixtures = loadFixtures(fileURLToPath(new URL('../../fixtures/', import.meta.url)))
  .filter(({ path }) => fixtureRole(path) === 'regression');
const bank = createBuiltinTemplates();
const observations = evaluatePrimitives(fixtures, bank);

it('reports per-set/provenance confusion and rejection without claiming held-out accuracy', () => {
  const report = classificationReport(observations);
  console.info(report);
  expect(observations).toHaveLength(54);
  expect(report).toContain('NOT held-out handwriting accuracy');
  expect(report).toContain('personal (recorded)');
  expect(report).toContain('synthetic-smoke (synthetic)');
  expect(report).toContain('classifier-boundaries (synthetic)');
});

it('records current regression outputs, preserving original ground truth including known misses', () => {
  const baseline = [
    ['Quarter-e4', ['unknown', 'stem']],
    ['synthetic-half-e4', ['noteheadHollow', 'stem']],
    ['synthetic-quarter-c4', ['unknown', 'stem']],
    ['synthetic-unknown-mark', ['unknown']],
    ['synthetic-classifier-linearity', ['stem', 'stem', 'unknown', 'unknown', 'unknown', 'unknown']],
    ['synthetic-primitive-grouping', ['noteheadHollow', 'noteheadFilled', 'stem', 'unknown', 'noteheadHollow', 'noteheadHollow', 'unknown', 'unknown', 'unknown']],
  ] as const;
  for (const [name, labels] of baseline) {
    expect(observations.filter(({ fixtureName }) => fixtureName === name).map(({ result }) => result.label)).toEqual(labels);
  }
});

it('counts wrong accepted labels and unknown false accepts separately from safe rejections', () => {
  const accepted = observations.find(({ result }) => result.label === 'stem')!;
  const rejected = observations.find(({ result }) => result.label === 'unknown')!;
  const report = classificationReport([
    { ...accepted, expected: 'unknown', set: 'counter-test', provenance: 'synthetic' },
    { ...accepted, expected: 'noteheadFilled', set: 'counter-test', provenance: 'synthetic' },
    { ...rejected, expected: 'noteheadFilled', set: 'counter-test', provenance: 'synthetic' },
    { ...rejected, expected: 'unknown', set: 'counter-test', provenance: 'synthetic' },
  ]);
  expect(report).toContain('exact 1/4; accepted 2/4; wrong accepts 2; known rejects 1; unknown rejected 1/2');
  expect(report).toContain('noteheadFilled -> stem: 1');
  expect(report).toContain('unknown -> stem: 1');
});

it('accepts newly supported slanted/retraced stems while retaining size, interruption, and multi-stroke rejection', () => {
  const boundaries = observations.filter(({ set }) => set === 'classifier-boundaries');
  expect(boundaries).toHaveLength(12);
  // The original intended labels remain unchanged. Wide/slanted/retraced
  // examples are now valid stem candidates, not false accepts of unknown ink.
  expect(boundaries.map(({ result }) => result.label)).toEqual([
    'unknown', 'unknown', 'stem', 'stem', 'stem', 'unknown',
    'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown',
  ]);
  expect(boundaries.filter(({ expected }) => expected !== 'unknown')).toHaveLength(11);
  expect(observations.filter(({ expected }) => expected === 'unknown').every(({ result }) => result.label === 'unknown')).toBe(true);
});

it('does not mutate reviewed fixtures or templates during evaluation', () => {
  const before = structuredClone({ fixtures, bank });
  evaluatePrimitives(fixtures, bank);
  expect({ fixtures, bank }).toEqual(before);
});
