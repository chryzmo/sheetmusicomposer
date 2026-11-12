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
  expect(observations).toHaveLength(86);
  const expected = [
    ['classifier-boundaries', 4, 12], ['classifier-linearity', 6, 6], ['personal', 24, 34],
    ['primitive-grouping', 4, 9], ['runtime-review-self-derived', 4, 4],
    ['simple-note-assembly', 15, 16], ['synthetic-smoke', 3, 5],
  ] as const;
  for (const [set, exact, total] of expected) {
    const rows = observations.filter((o) => o.set === set);
    expect(rows).toHaveLength(total);
    expect(rows.filter((o) => o.expected === o.result.label)).toHaveLength(exact);
  }
  expect(observations.filter((o) => o.result.label !== 'unknown' && o.result.label !== o.expected)).toEqual([]);
  expect(observations.every((o) => o.set !== 'Pencil-eval-session-2' && o.set !== 'Pencil-template-dev-1')).toBe(true);
});
