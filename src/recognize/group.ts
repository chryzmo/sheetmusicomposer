import { config } from '../config';
import type { Stroke } from '../ink/types';

export interface GroupLocation {
  /** IDs supplied by staff geometry, never by recognized primitive labels. */
  readonly measureId: string;
  /** null when no beat-region mapping is available. */
  readonly beatId: string | null;
}
export interface ActiveStrokeObservation {
  /** Monotonic observation/arrival clock in ms, NOT InkPoint.t. Capture this
   * separately in a future coordinator; saved v1 ink cannot reconstruct it.
   */
  readonly startedAt: number;
  readonly location: GroupLocation;
}
export interface ObservedStroke extends ActiveStrokeObservation {
  readonly stroke: Stroke;
  readonly endedAt: number;
}
export interface GroupBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface PendingStrokeGroup {
  readonly strokeIds: readonly string[];
  readonly location: GroupLocation;
  readonly bounds: GroupBounds;
}
export type GroupClosure = 'pause' | 'measure-change' | 'beat-change' | 'spatial-separation' |
  'interrupted' | 'isolated' | 'group-limit' | 'finish-measure';
export interface ClosedStrokeGroup extends PendingStrokeGroup { readonly closedBy: GroupClosure }
export interface StrokeGrouping {
  readonly closed: readonly ClosedStrokeGroup[];
  readonly pending: PendingStrokeGroup | null;
  /** Seen measures other than the current location, plus current if explicitly
   * finished. Returning to a measure removes it from this ready set.
   */
  readonly readyMeasureIds: readonly string[];
}
interface Point { readonly x: number; readonly y: number }
interface Shape { readonly bounds: GroupBounds; readonly ends: readonly Point[]; readonly fragment: boolean }
interface WorkGroup extends PendingStrokeGroup { readonly ends: readonly Point[]; readonly endedAt: number; readonly fragment: boolean }
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function checkClock(at: number): void {
  if (!Number.isFinite(at) || at < 0) throw new RangeError('Grouping needs a finite nonnegative observation clock');
}
function checkLocation(location: GroupLocation): void {
  if (!location.measureId.trim() || (location.beatId !== null && !location.beatId.trim())) throw new Error('Invalid grouping location');
}
function shape(stroke: Stroke): Shape {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const { x, y } of stroke.points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Grouping requires finite staff-space points');
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) throw new RangeError('Grouping bounds overflow');
  const first = stroke.points[0]!, last = stroke.points[stroke.points.length - 1]!;
  // Unlike observation clocks, raw SAMPLE ORDER remains meaningful. Never sort
  // points by t. First/last path samples describe fragment connectivity here,
  // not the geometric stem extrema used later by assembly.
  const ends = distance(first, last) <= config.groupLoopMaxGap ? [] : [{ x: first.x, y: first.y }, { x: last.x, y: last.y }];
  return { bounds, ends, fragment: bounds.width >= config.groupFragmentMinWidth && bounds.height >= config.groupFragmentMinHeight &&
    Math.max(bounds.width, bounds.height) >= config.groupFragmentMinExtent && compact(bounds) };
}
function compact(b: GroupBounds): boolean {
  return b.width <= config.primitiveHeadMaxWidth && b.height <= config.primitiveHeadMaxHeight;
}
function union(a: GroupBounds, b: GroupBounds): GroupBounds {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
function contains(outer: GroupBounds, inner: GroupBounds): boolean {
  const p = config.groupContainmentPadding;
  return inner.x >= outer.x - p && inner.y >= outer.y - p &&
    inner.x + inner.width <= outer.x + outer.width + p && inner.y + inner.height <= outer.y + outer.height + p;
}
function joinedEnds(group: WorkGroup, next: Shape): readonly Point[] | null {
  if (!group.fragment || !next.fragment || !compact(union(group.bounds, next.bounds))) return null;
  // A closed compact outline can accept substantial inset fill/retracing, in
  // either drawing order. Nearby dots/lines fail fragment eligibility first.
  if ((group.ends.length === 0 && contains(group.bounds, next.bounds)) ||
      (next.ends.length === 0 && contains(next.bounds, group.bounds))) return [];
  if (group.ends.length !== 2 || next.ends.length !== 2) return null;
  const links = group.ends.flatMap((a, i) => next.ends.flatMap((b, j) => distance(a, b) <= config.groupEndpointMaxGap ? [{ i, j }] : []));
  // Reject competing endpoint pairings rather than choosing the nearest. One
  // unique link extends an open path; two disjoint links close its outline.
  if (links.length === 0 || new Set(links.map((l) => l.i)).size !== links.length ||
      new Set(links.map((l) => l.j)).size !== links.length) return null;
  return links.length === 2 ? [] : [group.ends[1 - links[0]!.i]!, next.ends[1 - links[0]!.j]!];
}
function extendGroup(group: WorkGroup, next: Shape, observation: ObservedStroke, ends: readonly Point[]): WorkGroup {
  return { ...group, strokeIds: [...group.strokeIds, observation.stroke.id], bounds: union(group.bounds, next.bounds), ends, endedAt: observation.endedAt };
}
function publicGroup(group: WorkGroup): PendingStrokeGroup {
  return { strokeIds: [...group.strokeIds], location: { ...group.location }, bounds: { ...group.bounds } };
}

/** Pure bounded snapshot grouping, NOT a timer, classifier, or UI coordinator.
 * Process observations in capture order; do not synthesize clocks from saved
 * point timestamps. Recompute a bounded working window after pen-up/clock or
 * region changes, off the ink-drawing frame. Only closed groups may be scored;
 * only ready measures may be assembled as finished measures. Preserve all ink.
 * Geometry/timing rules are guesses tested on synthetic scenarios, not tuned
 * against the recorded evaluation or claimed as handwriting grouping accuracy.
 */
export function groupStrokes(observations: readonly ObservedStroke[], options: {
  readonly now: number;
  readonly location?: GroupLocation;
  /** Hold the idle timeout while a stroke that started before its deadline is
   * still being observed. No partial raw ink is passed to classification.
   */
  readonly active?: ActiveStrokeObservation;
  readonly finishMeasure?: boolean;
}): StrokeGrouping {
  checkClock(options.now);
  if (options.location) checkLocation(options.location);
  if (observations.length > config.groupMaxInputStrokes) throw new RangeError('Grouping window exceeds work limit');
  const ids = new Set<string>(), seenMeasures = new Set<string>();
  let previousEnd = 0, pointCount = 0;
  const shapes = observations.map((o) => {
    checkClock(o.startedAt); checkClock(o.endedAt); checkLocation(o.location);
    if (o.startedAt < previousEnd || o.endedAt < o.startedAt || o.endedAt > options.now) throw new RangeError('Invalid observation-clock ordering');
    previousEnd = o.endedAt;
    if (!o.stroke.id.trim() || ids.has(o.stroke.id) || o.stroke.points.length === 0 ||
        (o.stroke.completion !== 'complete' && o.stroke.completion !== 'interrupted')) throw new Error('Invalid grouping stroke');
    ids.add(o.stroke.id); seenMeasures.add(o.location.measureId);
    pointCount += o.stroke.points.length;
    if (pointCount > config.maxStoredPoints) throw new RangeError('Grouping point limit exceeded');
    return shape(o.stroke);
  });
  if (options.active) {
    checkClock(options.active.startedAt); checkLocation(options.active.location);
    if (options.active.startedAt < previousEnd || options.active.startedAt > options.now) throw new RangeError('Invalid active observation clock');
    if (options.finishMeasure) throw new Error('Cannot finish a measure during active ink');
    if (options.location && (options.location.measureId !== options.active.location.measureId ||
      options.location.beatId !== options.active.location.beatId)) throw new Error('Conflicting current grouping locations');
  }
  const closed: ClosedStrokeGroup[] = [];
  let pending: WorkGroup | null = null;
  const close = (reason: GroupClosure): void => {
    if (pending) { closed.push({ ...publicGroup(pending), closedBy: reason }); pending = null; }
  };
  for (const [i, o] of observations.entries()) {
    const next = shapes[i]!;
    if (pending) {
      if (pending.location.measureId !== o.location.measureId) close('measure-change');
      else if (pending.location.beatId !== o.location.beatId) close('beat-change');
      else if (o.startedAt - pending.endedAt >= config.groupPauseMs) close('pause');
    }
    if (o.stroke.completion === 'interrupted') {
      close('interrupted');
      closed.push({ strokeIds: [o.stroke.id], location: { ...o.location }, bounds: { ...next.bounds }, closedBy: 'interrupted' });
      continue;
    }
    if (pending) {
      const ends = joinedEnds(pending, next);
      if (pending.strokeIds.length >= config.groupMaxStrokesPerGroup) close('group-limit');
      else if (ends === null) close('spatial-separation');
      else { pending = extendGroup(pending, next, o, ends); continue; }
    }
    pending = { strokeIds: [o.stroke.id], location: { ...o.location }, bounds: { ...next.bounds },
      ends: next.ends, fragment: next.fragment, endedAt: o.endedAt };
    if (!next.fragment) close('isolated');
  }
  const current = options.active?.location ?? options.location ?? observations[observations.length - 1]?.location;
  if (pending && current) {
    if (pending.location.measureId !== current.measureId) close('measure-change');
    else if (pending.location.beatId !== current.beatId) close('beat-change');
  }
  if (options.finishMeasure) close('finish-measure');
  else if (pending && (options.active?.startedAt ?? options.now) - pending.endedAt >= config.groupPauseMs) close('pause');
  return { closed, pending: pending ? publicGroup(pending) : null,
    readyMeasureIds: [...seenMeasures].filter((id) => options.finishMeasure || id !== current?.measureId) };
}
