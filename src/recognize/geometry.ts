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
