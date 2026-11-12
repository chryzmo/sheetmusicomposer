import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { config } from '../../src/config';
import { createHistory, executeCommand, redo, undo } from '../../src/edit/history';
import { addStrokeCommand } from '../../src/edit/stroke-command';
import { parseFixture } from '../../src/fixtures/schema';
import type { SketchDocument } from '../../src/model/document';
import { groupStrokes } from '../../src/recognize/group';
import { prepareMusicReview, reviewedMusicCommand } from '../../src/recognize/review';
import { createRuntimeBank } from '../../src/recognize/runtime-bank';
import { parseBackup, serializeBackup } from '../../src/store/schema';

// Template-derived/self-similar SYNTHETIC regression, not novel handwriting.
// No evaluation files, oracle labels, raw sample-clock assumptions, or tuning.
const fixture = parseFixture(readFileSync(new URL('../../fixtures/synthetic/runtime-review.json', import.meta.url), 'utf8'));
const base: SketchDocument = fixture.document;
const bank = createRuntimeBank();
function grouped() {
  const observations = base.strokes.map((stroke, i) => ({ stroke, startedAt: i * 100, endedAt: i * 100 + 40,
    location: { measureId: fixture.name, beatId: null } }));
  const result = groupStrokes(observations, { now: 400, finishMeasure: true });
  expect(result.readyMeasureIds).toEqual([fixture.name]);
  return result.closed;
}
const decide = (selected = [{ candidateIndex: 0, eventId: 'quarter' }, { candidateIndex: 1, eventId: 'whole' }]) => ({
  kind: 'user-reviewed' as const, measureId: fixture.name, timeSignature: '4/4' as const, selected,
});

it('composes authored grouping → recorded bank → assembly → review without labels as inputs or model edits', () => {
  const before = structuredClone({ base, bank });
  const review = prepareMusicReview(base, bank, grouped());
  expect(review.grouping).toBe('explicit-partition');
  expect(review.candidates.map(({ note }) => ({ kind: note.kind, pitch: note.pitch, duration: note.duration,
    dots: note.dots, accidental: note.accidental, strokeIds: note.strokeIds }))).toEqual(fixture.expected.events);
  expect(review.classifications.map((c) => c.label)).toEqual(fixture.expected.primitives.map((p) => p.label));
  expect(review.assembly.unresolvedStrokeIds).toEqual(['review-unknown']);
  expect(review.bankId).toBe('pencil-dev-v1');
  expect(review.supportPolicy).toEqual({ id: 'distance-headroom-v1', maxDistance: 1.5, sampleCount: 32 });
  for (const candidate of review.candidates) {
    expect(candidate.shapeSupport).toBeGreaterThanOrEqual(0);
    expect(candidate.shapeSupport).toBeLessThanOrEqual(1);
    expect(candidate.shapeSupport).toBe(1 - Math.max(...candidate.evidence.map((p) => p.candidates[0]!.distance)) / 1.5);
    for (const p of candidate.evidence) {
      expect(review.classifications).toContain(p);
      expect(p.rejection).toBeNull(); expect(p.margin).toBeGreaterThanOrEqual(0.1);
      expect(p.candidates[0]!.source.kind).toBe('builtin');
    }
  }
  expect({ base, bank }).toEqual(before);
  expect(base.measures).toBeUndefined();
});

it('honestly uses singleton fallback without clocks or labels for preexisting/reloaded ink', () => {
  const a = prepareMusicReview(base, bank), b = prepareMusicReview(base, bank, grouped());
  expect(a.grouping).toBe('singleton-fallback');
  expect(a.candidates).toEqual(b.candidates);
  expect(a.classifications.map((p) => p.strokeIds)).toEqual(base.strokes.map((s) => [s.id]));
});

it('does NOT join fragments in fallback; an explicit complete partition is a separate caller decision', () => {
  const head = base.strokes[0]!, middle = Math.floor(head.points.length / 2);
  const split: SketchDocument = { strokes: [{ ...head, id: 'a', points: head.points.slice(0, middle) },
    { ...head, id: 'b', points: head.points.slice(middle) }, ...base.strokes.slice(1)] };
  const review = prepareMusicReview(split, bank);
  expect(review.classifications.slice(0, 2).map((p) => p.strokeIds)).toEqual([['a'], ['b']]);
  expect(review.classifications).toHaveLength(5);
  const explicit = prepareMusicReview(split, bank, [{ strokeIds: ['b', 'a'] }, ...base.strokes.slice(1).map((s) => ({ strokeIds: [s.id] }))]);
  expect(explicit.classifications[0]!.strokeIds).toEqual(['a', 'b']);
});

it('saves only explicitly selected notes, preserves IDs on redo, and round-trips v2 without changing any raw sample', () => {
  const review = prepareMusicReview(base, bank), history = createHistory(base);
  const command = reviewedMusicCommand(review, decide());
  expect(base.measures).toBeUndefined();
  executeCommand(history, command);
  const after = history.document;
  expect(after.strokes).toBe(base.strokes);
  expect(after.measures?.[0]?.events.map((e) => e.id)).toEqual(['quarter', 'whole']);
  expect(after.measures?.[0]?.events.map((e) => e.confidence)).toEqual(review.candidates.map((c) => c.shapeSupport));
  expect(after.measures?.[0]?.unresolvedStrokeIds).toEqual(['review-unknown']);
  expect(parseBackup(serializeBackup(after))).toEqual(after);
  expect(JSON.parse(serializeBackup(after)).version).toBe(2);
  undo(history); expect(history.document).toBe(base);
  redo(history); expect(history.document).toBe(after);
  expect(after.strokes).toEqual(fixture.document.strokes);
});

it('retains every unselected candidate source as unresolved and sorts selection by musical order, not click order', () => {
  const review = prepareMusicReview(base, bank);
  const partial = reviewedMusicCommand(review, decide([{ candidateIndex: 1, eventId: 'whole' }])).apply(base);
  expect(partial.measures?.[0]?.events.map((e) => e.id)).toEqual(['whole']);
  expect(partial.measures?.[0]?.unresolvedStrokeIds).toEqual(['review-head', 'review-stem', 'review-unknown']);
  const reverse = reviewedMusicCommand(review, decide([...decide().selected].reverse())).apply(base);
  expect(reverse.measures?.[0]?.events.map((e) => e.id)).toEqual(['quarter', 'whole']);
  const none = reviewedMusicCommand(review, decide([])).apply(base);
  expect(none.measures?.[0]?.events).toEqual([]);
  expect(none.measures?.[0]?.unresolvedStrokeIds).toEqual(base.strokes.map((s) => s.id));
});

it('reuses guarded score commands: intervening ink rejects stale acceptance atomically, and drawing after acceptance is undoable', () => {
  const review = prepareMusicReview(base, bank), command = reviewedMusicCommand(review, decide()), history = createHistory(base);
  const extra = { ...base.strokes[3]!, id: 'new-ink' };
  executeCommand(history, addStrokeCommand(extra));
  const changed = history.document;
  expect(() => executeCommand(history, command)).toThrow('document changed');
  expect(history.document).toBe(changed); expect(history.undoStack).toHaveLength(1);
  undo(history); executeCommand(history, command);
  const saved = history.document;
  executeCommand(history, addStrokeCommand(extra));
  expect(history.document.measures?.[0]?.events).toEqual([]);
  undo(history); expect(history.document).toBe(saved);
});

it.each([-1, 2, 0.5, NaN, Infinity])('rejects invalid reviewed index %s', (candidateIndex) => {
  expect(() => reviewedMusicCommand(prepareMusicReview(base, bank), decide([{ candidateIndex, eventId: 'x' }]))).toThrow();
});
it('rejects duplicate selections/IDs and requires an explicit reviewed decision', () => {
  const review = prepareMusicReview(base, bank);
  expect(() => reviewedMusicCommand(review, decide([{ candidateIndex: 0, eventId: 'x' }, { candidateIndex: 0, eventId: 'y' }]))).toThrow();
  expect(() => reviewedMusicCommand(review, decide([{ candidateIndex: 0, eventId: 'x' }, { candidateIndex: 1, eventId: 'x' }]))).toThrow();
  const unconfirmed = decide(); Reflect.set(unconfirmed, 'kind', 'automatic');
  expect(() => reviewedMusicCommand(review, unconfirmed)).toThrow('reviewed decision');
});
it.each([
  [[], 'cover every'], [[{ strokeIds: [] }], 'nonempty'], [[{ strokeIds: ['missing'] }], 'known disjoint'],
  [[{ strokeIds: ['review-head', 'review-head'] }], 'known disjoint'],
] as const)('rejects incomplete/invalid partitions before matching %#', (groups, error) => {
  expect(() => prepareMusicReview(base, bank, groups)).toThrow(error);
});
it('refuses oversized work without truncating ink and refuses collapsing multiple measures', () => {
  const original = structuredClone(base);
  expect(() => prepareMusicReview(base, bank, Array.from({ length: config.assemblyMaxPrimitives + 1 }, () => ({ strokeIds: ['review-head'] })))).toThrow('primitive work limit');
  const huge: SketchDocument = { strokes: [{ ...base.strokes[0]!, points: Array.from({ length: config.reviewMaxPoints + 1 }, () => base.strokes[0]!.points[0]!) }] };
  expect(() => prepareMusicReview(huge, bank)).toThrow('point work limit');
  const atLimit: SketchDocument = { strokes: [{ ...huge.strokes[0]!, points: huge.strokes[0]!.points.slice(1) }] };
  const boundary = prepareMusicReview(atLimit, bank);
  expect(boundary.base.strokes[0]!.points).toHaveLength(config.reviewMaxPoints);
  expect(boundary.assembly.unresolvedStrokeIds).toEqual(['review-head']);
  const m = { id: 'a', clef: 'treble' as const, timeSignature: '4/4' as const, events: [], unresolvedStrokeIds: [] };
  expect(() => prepareMusicReview({ ...base, measures: [m, { ...m, id: 'b' }] }, bank)).toThrow('one-measure');
  expect(() => prepareMusicReview({ strokes: [base.strokes[0]!, base.strokes[0]!] }, bank)).toThrow('unique');
  expect(base).toEqual(original);
});
it('keeps interrupted/unknown source ink unresolved; empty reviews never fabricate events', () => {
  const interrupted: SketchDocument = { strokes: base.strokes.map((s, i) => i === 0 ? { ...s, completion: 'interrupted' } : s) };
  const review = prepareMusicReview(interrupted, bank);
  expect(review.candidates.map((c) => c.note.duration)).toEqual(['whole']);
  expect(review.assembly.unresolvedStrokeIds).toContain('review-head');
  expect(prepareMusicReview({ strokes: [] }, bank).candidates).toEqual([]);
});

// Real Pencil regressions: known misses are documented baselines, not tuned away.
// `proposed` lists the expected-event indices the current bank/singleton pipeline reproduces.
// Every other event gets no proposal (its strokes stay unresolved ink); nothing wrong is proposed.
it.each([
  ['sample-fail.json', [1, 2, 3, 4, 5]],
  ['a4-whole-x4.json', [0, 1, 3]],
  ['c5-quarters-half-whole.json', [0, 3]],
  ['e4-seven-notes.json', [1, 3, 6]],
] as const)('recorded %s: proposes only the documented correct notes and never a wrong one', (file, proposed) => {
  const recorded = parseFixture(readFileSync(new URL(`../../fixtures/recorded/${file}`, import.meta.url), 'utf8'));
  const review = prepareMusicReview(recorded.document, createRuntimeBank());
  expect(review.grouping).toBe('singleton-fallback');
  const emitted = review.candidates.map(({ note }) => ({ kind: note.kind, pitch: note.pitch, duration: note.duration,
    dots: note.dots, accidental: note.accidental, strokeIds: note.strokeIds }));
  expect(emitted).toEqual(proposed.map((i) => recorded.expected.events[i]));
  const covered = new Set(proposed.flatMap((i) => recorded.expected.events[i]!.strokeIds));
  const unresolved = recorded.document.strokes.map(({ id }) => id).filter((id) => !covered.has(id));
  expect([...review.assembly.unresolvedStrokeIds].sort()).toEqual(unresolved.sort());
});

// A free-drawn measure (Label measure) with ten notes: seven are proposed correctly and three are left as ink. It once
// proposed ONE note wrongly (a quarter as a half, because its tightly scribbled filled head was read as hollow); the
// ink-density veto now withholds that head, which turns the wrong note into ink. Nothing wrong is proposed.
it('free-20261112-1656: seven notes right, three left as ink, nothing wrong', () => {
  const recorded = parseFixture(readFileSync(new URL('../../fixtures/recorded/free-20261112-1656.json', import.meta.url), 'utf8'));
  const review = prepareMusicReview(recorded.document, createRuntimeBank());
  const events = recorded.expected.events;
  const emitted = review.candidates.map(({ note }) => ({ kind: note.kind, pitch: note.pitch, duration: note.duration,
    dots: note.dots, accidental: note.accidental, strokeIds: note.strokeIds }));
  expect(emitted).toEqual([3, 4, 5, 6, 7, 8, 9].map((i) => events[i]));
  // Event 1 (E4 quarter): head withheld by the density veto. Events 2 and 3 (F4, G4 quarters): heads rejected on
  // distance and margin. In all three the head and stem stay as visible ink.
  const missed = new Set([0, 1, 2].flatMap((i) => events[i]!.strokeIds));
  expect([...review.assembly.unresolvedStrokeIds].sort()).toEqual([...missed].sort());
});
