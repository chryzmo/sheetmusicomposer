import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseFixture } from '../fixtures/schema';
import { createDevelopmentTemplates } from '../../tests/fixtures/development';
import { createRuntimeBank, decodeRuntimeBank } from './runtime-bank';
import seeds from './runtime-seeds.json';

type Artifact = typeof seeds;
it('exactly reproduces all fifteen approved development clouds, with builtin provenance only', () => {
  // Fixed development path only; never read or score an evaluation query here.
  const path = fileURLToPath(new URL('../../fixtures/recorded/development/pencil-dev-1.json', import.meta.url));
  const raw = readFileSync(path), fixture = parseFixture(raw.toString('utf8'));
  const bank = createRuntimeBank();
  expect(createHash('sha256').update(raw).digest('hex')).toBe(bank.source.sha256);
  const expected = createDevelopmentTemplates([{ path, fixture }]).map((t) => ({ ...t, source: { ...t.source, kind: 'builtin' } }));
  expect(bank.templates).toEqual(expected);
  expect(bank.templates).toHaveLength(15);
  expect(new Set(bank.templates.map((t) => t.label))).toEqual(new Set(['noteheadFilled', 'noteheadHollow', 'stem']));
  expect(bank.source.role).toBe('development');
  // Exact cloud equality is an integrity test, NOT handwriting recognition accuracy.
});

it('returns independent copies, not mutable aliases of the artifact/another bank', () => {
  const a = createRuntimeBank(), b = createRuntimeBank();
  Reflect.set(a.templates[0]!.cloud.points[0]!, 'x', 0.987);
  Reflect.set(a.source, 'sha256', 'changed');
  expect(b).toEqual(createRuntimeBank());
  expect(a).not.toEqual(b);
});

const corruptions: readonly [string, (b: Artifact) => void][] = [
  ['version', (b) => { b.version = 99; }],
  ['sample count', (b) => { b.sampleCount = 64; }],
  ['bank id', (b) => { b.id = 'other'; }],
  ['evaluation path', (b) => { b.source.path = 'fixtures/recorded/evaluation/pencil-eval-1.json'; }],
  ['source hash', (b) => { b.source.sha256 = 'changed'; }],
  ['role', (b) => { b.source.role = 'evaluation'; }],
  ['provenance', (b) => { b.source.provenance = 'synthetic'; }],
  ['source name', (b) => { b.source.fixtureName = 'other'; }],
  ['missing sample', (b) => { b.templates.pop(); }],
  ['duplicate template', (b) => { b.templates[1] = structuredClone(b.templates[0]!); }],
  ['unsupported label', (b) => { b.templates[0]!.label = 'unknown'; }],
  ['class balance', (b) => { b.templates[0]!.label = 'stem'; }],
  ['invalid template id', (b) => { b.templates[0]!.id = 'development/Pencil-dev-1/primitive-01'; }],
  ['user impersonation', (b) => { b.templates[0]!.source.kind = 'user'; }],
  ['sample identity', (b) => { b.templates[0]!.source.sampleId = 'other'; }],
  ['duplicate stroke', (b) => { b.templates[1]!.cloud.strokeIds = [...b.templates[0]!.cloud.strokeIds]; }],
  ['missing source stroke', (b) => { b.templates[0]!.cloud.strokeIds = []; }],
  ['empty source id', (b) => { b.templates[0]!.cloud.strokeIds = ['']; }],
  ['missing point', (b) => { b.templates[0]!.cloud.points.pop(); }],
  ['nonfinite point', (b) => { b.templates[0]!.cloud.points[0]!.x = NaN; }],
  ['sparse points', (b) => { Reflect.deleteProperty(b.templates[0]!.cloud.points, '0'); }],
  ['sparse templates', (b) => { Reflect.deleteProperty(b.templates, '0'); }],
  ['unnormalized point', (b) => { b.templates[0]!.cloud.points[0]!.y = 1.01; }],
  ['negative bounds', (b) => { b.templates[0]!.cloud.bounds.width = -1; }],
  ['overflowing bounds', (b) => { b.templates[0]!.cloud.bounds.x = Number.MAX_VALUE; b.templates[0]!.cloud.bounds.width = Number.MAX_VALUE; }],
  ['empty description', (b) => { b.description = ''; }],
];
it.each(corruptions)('rejects malformed/unapproved artifact: %s', (_name, change) => {
  const value = structuredClone(seeds); change(value);
  expect(() => decodeRuntimeBank(value)).toThrow();
});
it.each([null, [], {}, { source: null }])('rejects missing runtime-bank structure %#', (value) => {
  expect(() => decodeRuntimeBank(value)).toThrow();
});
