import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'public/data/shop-foundry-lookup.json');
const sql = `
SELECT json_build_object(
  'wgId', m.wg_id,
  'pack', e.foundry_pack_id,
  'slug', e.pf2e_slug,
  'status', m.status
)
FROM wg_pf2e_catalog_matches m
LEFT JOIN pf2e_catalog_entries e ON e.entry_id = m.entry_id
WHERE m.source_table = 'item'
  AND m.status IN ('active', 'ambiguous', 'unresolved')
ORDER BY m.wg_id;
`;

const raw = execFileSync('docker', ['exec', '-i', 'my-postgres', 'psql', '-U', 'appuser', '-d', 'wgi_rules', '-At', '-c', sql], { encoding: 'utf8' });
const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`);
console.log(`Wrote ${rows.length} shop Foundry lookup rows to ${output}`);
