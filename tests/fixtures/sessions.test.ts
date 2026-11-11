import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createBuiltinTemplates } from '../../src/recognize/builtins';
import { classificationReport, evaluatePrimitives } from './classification';
import { createDevelopmentTemplates, evaluateDevelopmentLeaveOneOut } from './development';
import { loadFixtures } from './load';
import { fixtureRole, fixtureRoot } from './roles';

const fixtures = loadFixtures(fixtureRoot);
const development = fixtures.filter(({ path }) => fixtureRole(path) === 'development');
const evaluation = fixtures.filter(({ path }) => fixtureRole(path) === 'evaluation');
const dev = development[0]!, reserved = evaluation[0]!;

it.each([
  { role: 'development', path: 'recorded/development/pencil-dev-1.json', sha: '15ec56101a055df9280e8e03bb50b4414b50c09316a0ce50629dcd0de60736b9' },
  { role: 'evaluation', path: 'recorded/evaluation/pencil-eval-1.json', sha: '53abc2f6face9427fa206f39e6867199583eabc866cc0203c3908df000f87f2c' },
] as const)('preserves the original $role export bytes and explicit role', ({ path, sha, role }) => {
  const fullPath = join(fixtureRoot, path);
  expect(createHash('sha256').update(readFileSync(fullPath)).digest('hex')).toBe(sha);
  expect(fixtureRole(fullPath)).toBe(role);
});

it('validates the corrected annotation inventory without scoring evaluation input', () => {
  expect(development).toHaveLength(1);
  expect(evaluation).toHaveLength(1);
  for (const [file, count, unknown] of [[dev, 15, 0], [reserved, 20, 5]] as const) {
    expect(file.fixture.provenance).toBe('recorded');
    expect(file.fixture.expected.events).toEqual([]);
    expect(file.fixture.document.strokes).toHaveLength(count);
    expect(file.fixture.expected.primitives).toHaveLength(count);
    expect(file.fixture.expected.primitives.every(({ strokeIds }) => strokeIds.length === 1)).toBe(true);
    for (const label of ['noteheadFilled', 'noteheadHollow', 'stem'] as const) {
      expect(file.fixture.expected.primitives.filter((p) => p.label === label)).toHaveLength(5);
    }
    expect(file.fixture.expected.primitives.filter((p) => p.label === 'unknown')).toHaveLength(unknown);
  }
});

it('detects source overlap without running recognition on reserved input', () => {
  const ids = new Set(dev.fixture.document.strokes.map(({ id }) => id));
  const raw = new Set(dev.fixture.document.strokes.map(({ points }) => JSON.stringify(points)));
  expect(reserved.fixture.document.strokes.some(({ id }) => ids.has(id))).toBe(false);
  expect(reserved.fixture.document.strokes.some(({ points }) => raw.has(JSON.stringify(points)))).toBe(false);
  // Disjoint IDs and exact arrays prevent these simple copy leaks. They do not
  // independently prove a separate session, writer diversity, or sample adequacy.
});

it('requires an explicit role for every file, including future imports', () => {
  expect(fixtures.map(({ path }) => fixtureRole(path)).sort()).toEqual([
    'development', 'evaluation', 'regression', 'regression', 'regression', 'regression', 'regression',
  ]);
  expect(() => fixtureRole(join(fixtureRoot, 'recorded/unassigned.json'))).toThrow('Unassigned fixture role');
});

it('refuses evaluation and regression fixtures as development/template sources', () => {
  const regression = fixtures.find(({ path }) => fixtureRole(path) === 'regression')!;
  for (const file of [reserved, regression]) {
    expect(() => createDevelopmentTemplates([file])).toThrow('Template development cannot use');
    expect(() => evaluateDevelopmentLeaveOneOut([file])).toThrow('Template development cannot use');
  }
  // A caller changing an imported display name/set cannot change its role.
  expect(() => createDevelopmentTemplates([{ ...reserved, fixture: {
    ...reserved.fixture, name: dev.fixture.name, set: dev.fixture.set,
  } }])).toThrow('evaluation');
});

it('rejects duplicate recordings and repeated source IDs rather than allowing self-match leakage', () => {
  expect(() => createDevelopmentTemplates([dev, dev])).toThrow('Repeated development fixture');
  const renamed = { ...dev, fixture: { ...dev.fixture, name: 'duplicate-source-test' } };
  expect(() => evaluateDevelopmentLeaveOneOut([dev, renamed])).toThrow('Repeated development stroke');
});

it('builds 15 explicit development-only templates with original source references', () => {
  const templates = createDevelopmentTemplates(development);
  expect(templates).toHaveLength(15);
  expect(new Set(templates.map(({ id }) => id)).size).toBe(15);
  for (const [index, template] of templates.entries()) {
    expect(template.cloud.strokeIds).toEqual(dev.fixture.expected.primitives[index]!.strokeIds);
    expect(template.source).toEqual({ kind: 'user', sampleId: `development/${dev.fixture.name}/primitive-${index + 1}` });
  }
});

it.each(['unknown', 'flag'] as const)('never trains an accepted class from a %s annotation', (label) => {
  // Synthetic in-memory metadata variant for the adapter contract, NOT a
  // relabeling of the recorded fixture or another handwriting data point.
  const variant = { ...dev, fixture: { ...dev.fixture, expected: { ...dev.fixture.expected,
    primitives: dev.fixture.expected.primitives.map((p, index) => index === 0 ? { ...p, label } : p),
  } } };
  expect(createDevelopmentTemplates([variant])).toHaveLength(14);
});

it('reports development-only baseline and leave-one-group-out misses without scoring the reserved session', () => {
  const before = structuredClone(development);
  const seed = evaluatePrimitives(development, createBuiltinTemplates());
  const observations = evaluateDevelopmentLeaveOneOut(development);
  expect(observations).toHaveLength(15);
  expect(seed.filter(({ expected, result }) => expected === result.label)).toHaveLength(3);
  expect(observations.every(({ result }) => result.label === 'unknown')).toBe(true);
  expect(observations.filter(({ result }) => result.rejection === 'margin')).toHaveLength(10);
  expect(observations.filter(({ result }) => result.rejection === 'geometry')).toHaveLength(5);
  for (const [index, { result }] of observations.entries()) {
    const excluded = `development/${dev.fixture.name}/primitive-${index + 1}`;
    expect(result.candidates.every(({ templateId }) => templateId !== excluded)).toBe(true);
  }
  console.info(classificationReport(seed));
  console.info(classificationReport(observations, 'leave-one-group-out development templates (same session)'));
  expect(development).toEqual(before);
});
