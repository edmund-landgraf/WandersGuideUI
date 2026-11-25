// Read-only audit of the pinned published pack. No production credentials or writes.
import { JSDOM } from 'jsdom';
import { sheetEnv } from '../src/live-sheet.js';
import { downloadMonsterCore2Files } from '../../src/process/upload/monster-core-2-pack.ts';
process.env.SUPABASE_URL = 'https://fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.SUPABASE_ANON_KEY = 'fixture';
sheetEnv();
const dom = new JSDOM('');
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
const { convertFoundryCreatureToGranularCreature } = await import('../../src/process/upload/creature-import.ts');
try {
  const files = await downloadMonsterCore2Files();
  const failures: {file:string; reason:string}[] = [];
  const names = new Map<string, string[]>();
  let converted = 0;
  for (const file of files) {
    try {
      const actor = JSON.parse(await file.text());
      const result = convertFoundryCreatureToGranularCreature(actor);
      if (!result.name || !Number.isFinite(result.level) || !Number.isFinite(result.hp.value) || result.hp.value <= 0) {
        throw new Error('Missing name, level, or positive HP');
      }
      const key = result.name.trim().toLowerCase();
      names.set(key, [...(names.get(key) ?? []), file.name]);
      converted++;
    } catch (error) {
      failures.push({file:file.name, reason:error instanceof Error ? error.message : String(error)});
    }
  }
  const duplicates = [...names].filter(([, rows])=>rows.length>1);
  console.log(JSON.stringify({publishedNpcFiles:files.length,converted,failures,duplicateNames:duplicates},null,2));
  if (failures.length || duplicates.length) process.exitCode=1;
} finally { dom.window.close(); }
