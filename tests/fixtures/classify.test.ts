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
  expect(observations).toHaveLength(19);
  expect(report).toContain('NOT held-out handwriting accuracy');
  expect(report).toContain('personal (recorded)');
  expect(report).toContain('synthetic-smoke (synthetic)');
  expect(report).toContain('classifier-boundaries (synthetic)');
});

it('records the initial development outputs, including known misses rather than relabeling ground truth', () => {
  const baseline = [
    ['Quarter-e4', ['unknown', 'unknown']],
    ['synthetic-half-e4', ['unknown', 'stem']],
    ['synthetic-quarter-c4', ['unknown', 'stem']],
    ['synthetic-unknown-mark', ['unknown']],
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

it('keeps the intentionally out-of-policy/interrupted safety cases as ink, without changing their intended labels', () => {
  const boundaries = observations.filter(({ set }) => set === 'classifier-boundaries');
  expect(boundaries).toHaveLength(12);
  expect(boundaries.every(({ result }) => result.label === 'unknown')).toBe(true);
  expect(boundaries.filter(({ expected }) => expected !== 'unknown')).toHaveLength(11);
});

it('does not mutate reviewed fixtures or templates during evaluation', () => {
  const before = structuredClone({ fixtures, bank });
  evaluatePrimitives(fixtures, bank);
  expect({ fixtures, bank }).toEqual(before);
});
