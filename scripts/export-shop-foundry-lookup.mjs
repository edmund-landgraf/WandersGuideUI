import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'public/data/shop-foundry-lookup.json');
const sql = `
SELECT json_build_object(
  'wgId', s.wg_id,
  'name', m.wg_name,
  'pack', e.foundry_pack_id,
  'slug', e.pf2e_slug,
  'status', m.status
)
FROM wg_keyword_snapshot s
JOIN wg_pf2e_catalog_matches m
  ON m.source_table = 'item' AND m.wg_id = s.wg_id
LEFT JOIN pf2e_catalog_entries e ON e.entry_id = m.entry_id
WHERE s.source_table = 'item'
  AND m.status IN ('active', 'ambiguous', 'unresolved')
ORDER BY m.wg_id;
`;

const foundrySql = `
SELECT json_build_object(
  'wgId', match.wg_id,
  'name', e.pf2e_name,
  'pack', e.foundry_pack_id,
  'slug', e.pf2e_slug,
  'foundryDocumentId', e.foundry_document_id,
  'level', e.level,
  'rarity', e.rarity
)
FROM pf2e_catalog_entries e
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(DISTINCT m.wg_id) = 1 THEN min(m.wg_id) END AS wg_id
  FROM wg_pf2e_catalog_matches m
  WHERE m.entry_id = e.entry_id
    AND m.source_table = 'item'
    AND m.status = 'active'
) match ON true
WHERE e.foundry_pack_id = 'pf2e.equipment-srd'
  AND e.foundry_document_id IS NOT NULL
  AND e.pf2e_slug IS NOT NULL
  AND e.pf2e_slug <> ''
ORDER BY e.pf2e_slug;
`;

const formulaSql = `
SELECT json_build_object(
  'wgId', wg_item_id,
  'name', formula_name,
  'pack', foundry_pack_id,
  'slug', pf2e_slug,
  'status', status,
  'foundryDocumentId', foundry_document_id
)
FROM pf2e_formula_entries
WHERE status = 'active'
ORDER BY wg_item_id, pf2e_slug;
`;

function psql(query) {
  return execFileSync('docker', ['exec', '-i', 'my-postgres', 'psql', '-U', 'appuser', '-d', 'wgi_rules', '-At', '-c', query], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const rows = psql(sql);
const foundryItems = psql(foundrySql);
const formulas = psql(formulaSql);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ version: 1, rows, formulas, foundryItems }, null, 2)}\n`);
console.log(`Wrote ${rows.length} WG item rows, ${foundryItems.length} Foundry equipment rows, and ${formulas.length} formula rows to ${output}`);
