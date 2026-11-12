// TypeScript adaptation of the $P algorithm by Radu-Daniel Vatavu,
// Lisa Anthony, and Jacob O. Wobbrock (2012), New BSD License.
// Full notice and pinned source details: public/third-party-notices.txt.
import { config } from '../config';

export interface CloudPoint { readonly x: number; readonly y: number }
export interface CloudStroke { readonly id: string; readonly points: readonly CloudPoint[] }
export interface PreparedCloud {
  readonly points: readonly CloudPoint[];
  readonly strokeIds: readonly string[];
  /** Original staff-space geometry, not normalized template coordinates. */
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}
export interface TemplateSource {
  readonly kind: 'builtin' | 'user' | 'external';
  readonly sampleId: string;
}
export interface PointCloudTemplate<Label extends string = string> {
  readonly id: string;
  readonly label: Label;
  readonly source: TemplateSource;
  readonly cloud: PreparedCloud;
}
export interface TemplateCandidate<Label extends string = string> {
  readonly label: Label;
  /** Lower is better. Weighted $P distance, not a probability or rejection score. */
  readonly distance: number;
  readonly templateId: string;
  readonly source: TemplateSource;
}
interface StrokePoint extends CloudPoint { readonly stroke: number }

function checkCount(count: number): void {
  if (!Number.isInteger(count) || count < 2 || count > config.maxPointCloudSampleCount) throw new RangeError('Invalid point-cloud sample count');
}
// Normalized matching coordinates are bounded, so use reference $P's exact
// arithmetic here (nearest-neighbor ties are sensitive to floating-point order).
const distance = (a: CloudPoint, b: CloudPoint): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const pathDistance = (a: CloudPoint, b: CloudPoint): number => Math.hypot(a.x - b.x, a.y - b.y);
function pathLength(points: readonly StrokePoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.stroke === points[i - 1]!.stroke) length += pathDistance(points[i - 1]!, points[i]!);
  }
  return length;
}

/** Resample the pen-down path only: never interpolate a pen-up connector.
 * Unlike upstream's splice-based implementation, this uses an immutable input
 * and a bounded target loop. For zero total path length, select original points
 * by index (never interpolate between disconnected taps). Isolated zero-length
 * strokes in an otherwise nonzero path may be omitted, as in reference $P;
 * augmentation dots must be grouped separately by the future grouping stage.
 */
function resample(points: readonly StrokePoint[], count: number): CloudPoint[] {
  const length = pathLength(points);
  if (length === 0) return Array.from({ length: count }, (_, i) => {
    const point = points[Math.floor(i * (points.length - 1) / (count - 1))]!;
    return { x: point.x, y: point.y };
  });
  const sampled: CloudPoint[] = [{ x: points[0]!.x, y: points[0]!.y }];
  const interval = length / (count - 1);
  let carried = 0;
  for (let i = 1; i < points.length && sampled.length < count; i++) {
    let a: CloudPoint = points[i - 1]!;
    const b = points[i]!;
    if (points[i - 1]!.stroke !== b.stroke) continue;
    let segment = pathDistance(a, b);
    while (segment > 0 && carried + segment >= interval && sampled.length < count) {
      const fraction = (interval - carried) / segment;
      const q = { x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) };
      sampled.push(q);
      a = q;
      carried = 0;
      segment = pathDistance(a, b);
    }
    carried += segment;
  }
  // A final target can be missed through floating-point accumulation. Upstream
  // likewise appends the endpoint for this case; never spin/inject NaN samples.
  const last = points.at(-1)!;
  while (sampled.length < count) sampled.push({ x: last.x, y: last.y });
  return sampled;
}

function boundsOf(points: readonly CloudPoint[]): PreparedCloud['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError('Ink coordinates must be finite');
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX, height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RangeError('Ink bounds exceed numeric range');
  return { x: minX, y: minY, width, height };
}

/** Translation and uniform-scale normalization only. No rotation/reflection.
 * Resample → scale → centroid translation follows the $P reference. A fallback
 * affine scale handles paths whose total/interval exceeds numeric range.
 * Original strokes, metadata, and bounds are never rewritten.
 */
export function preparePointCloud(strokes: readonly CloudStroke[], count: number = config.pointCloudSampleCount): PreparedCloud {
  checkCount(count);
  if (strokes.length === 0 || strokes.some((stroke) => stroke.points.length === 0)) throw new RangeError('Point cloud needs nonempty strokes');
  const ids = new Set(strokes.map((stroke) => stroke.id));
  if (ids.size !== strokes.length || ids.has('')) throw new RangeError('Stroke IDs must be nonempty and unique');
  const raw = strokes.flatMap((stroke, index) => stroke.points.map((point) => ({ x: point.x, y: point.y, stroke: index })));
  const bounds = boundsOf(raw);
  const length = pathLength(raw);
  const size = Math.max(bounds.width, bounds.height) || 1;
  const points = !Number.isFinite(length) || (length > 0 && length / (count - 1) === 0)
    ? raw.map((point) => ({ x: (point.x - bounds.x) / size, y: (point.y - bounds.y) / size, stroke: point.stroke }))
    : raw;
  const sampled = resample(points, count);
  const sampledBounds = boundsOf(sampled);
  const sampledSize = Math.max(sampledBounds.width, sampledBounds.height) || 1;
  const scaled = sampled.map((point) => ({ x: (point.x - sampledBounds.x) / sampledSize, y: (point.y - sampledBounds.y) / sampledSize }));
  const sum = scaled.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  const center = { x: sum.x / count, y: sum.y / count };
  return { bounds, strokeIds: strokes.map((stroke) => stroke.id), points: scaled.map((point) => ({ x: point.x - center.x, y: point.y - center.y })) };
}

function cloudDistance(a: readonly CloudPoint[], b: readonly CloudPoint[], start: number): number {
  const matched = Array<boolean>(b.length).fill(false);
  let sum = 0;
  for (let offset = 0; offset < a.length; offset++) {
    const point = a[(start + offset) % a.length]!;
    let nearest = -1, best = Infinity;
    for (let j = 0; j < b.length; j++) {
      if (matched[j]) continue;
      const d = distance(point, b[j]!);
      if (d < best) { best = d; nearest = j; }
    }
    matched[nearest] = true;
    sum += (1 - offset / a.length) * best;
  }
  return sum;
}

function checkCloud(cloud: PreparedCloud): void {
  checkCount(cloud.points.length);
  if (cloud.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1 || Math.abs(point.y) > 1)) {
    throw new RangeError('Expected a finite normalized point cloud');
  }
}

/** Published $P greedy bidirectional distance, with no cross-template pruning. */
export function pointCloudDistance(a: PreparedCloud, b: PreparedCloud): number {
  checkCloud(a); checkCloud(b);
  if (a.points.length !== b.points.length) throw new RangeError('Point clouds need equal sample counts');
  const step = Math.max(1, Math.floor(a.points.length ** (1 - config.pointCloudSearchExponent)));
  let best = Infinity;
  for (let start = 0; start < a.points.length; start += step) {
    best = Math.min(best, cloudDistance(a.points, b.points, start), cloudDistance(b.points, a.points, start));
  }
  return best;
}

export function prepareTemplate<Label extends string>(
  strokes: readonly CloudStroke[], metadata: Omit<PointCloudTemplate<Label>, 'cloud'>,
  count: number = config.pointCloudSampleCount,
): PointCloudTemplate<Label> {
  if (!metadata.id.trim() || !metadata.label.trim() || !metadata.source.sampleId.trim()) throw new RangeError('Template metadata must be nonempty');
  return { ...metadata, cloud: preparePointCloud(strokes, count) };
}

/** Best template per label, sorted by distance. The caller still owns geometry,
 * unknown rejection, user-template policy, and musical assembly. Stable lexical
 * ties avoid depending on insertion order or host locale. Never train on a test
 * fixture and report its self-match as held-out accuracy.
 */
export function rankPointCloud<Label extends string>(query: PreparedCloud, templates: readonly PointCloudTemplate<Label>[]): TemplateCandidate<Label>[] {
  checkCloud(query);
  const ids = new Set<string>();
  const candidates = templates.map((template) => {
    if (ids.has(template.id)) throw new RangeError('Template IDs must be unique');
    ids.add(template.id);
    return { label: template.label, templateId: template.id, source: template.source, distance: pointCloudDistance(query, template.cloud) };
  });
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  // On an exactly equal distance a user template outranks a built-in one. This is
  // only a deterministic tie-break, not a distance bonus: a built-in template that
  // is even slightly closer still wins. (Exact float ties are rare; a user bonus
  // would need evidence from held-out data before it is added.)
  const rank = ({ source }: { source: TemplateSource }): number => source.kind === 'user' ? 0 : 1;
  candidates.sort((a, b) => a.distance - b.distance || rank(a) - rank(b) || compare(a.label, b.label) || compare(a.templateId, b.templateId));
  const seen = new Set<Label>();
  return candidates.filter(({ label }) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}
