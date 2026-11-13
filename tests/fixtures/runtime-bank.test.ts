import { expect, it } from 'vitest';
import { createRuntimeBank } from '../../src/recognize/runtime-bank';
import { classificationReport, evaluatePrimitives } from './classification';
import { loadFixtures } from './load';
import { fixtureRole, fixtureRoot } from './roles';

// Regression diagnostics ONLY. Exclude development self-matches and evaluation
// by explicit role; new template-derived synthetic positives remain their own set.
const fixtures = loadFixtures(fixtureRoot).filter(({ path }) => fixtureRole(path) === 'regression');
it('reports the new runtime bank separately from unchanged synthetic-bank baselines', () => {
  const observations = evaluatePrimitives(fixtures, createRuntimeBank().templates);
  console.info('Runtime bank pencil-dev-v1 — regression diagnostics, NOT independent/held-out handwriting accuracy. Template-derived runtime-review-self-derived positives are a separate set.');
  console.info(classificationReport(observations, 'pencil-dev-v1 recorded development bank (15 templates, builtin provenance)'));
  expect(observations).toHaveLength(fixtures.reduce((total, { fixture }) => total + fixture.expected.primitives.length, 0));
  // Authored synthetic sets are fixed, so they are pinned per set.
  const expected = [
    ['classifier-boundaries', 4, 12], ['classifier-linearity', 6, 6],
    ['primitive-grouping', 4, 9], ['runtime-review-self-derived', 4, 4],
    ['simple-note-assembly', 15, 16], ['synthetic-smoke', 3, 5],
  ] as const;
  for (const [set, exact, total] of expected) {
    const rows = observations.filter((o) => o.set === set);
    expect(rows).toHaveLength(total);
    expect(rows.filter((o) => o.expected === o.result.label)).toHaveLength(exact);
  }
  // Recorded fixtures are pinned per fixture, by name: existing ones stay locked against
  // regressions, while a newly imported fixture needs no edit here (it is reported above and
  // held to the no-wrong-accepts rule below). Add it to this table to lock in its result.
  const recordedPins = [
    ['Quarter-e4', 1, 2], ['Sample-mixed-first-e4-rejected', 9, 10], ['Mixed-a4-whole-x4-third-rejected', 3, 4],
    ['Mixed-c5-quarters-half-whole-two-rejected', 5, 7], ['Mixed-e4-seven-notes-four-rejected', 6, 11],
    ['free-20261112-1656', 16, 19],
  ] as const;
  for (const [name, exact, total] of recordedPins) {
    const rows = observations.filter((o) => o.fixtureName === name);
    expect(rows, name).toHaveLength(total);
    expect(rows.filter((o) => o.expected === o.result.label), name).toHaveLength(exact);
  }
  // Wrong accepts (a shape confidently read as the wrong label) are the failures that matter most, so
  // every one must be NAMED here. The list must equal what the recognizer actually does: a new wrong
  // accept fails this test, and so does fixing a listed one without removing its entry, which keeps
  // the list honest. Entries are [fixture, 1-based stroke number, expected label, label it was read as].
  // (Empty now: the tightly scribbled filled head in free-20261112-1656, once read as hollow, is withheld by
  // the ink-density veto. A future wrong accept is named here with a comment saying why.)
  const knownWrongAccepts: readonly (readonly [string, number, string, string])[] = [];
  const wrongAccepts = observations.filter((o) => o.result.label !== 'unknown' && o.result.label !== o.expected).map((o) => {
    const { document } = fixtures.find(({ fixture }) => fixture.name === o.fixtureName)!.fixture;
    return [o.fixtureName, document.strokes.findIndex((s) => s.id === o.result.strokeIds[0]) + 1, o.expected, o.result.label];
  });
  expect(wrongAccepts).toEqual(knownWrongAccepts.map((entry) => [...entry]));
  expect(observations.every((o) => o.set !== 'Pencil-eval-session-2' && o.set !== 'Pencil-template-dev-1')).toBe(true);
});
