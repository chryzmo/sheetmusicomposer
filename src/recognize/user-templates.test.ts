import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { config } from '../config';
import { parseFixture } from '../fixtures/schema';
import type { Stroke } from '../ink/types';
import { classifyPrimitive } from './classify';
import { createRuntimeBank } from './runtime-bank';
import {
  checkCanAdd, decodeUserTemplateRecords, decodeUserTemplateSample, encodeUserTemplateSample, mergeTemplateBank, userTemplates,
} from './user-templates';
import type { UserTemplateSample } from './user-templates';

// Real Pencil ink from recorded fixtures is used only as sample STROKES here. These
// tests check validation, merging, identity, and mechanics. They are not accuracy
// evidence: the same-session fixtures are not held out from one another.
const load = (name: string) => parseFixture(readFileSync(new URL(`../../fixtures/recorded/${name}.json`, import.meta.url), 'utf8'));
const strokesFor = (fixture: ReturnType<typeof load>, strokeIds: readonly string[]): Stroke[] =>
  strokeIds.map((id) => fixture.document.strokes.find((s) => s.id === id)!);
function samplesFrom(name: string, startAt = 1000): UserTemplateSample[] {
  const fixture = load(name);
  return fixture.expected.primitives.flatMap((p, i) => (p.label === 'noteheadFilled' || p.label === 'noteheadHollow' || p.label === 'stem')
    ? [{ id: `${name}-${i + 1}`, label: p.label, createdAt: startAt + i, strokes: strokesFor(fixture, p.strokeIds) }] : []);
}
const head: UserTemplateSample = samplesFrom('sample-fail').find(({ label }) => label === 'noteheadHollow')!;
const stored = (overrides: Record<string, unknown> = {}): unknown => ({ ...encodeUserTemplateSample(head), ...overrides });

it('round-trips a saved sample through its stored form without altering raw ink', () => {
  const copy = JSON.parse(JSON.stringify(encodeUserTemplateSample(head))) as unknown;
  expect(decodeUserTemplateSample(copy)).toEqual(head);
});

it.each<[string, unknown, string]>([
  ['a non-object', 5, 'Expected an object'],
  ['another format', stored({ format: 'sheetmusicomposer' }), 'Not a personal template'],
  ['an unknown version', stored({ version: 2 }), 'Unsupported personal template version'],
  ['an empty ID', stored({ id: ' ' }), 'Invalid template ID'],
  ['an unsupported label', stored({ label: 'flag' }), 'Unsupported template label'],
  ['an unknown label', stored({ label: 'unknown' }), 'Unsupported template label'],
  ['a fractional creation time', stored({ createdAt: 1.5 }), 'Invalid template creation time'],
  ['a negative creation time', stored({ createdAt: -1 }), 'Invalid template creation time'],
  ['no strokes', stored({ strokes: [] }), 'Template needs 1 to'],
  ['strokes that are not a list', stored({ strokes: 'x' }), 'Invalid stroke list'],
  ['too many strokes', stored({ strokes: Array.from({ length: config.groupMaxStrokesPerGroup + 1 }, (_, i) => ({ ...head.strokes[0]!, id: `s${i}` })) }), 'Template needs 1 to'],
  ['an interrupted stroke', stored({ strokes: [{ ...head.strokes[0]!, completion: 'interrupted' }] }), 'must be complete'],
  ['non-finite ink', stored({ strokes: [{ ...head.strokes[0]!, points: [{ ...head.strokes[0]!.points[0]!, x: null }] }] }), 'Invalid x'],
])('rejects %s', (_name, value, message) => {
  expect(() => decodeUserTemplateSample(value)).toThrow(message);
});

it('rejects a sample with more raw points than the per-sample limit', () => {
  const stroke = head.strokes[0]!, point = stroke.points[0]!;
  const big = { ...stroke, points: Array.from({ length: config.maxUserTemplatePoints + 1 }, () => point) };
  expect(() => decodeUserTemplateSample(stored({ strokes: [big] }))).toThrow('too many ink points');
});

it('refuses to add a duplicate ID or exceed the per-shape limit, leaving the set unchanged', () => {
  expect(() => checkCanAdd([head], head)).toThrow('already exists');
  const full = Array.from({ length: config.maxUserTemplatesPerLabel }, (_, i) => ({ ...head, id: `h${i}` }));
  expect(() => checkCanAdd(full, { ...head, id: 'one-more' })).toThrow('Limit reached');
  expect(() => checkCanAdd(full, { ...samplesFrom('sample-fail').find(({ label }) => label === 'stem')!, id: 'a-stem' })).not.toThrow();
  expect(full).toHaveLength(config.maxUserTemplatesPerLabel);
});

it('skips damaged, unsupported, duplicate, and over-limit records instead of throwing', () => {
  const good = samplesFrom('sample-fail');
  const extra = Array.from({ length: config.maxUserTemplatesPerLabel + 2 }, (_, i) => ({ ...head, id: `extra-${i}`, createdAt: 5000 + i }));
  const records: [string, unknown][] = [
    ...good.map((s, i): [string, unknown] => [`k${i}`, encodeUserTemplateSample(s)]),
    ['bad-json', { nonsense: true }], ['null', null], ['dupe', encodeUserTemplateSample(good[0]!)],
    ['flag', stored({ id: 'f', label: 'flag' })],
    ...extra.map((s, i): [string, unknown] => [`x${i}`, encodeUserTemplateSample(s)]),
  ];
  const { samples, skipped } = decodeUserTemplateRecords(records);
  expect(samples.filter(({ label }) => label === 'noteheadHollow')).toHaveLength(config.maxUserTemplatesPerLabel);
  const reasons = new Map(skipped.map(({ key, reason }) => [key, reason]));
  expect(reasons.get('bad-json')).toBeTruthy();
  expect(reasons.get('null')).toBeTruthy();
  // Identical duplicates: exactly one copy survives (deterministically the lower key).
  expect([reasons.get('dupe'), reasons.get('k0')].filter((r) => r === 'Duplicate template ID')).toHaveLength(1);
  expect(reasons.get('flag')).toBe('Unsupported template label');
  // Over-limit keeps the OLDEST samples; the newest extras are the ones dropped.
  const over = skipped.filter(({ reason }) => reason.startsWith('Over the')).map(({ key }) => key);
  expect(over.length).toBeGreaterThan(0);
  expect(over.every((key) => key.startsWith('x'))).toBe(true);
  expect(samples.some(({ id }) => id === 'extra-31')).toBe(false);
  expect(new Set(samples.map(({ id }) => id)).size).toBe(samples.length);
});

it('decodes to the same ordered set regardless of storage order', () => {
  const records = samplesFrom('sample-fail').map((s): [string, unknown] => [s.id, encodeUserTemplateSample(s)]);
  const forward = decodeUserTemplateRecords(records).samples.map(({ id }) => id);
  expect(decodeUserTemplateRecords([...records].reverse()).samples.map(({ id }) => id)).toEqual(forward);
});

it('merges with no samples as exactly the built-in bank and identity', () => {
  const builtin = createRuntimeBank(), merged = mergeTemplateBank(builtin, []);
  expect(merged.id).toBe('pencil-dev-v1');
  expect(merged.userSampleIds).toEqual([]);
  expect(merged.templates).toEqual(builtin.templates);
});

it('namespaces personal templates as user provenance and never mutates the built-in bank', () => {
  const builtin = createRuntimeBank(), before = structuredClone(builtin);
  const samples = samplesFrom('sample-fail');
  const merged = mergeTemplateBank(builtin, samples);
  expect(builtin).toEqual(before);
  expect(merged.templates).toHaveLength(15 + samples.length);
  const added = merged.templates.slice(15);
  expect(added.every((t) => t.id.startsWith('user/') && t.source.kind === 'user')).toBe(true);
  expect(new Set(merged.templates.map((t) => t.id)).size).toBe(merged.templates.length);
  expect(userTemplates(samples).map((t) => t.label)).toEqual(samples.map((s) => s.label));
  expect(() => mergeTemplateBank(builtin, [head, head])).toThrow('Duplicate personal template ID');
});

it('changes bank identity on any add, delete, or relabel, and not with input order', () => {
  const builtin = createRuntimeBank(), samples = samplesFrom('sample-fail');
  const base = mergeTemplateBank(builtin, samples).id;
  expect(base).toMatch(/^pencil-dev-v1\+user-10-[0-9a-f]{8}$/);
  expect(mergeTemplateBank(builtin, [...samples].reverse()).id).toBe(base);
  expect(mergeTemplateBank(builtin, samples.slice(1)).id).not.toBe(base);
  expect(mergeTemplateBank(builtin, [...samples, { ...head, id: 'new' }]).id).not.toBe(base);
  const relabeled = samples.map((s, i) => i === 0 ? { ...s, label: 'stem' as const } : s);
  expect(mergeTemplateBank(builtin, relabeled).id).not.toBe(base);
  expect(mergeTemplateBank(builtin, samples.slice(0, 1)).id).not.toBe(mergeTemplateBank(builtin, samples.slice(1, 2)).id);
});

// Mechanics demonstration only (same-session, not held-out accuracy): personal
// head samples can turn a documented distance rejection into an accepted head.
it('lets personal samples change a documented rejection, without breaking an existing accept', () => {
  const c5 = load('c5-quarters-half-whole');
  const query = strokesFor(c5, c5.expected.primitives[4]!.strokeIds);
  const builtin = createRuntimeBank();
  const before = classifyPrimitive(query, builtin.templates);
  expect(before.label).toBe('unknown');
  expect(before.rejection).toBe('distance');
  const others = ['sample-fail', 'a4-whole-x4', 'e4-seven-notes'].flatMap((name) => samplesFrom(name).map((s) => ({ ...s, id: `${name}/${s.id}` })));
  const merged = mergeTemplateBank(builtin, others);
  const after = classifyPrimitive(query, merged.templates);
  expect(after.label).toBe('noteheadHollow');
  const accepted = classifyPrimitive(strokesFor(c5, c5.expected.primitives[3]!.strokeIds), merged.templates);
  expect(accepted.label).toBe('stem');
});
