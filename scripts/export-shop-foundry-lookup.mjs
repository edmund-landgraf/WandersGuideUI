import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'public/data/shop-foundry-lookup.json');
const sql = `
WITH item_snapshots AS (
  SELECT DISTINCT ON (s.wg_id) s.id AS snapshot_id, s.wg_id
  FROM wg_keyword_snapshot s
  WHERE s.source_table = 'item'
  ORDER BY s.wg_id, s.id DESC
)
SELECT json_build_object(
  'wgId', i.wg_id,
  'pack', e.pack,
  'slug', e.pf2e_slug,
  'status', m.status
)
FROM item_snapshots i
JOIN wg_pf2e_catalog_matches m ON m.snapshot_id = i.snapshot_id
LEFT JOIN pf2e_catalog_entries e ON e.id = m.pf2e_catalog_entry_id
WHERE m.status IN ('active', 'ambiguous', 'unresolved')
ORDER BY i.wg_id;
`;

const raw = execFileSync('docker', ['exec', '-i', 'my-postgres', 'psql', '-U', 'appuser', '-d', 'wgi_rules', '-At', '-c', sql], { encoding: 'utf8' });
const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`);
console.log(`Wrote ${rows.length} shop Foundry lookup rows to ${output}`);
