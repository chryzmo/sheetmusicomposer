import { config } from '../config';
import type { Stroke } from '../ink/types';
import { decodeSketch, object } from '../store/schema';
import type { SimplePrimitive } from './primitives';
import type { RuntimeBank } from './runtime-bank';
import { prepareTemplate } from './templates';
import type { PointCloudTemplate } from './templates';

// Personal handwriting templates. DOM-free and storage-free: persistence (IndexedDB)
// lives in store/ and hands records here as `unknown` for validation.
// A saved sample keeps the ORIGINAL strokes, never only a derived cloud, so a
// later change to the sampling policy re-derives templates without re-training.
// Samples are immutable once saved; correct one by deleting it and drawing again.

export const userTemplateLabels = ['noteheadFilled', 'noteheadHollow', 'stem'] as const satisfies readonly SimplePrimitive[];

export interface UserTemplateSample {
  readonly id: string;
  readonly label: SimplePrimitive;
  /** Caller-supplied epoch milliseconds; this module never reads the clock. */
  readonly createdAt: number;
  /** Original validated strokes in staff spaces, in capture order. */
  readonly strokes: readonly Stroke[];
}

/** The template set used for matching: built-in bank plus personal samples. */
export interface TemplateBank {
  /** Changes whenever the set of templates changes (see mergeTemplateBank). */
  readonly id: string;
  readonly builtinId: RuntimeBank['id'];
  readonly userSampleIds: readonly string[];
  readonly templates: readonly PointCloudTemplate<SimplePrimitive>[];
}

export interface StoredUserTemplate {
  readonly format: 'sheetmusicomposer-user-template';
  readonly version: 1;
  readonly id: string;
  readonly label: SimplePrimitive;
  readonly createdAt: number;
  readonly strokes: readonly Stroke[];
}

export function encodeUserTemplateSample(sample: UserTemplateSample): StoredUserTemplate {
  return { format: 'sheetmusicomposer-user-template', version: 1, id: sample.id, label: sample.label,
    createdAt: sample.createdAt, strokes: sample.strokes };
}

const isLabel = (value: unknown): value is SimplePrimitive => userTemplateLabels.some((label) => label === value);

/** Validates one stored record. Throws a descriptive Error for anything this
 * version cannot use, rather than guessing or repairing ink.
 */
export function decodeUserTemplateSample(value: unknown): UserTemplateSample {
  const record = object(value);
  if (record.format !== 'sheetmusicomposer-user-template') throw new Error('Not a personal template');
  if (record.version !== 1) throw new Error('Unsupported personal template version');
  if (typeof record.id !== 'string' || record.id.trim() === '' || record.id.length > config.maxFixtureTextLength) throw new Error('Invalid template ID');
  if (!isLabel(record.label)) throw new Error('Unsupported template label');
  if (typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) throw new Error('Invalid template creation time');
  // Reuse the sketch decoder so template ink gets exactly the ink validation.
  const { strokes } = decodeSketch({ format: 'sheetmusicomposer', version: 1, document: { strokes: record.strokes } });
  if (strokes.length === 0 || strokes.length > config.groupMaxStrokesPerGroup) throw new Error('Template needs 1 to ' + config.groupMaxStrokesPerGroup + ' strokes');
  if (strokes.some((stroke) => stroke.completion !== 'complete')) throw new Error('Template strokes must be complete, not interrupted');
  if (strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) > config.maxUserTemplatePoints) throw new Error('Template has too many ink points');
  return { id: record.id, label: record.label, createdAt: record.createdAt, strokes };
}

/** Checks that adding `sample` keeps the saved set valid. Used before writing. */
export function checkCanAdd(existing: readonly UserTemplateSample[], sample: UserTemplateSample): void {
  decodeUserTemplateSample(encodeUserTemplateSample(sample));
  if (existing.some(({ id }) => id === sample.id)) throw new Error('A template with this ID already exists');
  if (existing.filter(({ label }) => label === sample.label).length >= config.maxUserTemplatesPerLabel) {
    throw new Error(`Limit reached: at most ${config.maxUserTemplatesPerLabel} samples per shape. Delete one first.`);
  }
}

export interface SkippedTemplateRecord { readonly key: string; readonly reason: string }

/** Decodes every stored record, keeping the usable ones. A damaged, unsupported,
 * duplicate, or over-limit record is skipped and reported, never thrown, so one
 * bad record cannot disable recognition. Over-limit keeps the oldest samples.
 * Output order is deterministic: creation time, then ID.
 */
export function decodeUserTemplateRecords(records: readonly (readonly [key: string, value: unknown])[]): {
  readonly samples: readonly UserTemplateSample[]; readonly skipped: readonly SkippedTemplateRecord[];
} {
  const skipped: SkippedTemplateRecord[] = [];
  const decoded: { key: string; sample: UserTemplateSample }[] = [];
  for (const [key, value] of records) {
    try { decoded.push({ key, sample: decodeUserTemplateSample(value) }); }
    catch (error) { skipped.push({ key, reason: error instanceof Error ? error.message : String(error) }); }
  }
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  decoded.sort((a, b) => a.sample.createdAt - b.sample.createdAt || compare(a.sample.id, b.sample.id) || compare(a.key, b.key));
  const ids = new Set<string>(), perLabel = new Map<SimplePrimitive, number>(), samples: UserTemplateSample[] = [];
  for (const { key, sample } of decoded) {
    const count = perLabel.get(sample.label) ?? 0;
    if (ids.has(sample.id)) { skipped.push({ key, reason: 'Duplicate template ID' }); continue; }
    if (count >= config.maxUserTemplatesPerLabel) { skipped.push({ key, reason: 'Over the per-shape template limit' }); continue; }
    ids.add(sample.id); perLabel.set(sample.label, count + 1); samples.push(sample);
  }
  return { samples, skipped };
}

/** Stable, non-cryptographic 32-bit FNV-1a. Identity only; not a security check. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

/** Personal samples become templates whose IDs are namespaced `user/<id>` so they
 * can never collide with built-in IDs. Throws if a sample cannot form a cloud.
 */
export function userTemplates(samples: readonly UserTemplateSample[]): PointCloudTemplate<SimplePrimitive>[] {
  return samples.map(({ id, label, strokes }) => prepareTemplate(strokes, {
    id: `user/${id}`, label, source: { kind: 'user', sampleId: id },
  }));
}

/** Built-in bank plus personal samples, with an identity for invalidation.
 * Samples are immutable, so ID, label, and creation time determine content; the
 * identity changes on any add, delete, or reset, and equals the built-in ID
 * alone when there are no personal samples. Ranking (templates.ts) pools all
 * templates by distance; a user template only wins an exact tie.
 */
export function mergeTemplateBank(builtin: RuntimeBank, samples: readonly UserTemplateSample[]): TemplateBank {
  const ids = new Set<string>();
  for (const { id } of samples) {
    if (ids.has(id)) throw new Error('Duplicate personal template ID');
    ids.add(id);
  }
  const ordered = [...samples].sort(compareSamples);
  return { id: templateBankIdentity(builtin.id, ordered), builtinId: builtin.id, userSampleIds: ordered.map(({ id }) => id),
    templates: [...builtin.templates, ...userTemplates(ordered)] };
}

const compareSamples = (a: Pick<UserTemplateSample, 'id' | 'createdAt'>, b: Pick<UserTemplateSample, 'id' | 'createdAt'>): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The bank identity for a set of samples, without building any clouds, so the
 * main thread can cheaply check that a finished review still matches storage.
 * Equals the built-in ID alone when there are no samples.
 */
export function templateBankIdentity(builtinId: string, samples: readonly Pick<UserTemplateSample, 'id' | 'label' | 'createdAt'>[]): string {
  if (samples.length === 0) return builtinId;
  const ordered = [...samples].sort(compareSamples);
  return `${builtinId}+user-${ordered.length}-${fnv1a(ordered.map(({ id, label, createdAt }) => `${id}|${label}|${createdAt}`).join('\n'))}`;
}
