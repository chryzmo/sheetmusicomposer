import type { InkFixture, ExpectedPrimitive } from '../../src/fixtures/schema';
import type { Stroke } from '../../src/ink/types';
import { classifyPrimitive } from '../../src/recognize/classify';
import { prepareTemplate } from '../../src/recognize/templates';
import type { PointCloudTemplate } from '../../src/recognize/templates';
import type { SimplePrimitive } from '../../src/recognize/primitives';
import type { PrimitiveObservation } from './classification';
import type { LoadedFixture } from './load';
import { fixtureRole } from './roles';

const sampleId = (fixture: InkFixture, index: number): string => `development/${fixture.name}/primitive-${index + 1}`;
function groupStrokes(fixture: InkFixture, primitive: ExpectedPrimitive): readonly Stroke[] {
  return primitive.strokeIds.map((id) => {
    const stroke = fixture.document.strokes.find((stroke) => stroke.id === id);
    if (!stroke) throw new Error(`Missing annotated stroke ${id} in ${fixture.name}`);
    return stroke;
  });
}
function requireDevelopment(fixtures: readonly LoadedFixture[]): void {
  const names = new Set<string>(), ids = new Set<string>();
  for (const { path, fixture } of fixtures) {
    const role = fixtureRole(path);
    if (role !== 'development') throw new Error(`Template development cannot use ${role} fixture: ${path}`);
    if (names.has(fixture.name)) throw new Error(`Repeated development fixture: ${fixture.name}`);
    names.add(fixture.name);
    for (const { id } of fixture.document.strokes) {
      if (ids.has(id)) throw new Error(`Repeated development stroke: ${id}`);
      ids.add(id);
    }
  }
}

/** Test/development adapter only, not a shipped template bank or persistence API.
 * The role guard prevents accidental regression/evaluation input. Only known
 * milestone-2 labels become templates; unknown/unsupported annotations remain
 * test queries, never examples of an accepted class. Raw input is not rewritten.
 */
export function createDevelopmentTemplates(fixtures: readonly LoadedFixture[]): PointCloudTemplate<SimplePrimitive>[] {
  requireDevelopment(fixtures);
  return fixtures.flatMap(({ fixture }) => fixture.expected.primitives.flatMap((primitive, index) => {
    const label = primitive.label;
    if (label !== 'noteheadFilled' && label !== 'noteheadHollow' && label !== 'stem') return [];
    const id = sampleId(fixture, index);
    return [prepareTemplate(groupStrokes(fixture, primitive), { id, label, source: { kind: 'user', sampleId: id } })];
  }));
}

/** Leave one ANNOTATED GROUP out of template construction for each query.
 * Useful development diagnostic, NOT session-held-out accuracy. The remainder
 * of the same recording is available, so never claim independent validation.
 * No synthetic seeds or evaluated-query self-templates are silently added.
 */
export function evaluateDevelopmentLeaveOneOut(fixtures: readonly LoadedFixture[]): PrimitiveObservation[] {
  const bank = createDevelopmentTemplates(fixtures);
  return fixtures.flatMap(({ fixture }) => fixture.expected.primitives.map((primitive, index) => ({
    fixtureName: fixture.name, set: fixture.set, provenance: fixture.provenance, expected: primitive.label,
    result: classifyPrimitive(groupStrokes(fixture, primitive), bank.filter(({ id }) => id !== sampleId(fixture, index))),
  })));
}
