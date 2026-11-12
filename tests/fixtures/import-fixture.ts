import { parseFixture } from '../../src/fixtures/schema';
import type { InkFixture } from '../../src/fixtures/schema';
import { isSessionId, sessionCounts, withEntry } from './manifest';
import type { Manifest } from './manifest';

/** Planning for `npm run fixtures:import`: validate a downloaded fixture and decide
 * where it goes and what its manifest entry is. Pure: no file access, so every
 * refusal is unit-tested. Imports are always recorded REGRESSION fixtures. A
 * development fixture feeds the built-in template bank and the evaluation fixture
 * is reserved, so those need a deliberate, reviewed change, never a flag.
 */
export class ImportError extends Error {
  constructor(message: string) { super(message); this.name = 'ImportError'; }
}

export interface ImportState {
  readonly names: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
  readonly manifest: Manifest;
}
export interface ImportPlan { readonly path: string; readonly fixture: InkFixture; readonly manifest: Manifest }

/** File-name form of a fixture name, matching the names the app suggests. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'fixture';
}

export function planImport(file: { readonly name: string; readonly text: string }, state: ImportState, options: { readonly session?: string }): ImportPlan {
  let fixture: InkFixture;
  try { fixture = parseFixture(file.text); }
  catch (error) { throw new ImportError(`${file.name} is not a valid fixture file: ${error instanceof Error ? error.message : String(error)}`); }
  if (fixture.provenance !== 'recorded') throw new ImportError(`${file.name} is a ${fixture.provenance} fixture. Only recorded fixtures are imported; hand-authored ones are added by a reviewed change.`);
  if (options.session === undefined) {
    const known = [...sessionCounts(state.manifest)].map(([id, count]) => `${id} (${count})`).join(', ') || 'none yet';
    throw new ImportError(`--session <id> is required: it names the sitting these measures were written in. Measures from one sitting share an id; an unrelated sitting gets a new one. Existing sessions: ${known}.`);
  }
  if (!isSessionId(options.session)) throw new ImportError(`Invalid session id "${options.session}": use lowercase letters, digits, dots, dashes, or underscores (up to 64 characters).`);
  if (state.names.has(fixture.name)) throw new ImportError(`A fixture named "${fixture.name}" already exists (${file.name}). Fixture names must be unique.`);
  const path = `recorded/${slugify(fixture.name)}.json`;
  if (state.paths.has(path) || Object.hasOwn(state.manifest.fixtures, path)) throw new ImportError(`${path} already exists (from ${file.name}); its name is too close to another fixture's.`);
  return { path, fixture, manifest: withEntry(state.manifest, path, { role: 'regression', session: options.session }) };
}
