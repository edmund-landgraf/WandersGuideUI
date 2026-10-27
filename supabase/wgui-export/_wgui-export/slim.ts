// Slim jsonV4 export: the same file wgui-export-character builds, minus the
// content catalog the Foundry importer and AMBA never read.
//
// Dropped:
//   content.all_spells / content.all_traits  every spell and trait in the enabled
//     books (about 2.2 MB). Rows from homebrew sources (all_sources row with a
//     user_id) are kept, because for those the export is the source of truth.
//   content.raw_data_dump.bonuses / .history  builder internals (variables stay;
//     the importer reads raw_data_dump.variables for *_IDS and casting state).
//   search_tsv on any row  Postgres search vectors.
// Kept: everything else, including character (details, content_sources,
// operation_data, spells, companions, inventory), feats_features, spell_sources,
// spell_slots, spells, focus_spells, innate_spells and all_sources.

export const SLIM_VERSION = 1;
const CATALOG_KEYS = new Set(['all_spells', 'all_traits']);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripSearchTsv(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSearchTsv);
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'search_tsv') continue;
    out[key] = stripSearchTsv(child);
  }
  return out;
}

export function homebrewSourceIds(content: Json | undefined): Set<number> {
  const ids = new Set<number>();
  const sources = content?.all_sources;
  if (!Array.isArray(sources)) return ids;
  for (const row of sources) {
    if (isObject(row) && typeof row.id === 'number' && typeof row.user_id === 'string' && row.user_id.trim()) {
      ids.add(row.id);
    }
  }
  return ids;
}

export function slimExport(full: unknown): unknown {
  if (!isObject(full) || !isObject(full.content)) return full;
  const content = full.content;
  const homebrew = homebrewSourceIds(content);
  const dropped: Record<string, number> = {};
  const out: Json = {};
  for (const [key, value] of Object.entries(content)) {
    if (CATALOG_KEYS.has(key)) {
      const rows = Array.isArray(value) ? value : [];
      const kept = rows.filter((row) => isObject(row) && homebrew.has(row.content_source_id as number));
      dropped[key] = rows.length - kept.length;
      if (kept.length) out[key] = kept;
      continue;
    }
    if (key === 'raw_data_dump' && isObject(value)) {
      for (const k of Object.keys(value)) if (k !== 'variables') dropped[`raw_data_dump.${k}`] = 1;
      out[key] = { variables: value.variables };
      continue;
    }
    out[key] = value;
  }
  return stripSearchTsv({ ...full, content: out, slim: { version: SLIM_VERSION, dropped } });
}