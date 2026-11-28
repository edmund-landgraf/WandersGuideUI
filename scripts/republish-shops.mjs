// Copy each published shop draft into its public snapshot.
// Same result as pressing Publish on every published shop: the link stays, the snapshot is replaced.
//
//   npm run republish:shops
//
// Reads SUPABASE_URL / VITE_SUPABASE_URL and SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY
// from the environment, .env.local, ../wanderers-guide/.env, ../../wanderers-guide/.env, or $WG_DIR/.env.

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

loadEnv(path.join(repoRoot, '.env.local'));
loadEnv(path.join(repoRoot, '..', 'wanderers-guide', '.env'));
loadEnv(path.join(repoRoot, '..', '..', 'wanderers-guide', '.env'));
if (process.env.WG_DIR) loadEnv(path.join(process.env.WG_DIR, '.env'));

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SERVICE_ROLE_KEY (or the VITE_ / SUPABASE_SERVICE_ROLE_KEY names).');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const pageSize = 200;
let from = 0;
let updated = 0;
let skipped = 0;

while (true) {
  const { data, error } = await supabase
    .from('syndicated_nodes')
    .select('id, name, draft')
    .eq('content_kind', 'shop')
    .eq('kind', 'entry')
    .eq('published', true)
    .order('id')
    .range(from, from + pageSize - 1);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data?.length) break;
  for (const shop of data) {
    if (shop.draft == null) {
      skipped += 1;
      console.log(`skip ${shop.id} ${shop.name} (no draft)`);
      continue;
    }
    const { error: writeError } = await supabase
      .from('syndicated_nodes')
      .update({ snapshot: shop.draft, published_at: new Date().toISOString() })
      .eq('id', shop.id)
      .eq('published', true);
    if (writeError) {
      console.error(`${shop.id} ${shop.name}: ${writeError.message}`);
      process.exit(1);
    }
    updated += 1;
    console.log(`published ${shop.id} ${shop.name}`);
  }
  if (data.length < pageSize) break;
  from += pageSize;
}

console.log(`Republished ${updated} shop${updated === 1 ? '' : 's'}.${skipped ? ` Skipped ${skipped} with no draft.` : ''}`);
