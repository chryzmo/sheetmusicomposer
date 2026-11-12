import { config } from '../config';
import seeds from './runtime-seeds.json';
import type { SimplePrimitive } from './primitives';
import type { PointCloudTemplate } from './templates';

export interface RuntimeBank {
  readonly id: 'pencil-dev-v1';
  readonly description: string;
  readonly source: { readonly path: string; readonly sha256: string; readonly fixtureName: string;
    readonly role: 'development'; readonly provenance: 'recorded' };
  readonly templates: readonly PointCloudTemplate<SimplePrimitive>[];
}
/** Identity of the built-in bank; personal-template bank IDs extend it. */
export const runtimeBankId = 'pencil-dev-v1' as const;
const labels = ['noteheadFilled', 'noteheadHollow', 'stem'] as const;
const sourcePath = 'fixtures/recorded/development/pencil-dev-1.json';
const sourceHash = '15ec56101a055df9280e8e03bb50b4414b50c09316a0ce50629dcd0de60736b9';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime bank object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > config.maxFixtureTextLength) throw new Error('Invalid runtime bank text');
  return value;
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid runtime cloud number');
  return value;
}

/** Decoder for THIS curated artifact, not a general template import/training API.
 * No fallback to synthetic seeds, hidden merges, user-template priority, network,
 * raw fixture imports, or evaluation input. Return independent validated copies.
 */
export function decodeRuntimeBank(value: unknown): RuntimeBank {
  const bank = object(value), source = object(bank.source);
  if (bank.format !== 'sheetmusicomposer-runtime-templates' || bank.version !== 1 || bank.id !== 'pencil-dev-v1' ||
      bank.sampleCount !== 32 || config.pointCloudSampleCount !== bank.sampleCount) throw new Error('Incompatible runtime bank version/sampling');
  if (source.path !== sourcePath || source.sha256 !== sourceHash || source.fixtureName !== 'Pencil-dev-1' ||
      source.role !== 'development' || source.provenance !== 'recorded') throw new Error('Unapproved runtime bank source');
  if (!Array.isArray(bank.templates) || bank.templates.length !== 15) throw new Error('Runtime bank needs all fifteen development templates');
  const ids = new Set<string>(), strokeIds = new Set<string>();
  const templates = Array.from(bank.templates, (raw: unknown): PointCloudTemplate<SimplePrimitive> => {
    const t = object(raw), provenance = object(t.source), cloud = object(t.cloud), bounds = object(cloud.bounds);
    const id = text(t.id);
    if (ids.has(id)) throw new Error('Duplicate runtime template ID');
    ids.add(id);
    const index = Number(id.slice('development/Pencil-dev-1/primitive-'.length));
    if (!Number.isInteger(index) || index < 1 || index > 15 || id !== `development/Pencil-dev-1/primitive-${index}` ||
        provenance.kind !== 'builtin' || provenance.sampleId !== id) throw new Error('Invalid runtime template provenance');
    if (t.label !== 'noteheadFilled' && t.label !== 'noteheadHollow' && t.label !== 'stem') throw new Error('Unsupported runtime label');
    if (!Array.isArray(cloud.strokeIds) || cloud.strokeIds.length !== 1) throw new Error('Invalid runtime source references');
    const strokeId = text(cloud.strokeIds[0]);
    if (strokeIds.has(strokeId)) throw new Error('Repeated runtime source stroke');
    strokeIds.add(strokeId);
    if (!Array.isArray(cloud.points) || cloud.points.length !== bank.sampleCount) throw new Error('Invalid runtime cloud count');
    const points = Array.from(cloud.points, (raw: unknown) => {
      const p = object(raw), x = finite(p.x), y = finite(p.y);
      if (Math.abs(x) > 1 || Math.abs(y) > 1) throw new Error('Runtime cloud is not normalized');
      return { x, y };
    });
    const b = { x: finite(bounds.x), y: finite(bounds.y), width: finite(bounds.width), height: finite(bounds.height) };
    if (b.width < 0 || b.height < 0 || !Number.isFinite(b.x + b.width) || !Number.isFinite(b.y + b.height)) throw new Error('Invalid runtime bounds');
    return { id, label: t.label, source: { kind: 'builtin', sampleId: id }, cloud: { points, bounds: b, strokeIds: [strokeId] } };
  });
  if (labels.some((label) => templates.filter((t) => t.label === label).length !== 5)) throw new Error('Runtime bank needs five templates per supported label');
  return { id: 'pencil-dev-v1', description: text(bank.description), source: { path: sourcePath, sha256: sourceHash,
    fixtureName: 'Pencil-dev-1', role: 'development', provenance: 'recorded' }, templates };
}

/** Runtime-ready default for the forthcoming OPT-IN review path. The existing
 * synthetic seed API remains separate for reference/development tests. This
 * single-writer bank is experimental and is not device-trained personal data.
 */
export function createRuntimeBank(): RuntimeBank { return decodeRuntimeBank(seeds); }
