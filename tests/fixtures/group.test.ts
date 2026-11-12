import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { assembleSimpleNotes } from '../../src/recognize/assemble';
import { createBuiltinTemplates } from '../../src/recognize/builtins';
import { classifyPrimitive } from '../../src/recognize/classify';
import { groupStrokes } from '../../src/recognize/group';
import type { ObservedStroke } from '../../src/recognize/group';
import type { InkFixture } from '../../src/fixtures/schema';
import { loadFixtures } from './load';
import { fixtureRole, fixtureRoot } from './roles';

// Explicitly selected synthetic sources only. Arrival times/regions below are
// authored test inputs, NOT recovered from raw t or fabricated Pencil metadata.
// Expected labels/groups are not inputs to grouping, only compared afterward.
const paths = new Set(['quarter-c4.json', 'half-e4.json', 'simple-note-assembly.json', 'primitive-grouping.json']
  .map((name) => fileURLToPath(new URL(`../../fixtures/synthetic/${name}`, import.meta.url))));
const cases = loadFixtures(fixtureRoot).filter(({ path }) => fixtureRole(path) === 'regression' && paths.has(path));
function observations(fixture: InkFixture): ObservedStroke[] {
  if (fixture.provenance !== 'synthetic') throw new Error('Synthetic observation schedule cannot be applied to recorded ink');
  return fixture.document.strokes.map((stroke, i) => ({ stroke, startedAt: i * 100, endedAt: i * 100 + 40,
    location: { measureId: fixture.name, beatId: null } }));
}
function grouped(fixture: InkFixture) {
  const input = observations(fixture);
  return groupStrokes(input, { now: input.at(-1)!.endedAt, finishMeasure: true });
}

it.each(cases)('matches expected primitive partitions from raw synthetic strokes in $fixture.name', ({ fixture }) => {
  const before = structuredClone(fixture);
  const result = grouped(fixture);
  expect(result.pending).toBeNull();
  expect(result.closed.map((g) => g.strokeIds)).toEqual(fixture.expected.primitives.map((p) => p.strokeIds));
  expect(result.closed.flatMap((g) => g.strokeIds)).toEqual(fixture.document.strokes.map((s) => s.id));
  expect(result.readyMeasureIds).toEqual([fixture.name]);
  expect(fixture).toEqual(before);
});

it('reports grouping partitions separately from shape labels and handwriting accuracy', () => {
  expect(cases).toHaveLength(4);
  const total = cases.reduce((n, { fixture }) => n + fixture.expected.primitives.length, 0);
  expect(total).toBe(29);
  console.info(`Synthetic grouping: 29/29 expected groups, 4/4 exact fixture partitions; authored observation schedule/regions, no oracle primitive inputs. NOT recorded handwriting, native timing, or population accuracy.`);
});

it('composes grouping/classification/assembly on exhaustive synthetic event truth without hiding the known classifier miss', () => {
  const bank = createBuiltinTemplates();
  const scores = cases.filter(({ fixture }) => fixture.expected.events.length > 0).map(({ fixture }) => {
    const result = grouped(fixture);
    const classified = result.closed.map((g) => classifyPrimitive(g.strokeIds.map((id) => fixture.document.strokes.find((s) => s.id === id)!), bank));
    const assembly = assembleSimpleNotes(fixture.document.strokes, classified);
    const actual = assembly.notes.map((n) => ({ kind: n.kind, pitch: n.pitch, duration: n.duration, dots: n.dots,
      accidental: n.accidental, strokeIds: n.strokeIds }));
    // Every emitted candidate must match a full expected event, not merely its
    // pitch. Known rejects still count as misses. No event truth is inferred
    // from empty arrays on primitive-only recordings or the grouping fixture.
    for (const note of actual) expect(fixture.expected.events).toContainEqual(note);
    const all = [...assembly.notes.flatMap((n) => n.strokeIds), ...assembly.unresolvedStrokeIds];
    expect([...all].sort()).toEqual(fixture.document.strokes.map((s) => s.id).sort());
    expect(new Set(all).size).toBe(all.length);
    return { name: fixture.name, accepted: actual.length, expected: fixture.expected.events.length };
  });
  expect(scores).toEqual([
    { name: 'synthetic-half-e4', accepted: 1, expected: 1 },
    { name: 'synthetic-quarter-c4', accepted: 0, expected: 1 },
    { name: 'synthetic-simple-note-assembly', accepted: 5, expected: 5 },
  ]);
  console.info('Synthetic group → classify → assemble: 6/7 exact expected events, no extra/wrong emitted candidates; C4-quarter head still rejected by classifier. NOT real handwriting/end-to-end app accuracy.');
});
