#!/usr/bin/env node
/**
 * Bundle wanderers-guide jsonV4 / pdfV2 for the Deno isolate.
 * Reads the WG frontend; does not modify that checkout.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wgDir = resolve(process.env.WG_DIR ?? join(repoRoot, '..', 'wanderers-guide'));
const frontend = join(wgDir, 'frontend');
if (!existsSync(join(frontend, 'vite.config.ts'))) {
  console.error(`wgui-export bundle: no frontend at ${frontend}. Set WG_DIR.`);
  process.exit(1);
}
const { build } = createRequire(join(frontend, 'vite.config.ts'))('esbuild');
const outDir = join(repoRoot, 'supabase', 'wgui-export', 'wgui-export-character');

const stubContent = `
let pkg = {
  ancestries: [], backgrounds: [], classes: [], abilityBlocks: [], items: [],
  languages: [], spells: [], traits: [], creatures: [], archetypes: [],
  versatileHeritages: [], classArchetypes: [], sources: [], lookupTraits: [],
  defaultSources: { PAGE: [], INFO: [] },
};
export function setExportContentPackage(next) {
  pkg = next;
}
function rows(type) {
  const map = {
    ancestry: pkg.ancestries,
    background: pkg.backgrounds,
    class: pkg.classes,
    'ability-block': pkg.abilityBlocks,
    item: pkg.items,
    language: pkg.languages,
    spell: pkg.spells,
    trait: pkg.traits,
    creature: pkg.creatures,
    archetype: pkg.archetypes,
    'versatile-heritage': pkg.versatileHeritages,
    'class-archetype': pkg.classArchetypes,
    'content-source': pkg.sources,
  };
  return map[type] ?? [];
}
export function getCachedContent(type) { return rows(type); }
export async function fetchContentById(type, id) { return rows(type).find((row) => row.id === id) || null; }
export async function fetchContentAll(type) { return rows(type); }
export async function fetchContent(type) { return rows(type); }
export async function fetchTraitByName(name) {
  const needle = String(name ?? '').toLowerCase();
  return rows('trait').find((row) => String(row.name ?? '').toLowerCase() === needle) || null;
}
export async function fetchArchetypeByDedicationFeat() { return null; }
export function getDefaultSources(view) { return pkg.defaultSources?.[view] ?? []; }
export function getContentFast(type, ids) { return rows(type).filter((row) => ids.includes(row.id)); }
export function defineDefaultSources(_view, sources) { return sources; }
export async function fetchContentSources() { return pkg.sources ?? []; }
export async function fetchContentPackage() { return pkg; }
export function importFromContentPackage() {}
export function getWorkerContentReader() { return null; }
`;

const result = await build({
  absWorkingDir: frontend,
  stdin: {
    contents: `
      export { setExportContentPackage } from '@content/content-store';
      import { getJsonV4Content } from '@export/json/json-v4';
      import { pdfV2 } from '@export/pdf/pdf-v2';

      export async function buildJsonV4Object(entity) {
        return { version: 4, character: entity, content: await getJsonV4Content(entity) };
      }

      export async function buildPdfV2Bytes(character, templateBytes) {
        const origFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = (input, init) => {
          const url = String(typeof input === 'string' ? input : input?.url ?? input);
          if (url.includes('character-sheet-v2.pdf')) {
            return Promise.resolve(new Response(templateBytes, { status: 200 }));
          }
          return origFetch(input, init);
        };
        let captured;
        const OrigBlob = globalThis.Blob;
        globalThis.Blob = class extends OrigBlob {
          constructor(parts, opts) {
            if (parts?.[0]) captured = parts[0];
            super(parts, opts);
          }
        };
        try {
          await pdfV2(character);
        } finally {
          globalThis.fetch = origFetch;
          globalThis.Blob = OrigBlob;
        }
        if (!captured) throw new Error('PDF export produced no bytes');
        return captured instanceof Uint8Array ? captured : new Uint8Array(captured);
      }
    `,
    resolveDir: frontend,
    loader: 'ts',
  },
  tsconfig: join(frontend, 'tsconfig.json'),
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  define: {
    'import.meta.env': JSON.stringify({ VITE_ENV: 'production' }),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  banner: {
    js: `const window = globalThis;
const document = {
  createElement() { return { setAttribute() {}, click() {}, remove() {}, href: '', download: '' }; },
  body: { appendChild() {}, removeChild() {} },
};
const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
if (typeof URL !== 'undefined') {
  URL.createObjectURL = URL.createObjectURL || (() => 'blob:wgui-export');
  URL.revokeObjectURL = URL.revokeObjectURL || (() => {});
}`,
  },
  plugins: [
    {
      name: 'export-stubs',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^@utils\/notifications$/ }, () => ({
          path: 'notifications',
          namespace: 'stub',
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents:
            'export function displayError(message) { console.warn(message); } export function showNotification() {}',
          loader: 'ts',
        }));
        pluginBuild.onResolve({ filter: /^@content\/content-store$/ }, () => ({
          path: 'content',
          namespace: 'export-content',
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'export-content' }, () => ({
          contents: stubContent,
          loader: 'ts',
        }));
        pluginBuild.onResolve({ filter: /^@auth\/user-manager$/ }, () => ({
          path: 'user',
          namespace: 'user-stub',
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'user-stub' }, () => ({
          contents:
            'export function getCachedPublicUser() { return null; } export async function getPublicUser() { return null; }',
          loader: 'ts',
        }));
      },
    },
  ],
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'compile.bundle.js'), result.outputFiles[0].text);
console.log(`wrote ${join(outDir, 'compile.bundle.js')} (${result.outputFiles[0].text.length} bytes)`);
