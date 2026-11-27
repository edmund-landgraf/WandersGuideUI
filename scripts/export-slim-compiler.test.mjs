import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { patchSlimCompiler } from './export-slim-compiler.mjs';

test('slim hook supports the checked-in JSON v4 compiler signature', () => {
  const original = readFileSync(new URL('../src/process/export/json/json-v4.ts', import.meta.url), 'utf8');
  const patched = patchSlimCompiler(original);
  assert.match(patched, /wguiSlim = false/);
  assert.match(patched, /getWguiSlimJsonV4Content/);
  assert.match(patched, /wguiSlim \? \{ variables: getVariables\(STORE_ID\)/);
  assert.match(patched, /: exportVariableStore\(STORE_ID\)/);
});

for (const withPackage of [false, true]) {
  test('slim compiler skips full snapshot; full compiler unchanged (package=' + withPackage + ')', async () => {
    const source = `
      type LivingEntity = { id: number };
      type StoreID = string;
      type ContentPackage = unknown;
      const STORE_ID = 'CHARACTER';
      const store = { variables: { AC: { value: 18 } }, bonuses: { AC: [1] }, history: { AC: [2] } };
      let snapshots = 0;
      const helpers = {
        getVariables: (_id: string) => store.variables,
        exportVariableStore: (_id: string) => { snapshots++; return structuredClone(store); },
      };
      const { getVariables, exportVariableStore } = helpers;
      export async function getJsonV4Content(entity: LivingEntity, inputStoreID?: StoreID${withPackage ? ', contentPackage?: ContentPackage' : ''}) {
        const rawData = exportVariableStore(STORE_ID);
        return { raw_data_dump: rawData, id: entity.id };
      }
      export function snapshotCount() { return snapshots; }
    `;
    const js = stripTypeScriptTypes(patchSlimCompiler(source));
    const module = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
    const slim = await module.getWguiSlimJsonV4Content({ id: 1 });
    assert.equal(module.snapshotCount(), 0);
    assert.deepEqual(slim.raw_data_dump.variables, { AC: { value: 18 } });
    assert.equal(slim.raw_data_dump.bonuses, undefined);
    assert.equal(slim.raw_data_dump.history, undefined);
    assert.deepEqual(Object.keys(slim.raw_data_dump), ['variables', 'bonuses', 'history']);
    const full = await module.getJsonV4Content({ id: 2 });
    assert.equal(module.snapshotCount(), 1);
    assert.deepEqual(full.raw_data_dump.bonuses, { AC: [1] });
    assert.deepEqual(full.raw_data_dump.history, { AC: [2] });
  });
}

test('unsupported upstream compiler fails closed', () => {
  assert.throws(() => patchSlimCompiler('export async function getJsonV4Content(entity) {}'), /Unsupported WG json-v4 compiler/);
});
