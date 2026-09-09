#!/usr/bin/env node
// Launcher for the wanderers-guide stack with the wgui-ext endpoints mounted in.
//
// The extension lives entirely in this repo (supabase/wgui-ext); the stack is started
// from the wanderers-guide checkout's compose file plus docker/wgui-ext.compose.yml as
// an override. Everything path-shaped is resolved here rather than documented as a
// command, because the two dev boxes are Windows and prod is Linux and compose wants
// forward slashes in the bind sources either way.
//
//   node scripts/wgui-ext.mjs up       start (or update) the whole stack, extension included
//   node scripts/wgui-ext.mjs restart  reload the functions container after a code change
//   node scripts/wgui-ext.mjs test     run the wgui-ext Deno tests against the running stack
//   node scripts/wgui-ext.mjs config   print the merged compose config (mount smoke test)
//
// WG_DIR overrides the wanderers-guide checkout location (default: ../wanderers-guide).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(repoRoot, 'supabase', 'wgui-ext');
const overrideFile = path.join(repoRoot, 'docker', 'wgui-ext.compose.yml');
const wgDir = path.resolve(process.env.WG_DIR ?? path.join(repoRoot, '..', 'wanderers-guide'));
const stackFile = path.join(wgDir, 'docker-compose.yml');

/** Compose only accepts POSIX separators inside a volume spec. */
const posix = (p) => p.split(path.sep).join('/');

function die(message) {
  console.error(`wgui-ext: ${message}`);
  process.exit(1);
}

if (!existsSync(stackFile)) {
  die(`no docker-compose.yml at ${wgDir}. Set WG_DIR to the wanderers-guide checkout.`);
}

/** The stack's .env, which compose itself reads from --project-directory. */
function stackEnv() {
  const envFile = path.join(wgDir, '.env');
  if (!existsSync(envFile)) return {};
  const out = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return out;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.error) die(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function compose(args) {
  run(
    'docker',
    [
      'compose',
      '-f',
      stackFile,
      '-f',
      overrideFile,
      '--project-directory',
      wgDir,
      ...args,
    ],
    {
      env: {
        ...process.env,
        WGUI_EXT_DIR: posix(extDir),
        WG_FUNCTIONS_DIR: posix(path.join(wgDir, 'supabase', 'functions')),
      },
    }
  );
}

function test() {
  const env = { ...stackEnv(), ...process.env };
  const anonKey = env.ANON_KEY ?? env.PUBLIC_ANON_KEY ?? '';
  const serviceRoleKey = env.SERVICE_ROLE_KEY ?? '';
  if (!anonKey || !serviceRoleKey) {
    die(`ANON_KEY / SERVICE_ROLE_KEY not found in ${path.join(wgDir, '.env')} or the environment.`);
  }

  // Run inside the stack's network so the tests reach kong under its service name, which
  // avoids depending on which host port this box publishes.
  run('docker', [
    'run',
    '--rm',
    '--network',
    process.env.WGUI_EXT_NETWORK ?? 'wanderers-guide_default',
    '-v',
    `${posix(extDir)}:/wgui-ext:ro`,
    '-v',
    'wgui-ext-deno-cache:/deno-dir',
    '-e',
    `SUPABASE_URL=${process.env.WGUI_EXT_SUPABASE_URL ?? 'http://kong:8000'}`,
    '-e',
    `ANON_KEY=${anonKey}`,
    '-e',
    `SERVICE_ROLE_KEY=${serviceRoleKey}`,
    process.env.WGUI_EXT_DENO_IMAGE ?? 'denoland/deno:latest',
    'test',
    '--no-check',
    '--allow-net',
    '--allow-env',
    '--allow-read',
    '/wgui-ext/_tests/wgui-ext.test.ts',
  ]);
}

const [command = 'up'] = process.argv.slice(2);
switch (command) {
  case 'up':
    compose(['up', '-d']);
    break;
  case 'restart':
    // A plain `up` reuses the running container, and the edge runtime caches the isolate
    // it already loaded, so a changed handler needs the process replaced. Kong goes with
    // it: `up` can recreate a container, and kong keeps keepalive connections to the old
    // address, which then 502s intermittently until it is restarted too.
    compose(['up', '-d']);
    compose(['restart', 'functions', 'kong']);
    break;
  case 'down':
    compose(['down']);
    break;
  case 'config':
    compose(['config']);
    break;
  case 'test':
    test();
    break;
  default:
    die(`unknown command "${command}". Use up, restart, down, config or test.`);
}
