import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeManifest } from './manifest';
import type { FixtureRole, Manifest } from './manifest';

export type { FixtureRole } from './manifest';
export const fixtureRoot = fileURLToPath(new URL('../../fixtures/', import.meta.url));
export const manifestPath = fileURLToPath(new URL('./manifest.json', import.meta.url));

/** Roles and sessions come from `tests/fixtures/manifest.json`, never inferred
 * from an imported set/name. A new file needs a conscious entry before CI can
 * score it (`npm run fixtures:import` makes it). Evaluation files may be
 * schema-validated/inventoried, but are excluded from automatic classification
 * and template selection until a later, frozen evaluation step.
 */
let cached: Manifest | null = null;
export function fixtureManifest(): Manifest {
  cached ??= decodeManifest(readFileSync(manifestPath, 'utf8'));
  return cached;
}

function keyOf(path: string): string {
  return relative(fixtureRoot, resolve(path)).split(sep).join('/');
}

export function fixtureRole(path: string): FixtureRole {
  const key = keyOf(path);
  const entry = Object.hasOwn(fixtureManifest().fixtures, key) ? fixtureManifest().fixtures[key] : undefined;
  if (!entry) throw new Error(`Unassigned fixture role: ${key}`);
  return entry.role;
}

/** The recording session of a fixture, or undefined (synthetic and role-reserved files have none). */
export function fixtureSession(path: string): string | undefined {
  const key = keyOf(path);
  return Object.hasOwn(fixtureManifest().fixtures, key) ? fixtureManifest().fixtures[key]!.session : undefined;
}
