import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Thin wrapper: loads the TypeScript import runner through Vite (as build-runtime-bank
// does) so fixtures are validated with the real decoder. See tests/fixtures/import-run.ts.
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true } });
try {
  const { runImport } = await server.ssrLoadModule('/tests/fixtures/import-run.ts');
  runImport(process.argv.slice(2), { log: (line) => console.log(line) });
} catch (error) {
  console.error(error?.name === 'ImportError' ? `Import failed: ${error.message}` : error);
  process.exitCode = 1;
} finally { await server.close(); }
