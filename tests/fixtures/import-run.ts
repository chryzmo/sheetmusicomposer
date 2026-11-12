import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRuntimeBank } from '../../src/recognize/runtime-bank';
import { ImportError, planImport } from './import-fixture';
import type { ImportPlan } from './import-fixture';
import { loadFixtures } from './load';
import { decodeManifest, serializeManifest, sessionCounts } from './manifest';
import { scoreBank } from './personal-eval';
import { fixtureRoot, manifestPath } from './roles';

export { ImportError } from './import-fixture';

const usage = `Usage: npm run fixtures:import -- --session <id> [--dry-run] <fixture.json>...

Adds downloaded recorded fixtures to the repository as regression fixtures:
  - validates each file with the real fixture decoder,
  - copies it byte for byte to fixtures/recorded/<name>.json (never rewritten),
  - records its role and session in tests/fixtures/manifest.json,
  - prints how the built-in bank reads it.
Nothing is written unless every file is valid (all or nothing). It never runs git.
--session names the sitting: measures written in one go share an id. Development and
evaluation fixtures are not imported here; they need a reviewed change.`;

export interface ImportEnv {
  readonly log: (line: string) => void;
  readonly fixturesRoot?: string;
  readonly manifestFile?: string;
}
export interface ImportResult { readonly imported: readonly { readonly path: string; readonly name: string; readonly session: string }[]; readonly dryRun: boolean }

function parseArgs(argv: readonly string[]): { files: string[]; session?: string; dryRun: boolean; help: boolean } {
  const files: string[] = [];
  let session: string | undefined, dryRun = false, help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--session') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new ImportError('--session needs a value');
      session = value;
    } else if (arg.startsWith('--session=')) session = arg.slice('--session='.length);
    else if (arg.startsWith('-')) throw new ImportError(`Unknown option ${arg}.\n\n${usage}`);
    else files.push(arg);
  }
  return { files, ...(session === undefined ? {} : { session }), dryRun, help };
}

const score = (n: number, total: number): string => `${n}/${total}`;

export function runImport(argv: readonly string[], env: ImportEnv): ImportResult {
  const args = parseArgs(argv);
  if (args.help) { env.log(usage); return { imported: [], dryRun: true }; }
  if (args.files.length === 0) throw new ImportError(`No fixture files given.\n\n${usage}`);
  const root = env.fixturesRoot ?? fixtureRoot, manifestFile = env.manifestFile ?? manifestPath;
  if (!existsSync(manifestFile)) throw new ImportError(`Fixture manifest not found: ${manifestFile}`);
  const existing = existsSync(root) ? loadFixtures(root) : [];
  let state = {
    names: new Set(existing.map(({ fixture }) => fixture.name)),
    paths: new Set(existing.map(({ path }) => path.slice(root.length).replace(/^[/\\]+/, '').split('\\').join('/'))),
    manifest: decodeManifest(readFileSync(manifestFile, 'utf8')),
  };
  // Plan everything first, so one bad file leaves the repository untouched.
  const planned: { plan: ImportPlan; bytes: Buffer }[] = [];
  const seenBytes = new Set<string>();
  for (const file of args.files) {
    if (!existsSync(file)) throw new ImportError(`File not found: ${file}`);
    const bytes = readFileSync(file);
    const key = bytes.toString('base64');
    if (seenBytes.has(key)) throw new ImportError(`${file} is a duplicate of another file in this import.`);
    seenBytes.add(key);
    const plan = planImport({ name: file, text: bytes.toString('utf8') }, state, args.session === undefined ? {} : { session: args.session });
    state = { names: new Set([...state.names, plan.fixture.name]), paths: new Set([...state.paths, plan.path]), manifest: plan.manifest };
    planned.push({ plan, bytes });
  }
  const builtin = createRuntimeBank();
  for (const { plan } of planned) {
    env.log(`${args.dryRun ? 'Would import' : 'Importing'} "${plan.fixture.name}" -> fixtures/${plan.path} (regression, session ${args.session})`);
    try {
      const result = scoreBank([{ path: join(root, plan.path), fixture: plan.fixture }], builtin);
      const { primitives: p, events: e } = result;
      env.log(`  built-in bank: shapes exact ${score(p.exact, p.total)}, wrong accepts ${p.wrongAccepts}, known rejects ${p.knownRejects}; ` +
        (e.expected === 0 ? 'no expected notes to score' : `notes proposed ${score(e.proposedExactly, e.expected)}, wrong proposals ${e.wrongProposals}`));
      if (p.wrongAccepts > 0 || e.wrongProposals > 0) env.log('  NOTE: the built-in bank reads something here wrongly; the fixture test suite will flag it. That is a recognition finding, not an import problem.');
    } catch (error) {
      env.log(`  (could not score: ${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (args.dryRun) { env.log('Dry run: nothing was written.'); return { imported: planned.map(({ plan }) => ({ path: plan.path, name: plan.fixture.name, session: args.session! })), dryRun: true }; }
  const created: string[] = [];
  try {
    for (const { plan, bytes } of planned) {
      const target = join(root, plan.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx' });
      created.push(target);
    }
    writeFileSync(manifestFile, serializeManifest(state.manifest));
  } catch (error) {
    for (const target of created) rmSync(target, { force: true });
    throw new ImportError(`Could not write the import, so nothing was kept: ${error instanceof Error ? error.message : String(error)}`);
  }
  const counts = sessionCounts(state.manifest);
  env.log(`Imported ${planned.length} fixture${planned.length === 1 ? '' : 's'}; session ${args.session} now has ${counts.get(args.session!)}.`);
  env.log('Next: npm run test:fixtures to see the report, then review `git status` and commit. Existing results are pinned per fixture in tests/fixtures/runtime-bank.test.ts; add this one there to lock its result.');
  return { imported: planned.map(({ plan }) => ({ path: plan.path, name: plan.fixture.name, session: args.session! })), dryRun: false };
}
