import { relative, resolve, sep } from 'node:path';
import type { LoadedFixture } from './load';
import { fixtureManifest, fixtureRole, fixtureRoot, fixtureSession } from './roles';

/** Recording-session assignment for recorded REGRESSION fixtures, from the fixture
 * manifest (`tests/fixtures/manifest.json`), never inferred from a name, set, or
 * file time. `npm run fixtures:import -- --session <id> <files>` records it.
 *
 * A session is one sitting of the same writer: ink drawn in one go, then
 * recorded. Leave-one-session-out only means something if every fixture that
 * shares a sitting shares a session ID; two measures drawn minutes apart are
 * NOT independent of each other. When unsure, merge into the earlier session:
 * a too-coarse session only makes the evaluation stricter.
 *
 * Development and evaluation fixtures have no session: the development recording
 * is already the built-in bank, and the evaluation recording is reserved.
 */
export interface SessionFixture extends LoadedFixture { readonly session: string }

/** Recorded regression fixtures with their session; throws on an unassigned one. */
export function personalSessionFixtures(fixtures: readonly LoadedFixture[]): SessionFixture[] {
  return fixtures.filter(({ path, fixture }) => fixture.provenance === 'recorded' && fixtureRole(path) === 'regression').map((loaded) => {
    const session = fixtureSession(loaded.path);
    if (session === undefined) {
      throw new Error(`Unassigned recording session: ${relative(fixtureRoot, resolve(loaded.path)).split(sep).join('/')}. Import it with --session <id>, or add a session to tests/fixtures/manifest.json`);
    }
    return { ...loaded, session };
  });
}

/** Every path with a session, so a test can catch a stale entry for a removed file. */
export const assignedSessionPaths = (): string[] => Object.entries(fixtureManifest().fixtures).filter(([, entry]) => entry.session !== undefined).map(([path]) => path);
