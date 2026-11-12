import { expect, it } from 'vitest';
import { config } from '../../src/config';
import type { InkFixture } from '../../src/fixtures/schema';
import { evaluateLeaveOneFixtureOut, evaluateLeaveOneSessionOut, personalReport, safetyViolations, simulateTraining, sumScores } from './personal-eval';
import type { FoldResult } from './personal-eval';
import { assignedSessionPaths, personalSessionFixtures } from './personal-sessions';
import { loadFixtures } from './load';
import { fixtureRole, fixtureRoot } from './roles';
import { relative, resolve, sep } from 'node:path';

const all = loadFixtures(fixtureRoot);
const sessions = personalSessionFixtures(all);
const byName = (name: string) => sessions.find(({ fixture }) => fixture.name === name)!;

it('assigns a session to every recorded regression fixture and nothing else', () => {
  expect(sessions.length).toBeGreaterThanOrEqual(5);
  expect(sessions.every(({ path, fixture }) => fixture.provenance === 'recorded' && fixtureRole(path) === 'regression')).toBe(true);
  // Development (already the built-in bank), evaluation (reserved), and synthetic ink are excluded.
  expect(sessions.some(({ path }) => ['development', 'evaluation'].includes(fixtureRole(path)))).toBe(false);
  const keys = new Set(all.map(({ path }) => relative(fixtureRoot, resolve(path)).split(sep).join('/')));
  expect(assignedSessionPaths.filter((key) => !keys.has(key))).toEqual([]);
});

it('refuses a recorded regression fixture with no session instead of guessing one', () => {
  const stray = { path: resolve(fixtureRoot, 'recorded/unassigned.json'), fixture: byName('Sample-mixed-first-e4-rejected').fixture };
  expect(() => personalSessionFixtures([stray])).toThrow(/^Unassigned fixture role|Unassigned recording session/);
});

it('simulates training with the training screen rules and manual labels only', () => {
  const fixture = byName('Sample-mixed-first-e4-rejected');
  const { samples, refused } = simulateTraining([fixture]);
  const labelled = fixture.fixture.expected.primitives.filter(({ label }) => label !== 'unknown');
  expect(samples.length + refused.length).toBe(labelled.length);
  expect(samples.map(({ label }) => label)).toEqual(labelled.filter((p) => !refused.some(({ sampleId }) => sampleId.endsWith(`#${fixture.fixture.expected.primitives.indexOf(p) + 1}`))).map((p) => p.label));
  expect(samples.every(({ strokes }) => strokes.length === 1 && strokes[0]!.completion === 'complete')).toBe(true);
  expect(new Set(samples.map(({ id }) => id)).size).toBe(samples.length);
});

it('refuses multi-stroke primitives, geometry failures, and over-limit samples like the screen does', () => {
  const base = byName('Sample-mixed-first-e4-rejected').fixture;
  const joined: InkFixture = { ...base, name: 'joined', expected: { ...base.expected, primitives: [
    { label: 'noteheadHollow', strokeIds: [base.document.strokes[0]!.id, base.document.strokes[1]!.id] },
    // The stem stroke labeled as a head cannot pass the head gates.
    { label: 'noteheadFilled', strokeIds: [base.document.strokes[1]!.id] },
  ], events: [] } };
  const { samples, refused } = simulateTraining([{ path: 'x', fixture: joined }]);
  expect(samples).toEqual([]);
  expect(refused.map(({ reason }) => reason)).toEqual([
    'multi-stroke primitives are not supported',
    expect.stringContaining('fails its own geometry gates'),
  ]);
  const many = Array.from({ length: 12 }, (_, i) => ({ path: `x${i}`, fixture: { ...byName('Mixed-e4-seven-notes-four-rejected').fixture, name: `copy-${i}` } }));
  const result = simulateTraining(many);
  for (const label of ['noteheadFilled', 'noteheadHollow', 'stem'] as const) {
    expect(result.samples.filter((s) => s.label === label).length).toBeLessThanOrEqual(config.maxUserTemplatesPerLabel);
  }
  expect(result.refused.some(({ reason }) => reason.startsWith('Limit reached'))).toBe(true);
});

it('never lets a held-out session see its own samples in the strict folds', () => {
  const folds = evaluateLeaveOneSessionOut(sessions);
  expect(folds.map((f) => f.heldOut)).toEqual([...new Set(sessions.map((s) => s.session))].sort());
  for (const fold of folds) {
    expect(fold.trainedFrom).not.toContain(fold.heldOut);
    expect(fold.trainingFixtures.filter((name) => fold.fixtures.includes(name))).toEqual([]);
    const heldSessionNames = new Set(sessions.filter((s) => s.session === fold.heldOut).map((s) => s.fixture.name));
    expect(fold.trainingFixtures.some((name) => heldSessionNames.has(name))).toBe(false);
  }
  // The optimistic variant, by contrast, deliberately reuses same-sitting measures.
  const optimistic = evaluateLeaveOneFixtureOut(sessions);
  const reuse = optimistic.some((fold) => {
    const held = sessions.find((s) => s.fixture.name === fold.fixtures[0])!;
    return sessions.some((s) => s.session === held.session && s !== held && fold.trainingFixtures.includes(s.fixture.name));
  });
  expect(reuse).toBe(true);
});

it('flags a fold where personal samples add wrong accepts or wrong notes', () => {
  const score = (wrongAccepts: number, wrongProposals: number): FoldResult['builtin'] => ({
    primitives: { total: 10, exact: 8, wrongAccepts, knownRejects: 2 - wrongAccepts }, events: { expected: 4, proposedExactly: 3, wrongProposals } });
  const fold = (builtin: FoldResult['builtin'], personal: FoldResult['builtin']): FoldResult => ({
    heldOut: 's', fixtures: ['f'], trainedFrom: ['t'], trainingFixtures: ['g'], samples: 5, refused: [], builtin, personal });
  expect(safetyViolations([fold(score(0, 0), score(0, 0))])).toEqual([]);
  expect(safetyViolations([fold(score(1, 1), score(0, 0))])).toEqual([]);
  expect(safetyViolations([fold(score(0, 0), score(1, 0))])).toEqual(['s: personal samples added wrong accepted shapes (0 -> 1)']);
  expect(safetyViolations([fold(score(0, 0), score(0, 2))])).toEqual(['s: personal samples added wrong proposed notes (0 -> 2)']);
  expect(sumScores([fold(score(0, 0), score(0, 0)), fold(score(1, 1), score(1, 1))], 'builtin').primitives.total).toBe(20);
});

it('reports built-in vs personal on recorded sessions and holds the safety rule', () => {
  const strict = evaluateLeaveOneSessionOut(sessions), optimistic = evaluateLeaveOneFixtureOut(sessions);
  const report = personalReport(strict, optimistic);
  console.info(report);
  expect(report).toContain('STRICT leave-one-session-out');
  expect(report).toContain('OPTIMISTIC leave-one-fixture-out');
  // Pre-stated safety rule, NOT an accuracy target: no accuracy threshold is asserted.
  expect(safetyViolations(strict)).toEqual([]);
  expect(safetyViolations(optimistic)).toEqual([]);
  // Scoring covers the same held-out ink for both banks.
  for (const fold of [...strict, ...optimistic]) {
    expect(fold.personal.primitives.total).toBe(fold.builtin.primitives.total);
    expect(fold.personal.events.expected).toBe(fold.builtin.events.expected);
  }
});
