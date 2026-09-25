#!/usr/bin/env node
// Mounts only wgui-export-character onto the wanderers-guide stack.
// Combat stays scripts/wgui-ext.mjs / npm run stack:up.
//
//   node scripts/wgui-export.mjs up
//   node scripts/wgui-export.mjs restart
//   node scripts/wgui-export.mjs test
//   node scripts/wgui-export.mjs config
//
// WG_DIR overrides the wanderers-guide checkout (default: ../wanderers-guide).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = path.join(repoRoot, 'supabase', 'wgui-export');
const overrideFile = path.join(repoRoot, 'docker', 'wgui-export.compose.yml');
const wgDir = path.resolve(process.env.WG_DIR ?? path.join(repoRoot, '..', 'wanderers-guide'));
const stackFile = path.join(wgDir, 'docker-compose.yml');
const posix = (p) => p.split(path.sep).join('/');

function die(message) {
  console.error(`wgui-export: ${message}`);
  process.exit(1);
}

if (!existsSync(stackFile)) {
  die(`no docker-compose.yml at ${wgDir}. Set WG_DIR to the wanderers-guide checkout.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.error) die(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function bundle() {
  run(process.execPath, [path.join(repoRoot, 'scripts', 'bundle-wgui-export.mjs')], {
    env: { ...process.env, WG_DIR: wgDir },
  });
}

function compose(args) {
  run(
    'docker',
    ['compose', '-f', stackFile, '-f', overrideFile, '--project-directory', wgDir, ...args],
    {
      env: {
        ...process.env,
        WGUI_EXPORT_DIR: posix(exportDir),
        WG_FUNCTIONS_DIR: posix(path.join(wgDir, 'supabase', 'functions')),
      },
    }
  );
}

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

function test() {
  const env = { ...stackEnv(), ...process.env };
  const anonKey = env.ANON_KEY ?? env.PUBLIC_ANON_KEY ?? '';
  const serviceRoleKey = env.SERVICE_ROLE_KEY ?? '';
  if (!anonKey || !serviceRoleKey) {
    die(`ANON_KEY / SERVICE_ROLE_KEY not found in ${path.join(wgDir, '.env')} or the environment.`);
  }
  run('docker', [
    'run',
    '--rm',
    '--network',
    process.env.WGUI_EXPORT_NETWORK ?? 'wanderers-guide_default',
    '-v',
    `${posix(exportDir)}:/wgui-export:ro`,
    '-v',
    `${posix(path.join(wgDir, 'supabase', 'functions'))}:/functions:ro`,
    '-e',
    `SUPABASE_URL=${process.env.WGUI_EXPORT_SUPABASE_URL ?? 'http://kong:8000'}`,
    '-e',
    `ANON_KEY=${anonKey}`,
    '-e',
    `SERVICE_ROLE_KEY=${serviceRoleKey}`,
    process.env.WGUI_EXPORT_DENO_IMAGE ?? 'denoland/deno:latest',
    'test',
    '--no-check',
    '--allow-net',
    '--allow-env',
    '--allow-read',
    '/wgui-export/_tests/wgui-export.test.ts',
  ]);
}

const [command = 'up'] = process.argv.slice(2);
switch (command) {
  case 'up':
    bundle();
    compose(['up', '-d']);
    break;
  case 'restart':
    bundle();
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
  case 'bundle':
    bundle();
    break;
  default:
    die(`unknown command "${command}". Use up, restart, down, config, bundle or test.`);
}
