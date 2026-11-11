import type { PrimitiveLabel } from '../../src/recognize/primitives';
import { classifyPrimitive } from '../../src/recognize/classify';
import type { PrimitiveClassification } from '../../src/recognize/classify';
import type { SimplePrimitive } from '../../src/recognize/primitives';
import type { PointCloudTemplate } from '../../src/recognize/templates';
import type { LoadedFixture } from './load';

export interface PrimitiveObservation {
  readonly fixtureName: string;
  readonly set: string;
  readonly provenance: 'recorded' | 'synthetic';
  readonly expected: PrimitiveLabel;
  readonly result: PrimitiveClassification;
}

/** Development evaluation with ORACLE grouping from manual annotations. No
 * event comparison, grouping evaluation, template selection, or threshold tuning.
 * Recorded does not mean held-out: the present recording was already inspected
 * during matcher development, and the synthetic fixtures are authored tests.
 */
export function evaluatePrimitives(fixtures: readonly LoadedFixture[], templates: readonly PointCloudTemplate<SimplePrimitive>[]): PrimitiveObservation[] {
  return fixtures.flatMap(({ fixture }) => {
    const strokes = new Map(fixture.document.strokes.map((stroke) => [stroke.id, stroke]));
    return fixture.expected.primitives.map(({ label, strokeIds }) => ({
      fixtureName: fixture.name, set: fixture.set, provenance: fixture.provenance, expected: label,
      result: classifyPrimitive(strokeIds.map((id) => {
        const stroke = strokes.get(id);
        if (!stroke) throw new Error(`Missing annotated stroke ${id} in ${fixture.name}`);
        return stroke;
      }), templates),
    }));
  });
}

/** Count exact agreement, coverage, false accepts and every confusion cell.
 * Rejected known labels are misses, not successful recognitions. Keep each
 * provenance/set separate; never average safety cases into handwriting accuracy.
 */
export function classificationReport(observations: readonly PrimitiveObservation[]): string {
  const sets = new Map<string, PrimitiveObservation[]>();
  for (const observation of observations) {
    const key = `${observation.set} (${observation.provenance})`;
    const rows = sets.get(key) ?? [];
    rows.push(observation); sets.set(key, rows);
  }
  const lines = ['Development primitive classification — manual/oracle groups, synthetic seed bank.',
    'NOT held-out handwriting accuracy or end-to-end recognition; rejects of known labels count as misses.'];
  for (const [set, rows] of Array.from(sets).sort(([a], [b]) => a.localeCompare(b))) {
    const accepted = rows.filter(({ result }) => result.label !== 'unknown');
    const exact = rows.filter(({ expected, result }) => expected === result.label);
    const unknown = rows.filter(({ expected }) => expected === 'unknown');
    const knownRejected = rows.filter(({ expected, result }) => expected !== 'unknown' && result.label === 'unknown');
    const wrongAccepted = accepted.filter(({ expected, result }) => expected !== result.label);
    lines.push(`${set}: exact ${exact.length}/${rows.length}; accepted ${accepted.length}/${rows.length}; wrong accepts ${wrongAccepted.length}; known rejects ${knownRejected.length}; unknown rejected ${unknown.filter(({ result }) => result.label === 'unknown').length}/${unknown.length}`);
    const cells = new Map<string, number>();
    for (const { expected, result } of rows) {
      const key = `${expected} -> ${result.label}${result.rejection ? ` (${result.rejection})` : ''}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    for (const [cell, count] of Array.from(cells).sort(([a], [b]) => a.localeCompare(b))) lines.push(`  ${cell}: ${count}`);
  }
  return lines.join('\n');
}
