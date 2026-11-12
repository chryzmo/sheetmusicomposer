import { relative, resolve, sep } from 'node:path';
import type { LoadedFixture } from './load';
import { fixtureRole, fixtureRoot } from './roles';

/** Recording-session assignment for recorded REGRESSION fixtures, never inferred
 * from a name, set, or file time. A new recorded fixture needs a conscious
 * decision here before the personal-template evaluation will run, as with roles.
 *
 * A session is one sitting of the same writer: ink drawn in one go, then
 * recorded. Leave-one-session-out only means something if every fixture that
 * shares a sitting shares a session ID; two measures drawn minutes apart are
 * NOT independent of each other. When unsure, merge into the earlier session:
 * a too-coarse session only makes the evaluation stricter.
 *
 * Development and evaluation fixtures are deliberately absent: the development
 * recording is already the built-in bank, and the evaluation recording is reserved.
 */
const sessions: Readonly<Record<string, string>> = {
  'recorded/quarter-e4.json': 'session-quarter-e4',
  'recorded/sample-fail.json': 'session-sample-fail',
  // Recorded back to back in one sitting.
  'recorded/a4-whole-x4.json': 'session-three-tests',
  'recorded/c5-quarters-half-whole.json': 'session-three-tests',
  'recorded/e4-seven-notes.json': 'session-three-tests',
};

export interface SessionFixture extends LoadedFixture { readonly session: string }

/** Recorded regression fixtures with their session; throws on an unassigned one. */
export function personalSessionFixtures(fixtures: readonly LoadedFixture[]): SessionFixture[] {
  return fixtures.filter(({ path, fixture }) => fixture.provenance === 'recorded' && fixtureRole(path) === 'regression').map((loaded) => {
    const key = relative(fixtureRoot, resolve(loaded.path)).split(sep).join('/');
    if (!Object.hasOwn(sessions, key)) throw new Error(`Unassigned recording session: ${key}. Add it to tests/fixtures/personal-sessions.ts`);
    return { ...loaded, session: sessions[key]! };
  });
}

/** Every assigned path, so a test can catch a stale entry for a removed file. */
export const assignedSessionPaths: readonly string[] = Object.keys(sessions);
