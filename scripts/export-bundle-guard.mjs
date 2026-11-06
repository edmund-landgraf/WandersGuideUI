// Refuses to recreate the functions container when the overlay it is about
// to mount cannot boot the character-export workers.
//
// Docker creates a missing bind source as an empty directory, then the
// entrypoint copies that emptiness into the tmpfs and replaces the running
// container. A present compile.bundle.js can still fail the same way: mathjs
// emits one identifier regexp the edge runtime cannot parse
// ("failed to create the graph"). scripts/bundle-wgui-export.mjs rewrites that
// line; this module recognizes a bundle that still has it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const GRAPH_LINE_LIMIT = 8000;
// Text of the unrewritten mathjs test, as it appears in the generated file.
export const MATHJS_GRAPH_NEEDLE = 'isString2 && /^(?:[A-Za-z\\xAA';

export function invalidBundleReason(text) {
  if (!text.includes('buildJsonV4Object')) {
    return 'compile.bundle.js has no buildJsonV4Object binding. Both export workers import it.';
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > GRAPH_LINE_LIMIT && lines[i].includes(MATHJS_GRAPH_NEEDLE)) {
      return `line ${i + 1} is the mathjs regexp the edge runtime cannot parse (${lines[i].length} characters). Run npm run export:bundle where vite is installed, or apply the rewrite in scripts/bundle-wgui-export.mjs. Do not recreate functions with this file.`;
    }
  }
  return null;
}

function missingDir(kind, dir) {
  return `${kind} mount source does not exist: ${dir}. Docker would create an empty directory and the recreated functions container would lose this overlay.`;
}

export function exportOverlayProblems(exportDir) {
  if (!existsSync(exportDir)) return [missingDir('export', exportDir)];
  let stat;
  try {
    stat = statSync(exportDir);
  } catch (error) {
    return [`export mount source is not readable: ${exportDir} (${error.message})`];
  }
  if (!stat.isDirectory()) return [`export mount source is not a directory: ${exportDir}`];

  const problems = [];
  for (const relative of [
    path.join('wgui-export-character', 'index.ts'),
    path.join('wgui-export-character-slim', 'index.ts'),
  ]) {
    const file = path.join(exportDir, relative);
    if (!existsSync(file)) problems.push(`missing ${file}`);
  }

  const bundle = path.join(exportDir, 'wgui-export-character', 'compile.bundle.js');
  if (!existsSync(bundle)) {
    problems.push(
      `missing ${bundle}. wgui-export-character and wgui-export-character-slim both import it. Generate it with npm run export:bundle before recreating functions. The file is gitignored.`
    );
    return problems;
  }
  const reason = invalidBundleReason(readFileSync(bundle, 'utf8'));
  if (reason) problems.push(`${bundle}: ${reason}`);
  return problems;
}

export function extOverlayProblems(extDir) {
  if (!existsSync(extDir)) return [missingDir('ext', extDir)];
  let stat;
  try {
    stat = statSync(extDir);
  } catch (error) {
    return [`ext mount source is not readable: ${extDir} (${error.message})`];
  }
  if (!stat.isDirectory()) return [`ext mount source is not a directory: ${extDir}`];
  const sentinel = path.join(extDir, 'wgui-ext-list-key-characters', 'index.ts');
  if (!existsSync(sentinel)) return [`missing ${sentinel}`];
  return [];
}

export function overlayProblems({ exportDir, extDir }) {
  return [...extOverlayProblems(extDir), ...exportOverlayProblems(exportDir)];
}

export function assertOverlaysReady({ exportDir, extDir }) {
  const problems = overlayProblems({ exportDir, extDir });
  if (problems.length === 0) return;
  throw new Error(
    `refusing to recreate functions; the running container was left in place.\n${problems.map((line) => `- ${line}`).join('\n')}`
  );
}
