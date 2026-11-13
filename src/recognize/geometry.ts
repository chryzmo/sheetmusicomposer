import { config } from '../config';
import type { CloudPoint } from './templates';

/** Minor/major covariance eigenvalue ratio for a derived normalized cloud.
 * 0 is collinear, 1 is isotropic (or degenerate). This is a geometric descriptor,
 * NOT a confidence/probability. No rotation of ink or templates takes place.
 * Arc-length resampling upstream keeps capture cadence from weighting the fit;
 * backtracking still contributes samples but does not make a line into a bend.
 */
export function cloudLinearityRatio(points: readonly CloudPoint[]): number {
  if (points.length < 2 || points.length > config.maxPointCloudSampleCount ||
      points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1)) {
    throw new RangeError('Expected a bounded normalized point cloud');
  }
  let x = 0, y = 0;
  for (const point of points) { x += point.x; y += point.y; }
  x /= points.length; y /= points.length;
  let xx = 0, xy = 0, yy = 0;
  for (const point of points) {
    const dx = point.x - x, dy = point.y - y;
    xx += dx * dx; xy += dx * dy; yy += dy * dy;
  }
  const trace = xx + yy;
  if (trace === 0) return 1;
  const spread = Math.hypot(xx - yy, 2 * xy);
  // Roundoff can make a collinear cloud's minor eigenvalue slightly negative.
  return Math.max(0, trace - spread) / (trace + spread);
}

/** Ink density: the length of a SINGLE stroke's resampled path, where the cloud is
 * normalized so its largest side is 1. A single open loop is about 3; a head that is
 * scribbled in is several times that. Measured on the classifier's own resampled
 * cloud (not raw samples) so it does not depend on the device's sampling rate or
 * jitter. Meaningless across several strokes (pen-up jumps add length), so callers
 * use it for one stroke only. NOT a confidence or a shape match.
 */
export function cloudInkDensity(points: readonly CloudPoint[]): number {
  if (points.length < 2 || points.length > config.maxPointCloudSampleCount ||
      points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new RangeError('Expected a bounded point cloud');
  }
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return length;
}
