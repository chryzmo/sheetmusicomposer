import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FixtureRole = 'regression' | 'development' | 'evaluation';
export const fixtureRoot = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/** Explicit repository assignments, never inferred from an imported set/name.
 * A new file needs a conscious role decision before CI can score it. Evaluation
 * files may be schema-validated/inventoried, but are excluded from automatic
 * classification and template selection until a later, frozen evaluation step.
 */
const roles: Readonly<Record<string, FixtureRole>> = {
  'recorded/quarter-e4.json': 'regression',
  'recorded/sample-fail.json': 'regression',
  'synthetic/quarter-c4.json': 'regression',
  'synthetic/half-e4.json': 'regression',
  'synthetic/unknown-mark.json': 'regression',
  'synthetic/classifier-boundaries.json': 'regression',
  'synthetic/classifier-linearity.json': 'regression',
  'synthetic/simple-note-assembly.json': 'regression',
  'synthetic/primitive-grouping.json': 'regression',
  'synthetic/runtime-review.json': 'regression',
  'recorded/development/pencil-dev-1.json': 'development',
  'recorded/evaluation/pencil-eval-1.json': 'evaluation',
};

export function fixtureRole(path: string): FixtureRole {
  const key = relative(fixtureRoot, resolve(path)).split(sep).join('/');
  if (!Object.hasOwn(roles, key)) throw new Error(`Unassigned fixture role: ${key}`);
  return roles[key]!;
}
