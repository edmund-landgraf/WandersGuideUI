import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPH_LINE_LIMIT,
  MATHJS_GRAPH_NEEDLE,
  assertOverlaysReady,
  invalidBundleReason,
  overlayProblems,
} from './export-bundle-guard.mjs';

function tree() {
  const root = mkdtempSync(path.join(tmpdir(), 'wgui-overlay-'));
  const extDir = path.join(root, 'wgui-ext');
  const exportDir = path.join(root, 'wgui-export');
  mkdirSync(path.join(extDir, 'wgui-ext-list-key-characters'), { recursive: true });
  mkdirSync(path.join(exportDir, 'wgui-export-character'), { recursive: true });
  mkdirSync(path.join(exportDir, 'wgui-export-character-slim'), { recursive: true });
  writeFileSync(path.join(extDir, 'wgui-ext-list-key-characters', 'index.ts'), 'export {}\n');
  writeFileSync(path.join(exportDir, 'wgui-export-character', 'index.ts'), 'export {}\n');
  writeFileSync(path.join(exportDir, 'wgui-export-character-slim', 'index.ts'), 'export {}\n');
  return { root, extDir, exportDir };
}

function writeBundle(exportDir, text) {
  writeFileSync(path.join(exportDir, 'wgui-export-character', 'compile.bundle.js'), text);
}

describe('export overlay guard', () => {
  it('accepts a short bundle that still exports buildJsonV4Object', () => {
    const dirs = tree();
    writeBundle(dirs.exportDir, 'export function buildJsonV4Object() { return {}; }\n');
    assert.deepEqual(overlayProblems(dirs), []);
    assert.doesNotThrow(() => assertOverlaysReady(dirs));
    rmSync(dirs.root, { recursive: true, force: true });
  });

  it('reports a missing mount before any compose recreate', () => {
    const dirs = tree();
    writeBundle(dirs.exportDir, 'export function buildJsonV4Object() {}\n');
    const gone = path.join(dirs.root, 'deleted-checkout', 'supabase', 'wgui-export');
    const problems = overlayProblems({ ...dirs, exportDir: gone });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /does not exist/);
    assert.match(problems[0], /empty directory/);
    assert.throws(() => assertOverlaysReady({ ...dirs, exportDir: gone }), /left in place/);
    rmSync(dirs.root, { recursive: true, force: true });
  });

  it('reports a missing compile.bundle.js when the indexes are present', () => {
    const dirs = tree();
    const problems = overlayProblems(dirs);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /compile\.bundle\.js/);
    assert.match(problems[0], /both import it/);
    rmSync(dirs.root, { recursive: true, force: true });
  });

  it('rejects the known mathjs regexp and accepts the documented rewrite', () => {
    const bad = `${' '.repeat(20)}${MATHJS_GRAPH_NEEDLE}${'\\u0041'.repeat(GRAPH_LINE_LIMIT)}`;
    assert.ok(bad.length > GRAPH_LINE_LIMIT);
    const reason = invalidBundleReason(`export function buildJsonV4Object() {}\n${bad}\n`);
    assert.match(reason, /mathjs regexp/);
    assert.equal(
      invalidBundleReason(
        'export function buildJsonV4Object() {}\n      test: (s) => isString2 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)\n'
      ),
      null
    );

    const dirs = tree();
    writeBundle(dirs.exportDir, `export function buildJsonV4Object() {}\n${bad}\n`);
    assert.match(overlayProblems(dirs)[0], /Do not recreate functions/);
    rmSync(dirs.root, { recursive: true, force: true });
  });

  it('rejects a bundle that does not export the compile entry the workers import', () => {
    assert.match(invalidBundleReason('export const unrelated = 1;\n'), /buildJsonV4Object/);
  });
});
