import { expect, it } from 'vitest';
import { classifyPrimitive } from '../../src/recognize/classify';
import { createRuntimeBank } from '../../src/recognize/runtime-bank';
import { config } from '../../src/config';
import { loadFixtures } from './load';
import { personalSessionFixtures } from './personal-sessions';
import { fixtureRoot } from './roles';

// The ink-density veto is one-directional: it may only withhold a head the templates read as HOLLOW when its
// ink is extreme. These tests run it over every recorded fixture so a change cannot start vetoing a correct
// hollow head, or silently stop vetoing the known filled head, without this file saying so.
const fixtures = personalSessionFixtures(loadFixtures(fixtureRoot));
const templates = createRuntimeBank().templates;
const heads = fixtures.flatMap(({ fixture }) => fixture.expected.primitives
  .filter((p) => p.strokeIds.length === 1 && (p.label === 'noteheadFilled' || p.label === 'noteheadHollow'))
  .map((p) => {
    const index = fixture.document.strokes.findIndex((s) => s.id === p.strokeIds[0]);
    return { name: fixture.name, number: index + 1, expected: p.label, result: classifyPrimitive([fixture.document.strokes[index]!], templates) };
  }));

it('withholds exactly the known scribbled filled head, as ink, and never a correct hollow head', () => {
  const vetoed = heads.filter(({ result }) => result.rejection === 'ink-density');
  expect(vetoed.map(({ name, number, expected }) => [name, number, expected])).toEqual([['free-20261112-1656', 1, 'noteheadFilled']]);
  expect(vetoed[0]!.result.label).toBe('unknown');
  expect(vetoed[0]!.result.inkDensity!).toBeGreaterThanOrEqual(config.primitiveHollowVetoInkDensity);
  // It would have been a wrong accept without the veto: the nearest template is hollow.
  expect(vetoed[0]!.result.candidates[0]!.label).toBe('noteheadHollow');
  // No head that is really hollow is ever withheld by it.
  expect(heads.filter(({ expected, result }) => expected === 'noteheadHollow' && result.rejection === 'ink-density')).toEqual([]);
});

it('leaves the heaviest recorded hollow heads accepted, just under the threshold', () => {
  const hollow = heads.filter(({ expected, result }) => expected === 'noteheadHollow' && result.label === 'noteheadHollow');
  const heaviest = Math.max(...hollow.map(({ result }) => result.inkDensity!));
  expect(heaviest).toBeGreaterThan(9);
  expect(heaviest).toBeLessThan(config.primitiveHollowVetoInkDensity);
});

it('does not touch dense filled heads: the veto only ever removes a hollow reading', () => {
  const denseFilled = heads.filter(({ expected, result }) => expected === 'noteheadFilled' && result.label === 'noteheadFilled' && result.inkDensity! >= config.primitiveHollowVetoInkDensity);
  expect(denseFilled.length).toBeGreaterThan(0);
  expect(heads.filter(({ result }) => result.label === 'noteheadFilled' && result.rejection === 'ink-density')).toEqual([]);
});

it('reports ink density for a single stroke and none for several, and only vetoes a single stroke', () => {
  const free = fixtures.find(({ fixture }) => fixture.name === 'free-20261112-1656')!.fixture;
  const [scribble, stem] = free.document.strokes as [typeof free.document.strokes[number], typeof free.document.strokes[number]];
  expect(classifyPrimitive([scribble], templates).inkDensity).toBeGreaterThan(13);
  const group = classifyPrimitive([scribble, stem], templates);
  expect(group.inkDensity).toBeNull();
  expect(group.rejection).not.toBe('ink-density');
});
