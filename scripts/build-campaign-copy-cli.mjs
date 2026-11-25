// Use the installed esbuild JS API, not a .bin shim or npx command.
// Vite may have its own nested esbuild; resolve it from Vite's package location.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
let esbuild;
try {
  esbuild = require('esbuild');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  try {
    const fromVite = createRequire(require.resolve('vite/package.json'));
    esbuild = fromVite('esbuild');
  } catch {
    console.error('The installed Vite/esbuild dependency is unavailable. Run npm ci (with development dependencies included) and retry.');
    process.exit(1);
  }
}

try {
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['scripts/dry-run-campaign-copy.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: 'scripts/.dist/dry-run-campaign-copy.mjs',
    logLevel: 'info',
  });
} catch {
  // esbuild reports the build diagnostic itself. Do not launch a stale bundle.
  process.exitCode = 1;
}
