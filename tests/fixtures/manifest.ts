/** The fixture manifest: one explicit, reviewable decision per fixture file.
 * It replaces the hand-edited role and session tables. Nothing is inferred from a
 * file's name, set, or time. Roles keep template data, the reserved evaluation
 * recording, and regression data apart; a session says which sitting a recorded
 * regression fixture belongs to, so held-out evaluation never trains on the ink it tests.
 * Pure and DOM-free; the import command and the tests share it.
 */
export type FixtureRole = 'regression' | 'development' | 'evaluation';
export const fixtureRoles: readonly FixtureRole[] = ['regression', 'development', 'evaluation'];

export interface ManifestEntry { readonly role: FixtureRole; readonly session?: string }
export interface Manifest { readonly fixtures: Readonly<Record<string, ManifestEntry>> }

const sessionPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const isSessionId = (value: unknown): value is string => typeof value === 'string' && sessionPattern.test(value);
/** A path relative to the fixtures directory, with forward slashes. */
const isFixturePath = (value: string): boolean => value.endsWith('.json') && !value.startsWith('/') && !value.split('/').some((part) => part === '' || part === '.' || part === '..');

export function decodeManifest(text: string): Manifest {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new Error('Fixture manifest is not valid JSON', { cause: error }); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Fixture manifest must be an object');
  const file = value as Record<string, unknown>;
  if (file.format !== 'sheetmusicomposer-fixture-manifest' || file.version !== 1) throw new Error('Unsupported fixture manifest format or version');
  const raw = file.fixtures;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Fixture manifest needs a fixtures object');
  const fixtures: Record<string, ManifestEntry> = {};
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isFixturePath(path)) throw new Error(`Invalid fixture path in manifest: ${path}`);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid manifest entry for ${path}`);
    const { role, session, ...extra } = entry as Record<string, unknown>;
    if (Object.keys(extra).length > 0) throw new Error(`Unknown manifest field for ${path}: ${Object.keys(extra).join(', ')}`);
    if (!fixtureRoles.some((r) => r === role)) throw new Error(`Invalid role for ${path}`);
    if (session !== undefined && !isSessionId(session)) throw new Error(`Invalid session for ${path}`);
    if (session !== undefined && role !== 'regression') throw new Error(`Only regression fixtures have sessions: ${path}`);
    fixtures[path] = { role: role as FixtureRole, ...(session === undefined ? {} : { session }) };
  }
  return { fixtures };
}

/** Stable output (sorted paths, fixed key order) so the file diffs cleanly in review. */
export function serializeManifest(manifest: Manifest): string {
  const fixtures: Record<string, ManifestEntry> = {};
  for (const path of Object.keys(manifest.fixtures).sort()) {
    const { role, session } = manifest.fixtures[path]!;
    fixtures[path] = { role, ...(session === undefined ? {} : { session }) };
  }
  return JSON.stringify({ format: 'sheetmusicomposer-fixture-manifest', version: 1, fixtures }, null, 2) + '\n';
}

export function withEntry(manifest: Manifest, path: string, entry: ManifestEntry): Manifest {
  if (!isFixturePath(path)) throw new Error(`Invalid fixture path: ${path}`);
  if (Object.hasOwn(manifest.fixtures, path)) throw new Error(`Fixture already in the manifest: ${path}`);
  return decodeManifest(serializeManifest({ fixtures: { ...manifest.fixtures, [path]: entry } }));
}

/** Sessions in use, with how many fixtures each holds. */
export function sessionCounts(manifest: Manifest): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { session } of Object.values(manifest.fixtures)) if (session !== undefined) counts.set(session, (counts.get(session) ?? 0) + 1);
  return counts;
}
