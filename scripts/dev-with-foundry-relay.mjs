#!/usr/bin/env node
// Foundry read relay for local Import from Foundry. Run beside an existing `npm run dev`.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

process.stderr.write(
  'dev:foundry: relay on http://127.0.0.1:8787 — open WGUI on your existing dev server (npm run dev, port 5194).\n',
);

const child = spawn(node, ['server/foundry-relay.mjs'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

function shutdown(code = 0) {
  if (!child.killed) child.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
child.on('exit', (code) => process.exit(code ?? 0));