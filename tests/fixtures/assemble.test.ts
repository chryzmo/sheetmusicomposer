import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { assembleSimpleNotes } from '../../src/recognize/assemble';
import { createBuiltinTemplates } from '../../src/recognize/builtins';
import { classifyPrimitive } from '../../src/recognize/classify';
import { loadFixtures } from './load';
import { fixtureRole, fixtureRoot } from './roles';

// Only these fixtures have exhaustive simple-note assembly truth. Empty events
// on primitive-only recordings are NOT ground truth saying "recognize no notes".
// Neither development nor evaluation handwriting is passed to assembly here.
const selectedPaths = new Set(['quarter-c4.json', 'half-e4.json', 'simple-note-assembly.json']
  .map((name) => fileURLToPath(new URL(`../../fixtures/synthetic/${name}`, import.meta.url))));
const cases = loadFixtures(fixtureRoot).filter(({ path }) => fixtureRole(path) === 'regression' && selectedPaths.has(path));

it.each(cases)('matches oracle-label pitch/duration/source truth in $fixture.name', ({ fixture }) => {
  const before = structuredClone(fixture);
  const result = assembleSimpleNotes(fixture.document.strokes, fixture.expected.primitives);
  expect(result.notes.map((n) => ({ kind: n.kind, pitch: n.pitch, duration: n.duration, dots: n.dots,
    accidental: n.accidental, strokeIds: n.strokeIds }))).toEqual(fixture.expected.events);
  const all = [...result.notes.flatMap((n) => n.strokeIds), ...result.unresolvedStrokeIds];
  expect([...all].sort()).toEqual(fixture.document.strokes.map((s) => s.id).sort());
  expect(new Set(all).size).toBe(all.length);
  const indices = [...result.notes.flatMap((n) => n.primitiveIndices), ...result.unresolved.map((u) => u.primitiveIndex)];
  expect([...indices].sort((a, b) => a - b)).toEqual(fixture.expected.primitives.map((_, i) => i));
  expect(fixture).toEqual(before);
});

it('accepts actual classifier results structurally while leaving their evidence unchanged', () => {
  const fixture = cases.find(({ fixture }) => fixture.name === 'synthetic-half-e4')!.fixture;
  const bank = createBuiltinTemplates();
  const classifications = fixture.expected.primitives.map((p) => classifyPrimitive(
    p.strokeIds.map((id) => fixture.document.strokes.find((s) => s.id === id)!), bank));
  const before = structuredClone(classifications);
  const result = assembleSimpleNotes(fixture.document.strokes, classifications);
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0]).toMatchObject({ duration: 'half', pitch: { step: 'E', octave: 4 } });
  expect(result.notes[0]?.primitiveIndices.map((i) => classifications[i]?.label)).toEqual(['noteheadHollow', 'stem']);
  expect(classifications).toEqual(before);
});

it('reports isolated assembly agreement without claiming classifier or handwriting accuracy', () => {
  expect(cases).toHaveLength(3);
  const total = cases.reduce((n, { fixture }) => n + fixture.expected.events.length, 0);
  const actual = cases.reduce((n, { fixture }) => n + assembleSimpleNotes(fixture.document.strokes, fixture.expected.primitives).notes.length, 0);
  expect(total).toBe(7);
  console.info(`Simple-note assembly: ${actual}/${total} synthetic expected events across ${cases.length} fixtures; oracle primitive labels, NOT classifier/end-to-end/handwriting accuracy.`);
});

it('keeps every conflict, blocked note, interrupted head, and unused stem in the new safety fixture as ink', () => {
  const file = cases.find(({ fixture }) => fixture.name === 'synthetic-simple-note-assembly')!;
  const result = assembleSimpleNotes(file.fixture.document.strokes, file.fixture.expected.primitives);
  expect(result.unresolvedStrokeIds).toEqual([
    'conflict-high', 'conflict-low', 'shared-stem', 'blocked-head', 'blocked-stem', 'extra-ink', 'unused-stem', 'interrupted-head',
  ]);
  expect(result.unresolved.map((u) => u.reason)).toEqual([
    'ambiguous-attachment', 'ambiguous-attachment', 'ambiguous-attachment', 'nearby-ink', 'unused-stem', 'unsupported', 'unused-stem', 'interrupted',
  ]);
});
