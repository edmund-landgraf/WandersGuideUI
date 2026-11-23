import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type FoundryShopLookupRow = {
  wgId?: number;
  name?: string | null;
  pack?: string | null;
  slug?: string | null;
  status: "active" | "ambiguous" | "unresolved";
  foundryDocumentId?: string | null;
  level?: number | null;
  rarity?: string | null;
};

type Lookup = { version: 1; rows: FoundryShopLookupRow[]; formulas?: FoundryShopLookupRow[]; foundryItems?: FoundryShopLookupRow[] };

let cached: Lookup | null | undefined;

function lookupPath() {
  return resolve(process.env.WGUI_SHOP_LOOKUP_PATH?.trim() || fileURLToPath(new URL("../../public/data/shop-foundry-lookup.json", import.meta.url)));
}

function load(): Lookup | null {
  if (cached !== undefined) return cached;
  try {
    const value = JSON.parse(readFileSync(lookupPath(), "utf8")) as Lookup;
    cached = value?.version === 1 && Array.isArray(value.rows) ? value : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Active Wanderer's Guide item id for a Foundry pack and slug, when exactly one match exists. */
function activeWgIds(lookup: Lookup) {
  const counts = new Map<string, { wgId: number; count: number }>();
  for (const row of lookup.rows) {
    if (row.status !== "active" || row.wgId == null || !row.pack || !row.slug) continue;
    const key = `${row.pack}\0${row.slug}`;
    const prev = counts.get(key);
    if (!prev) counts.set(key, { wgId: row.wgId, count: 1 });
    else if (prev.wgId !== row.wgId) prev.count += 1;
  }
  const ids = new Map<string, number>();
  for (const [key, value] of counts) if (value.count === 1) ids.set(key, value.wgId);
  return ids;
}

function equipmentRows(lookup: Lookup): FoundryShopLookupRow[] {
  const ids = activeWgIds(lookup);
  return (lookup.foundryItems ?? lookup.rows)
    .filter((row) => row.pack === "pf2e.equipment-srd" && row.slug)
    .map((row) => ({ ...row, wgId: row.wgId ?? ids.get(`${row.pack}\0${row.slug}`) }))
    .filter((row) => row.wgId != null);
}

export function searchFoundryShopItems(query = "", limit = 50, formulas = false) {
  const lookup = load();
  if (!lookup) return { loaded: false, items: [] as FoundryShopLookupRow[] };
  const needle = query.trim().toLowerCase();
  const rows = (formulas ? lookup.formulas ?? [] : equipmentRows(lookup))
    .filter((row) => formulas ? row.status === "active" && row.pack && row.slug && row.wgId != null : true)
    .filter((row) => !needle || `${row.name ?? ""} ${row.slug} ${row.pack}`.toLowerCase().includes(needle))
    .slice(0, Math.max(1, Math.min(200, Math.trunc(limit))));
  return { loaded: true, source: formulas ? "formulas" : "pf2e.equipment-srd", items: rows };
}

/** Every active equipment row with a unique Wanderer's Guide id. Shop creation needs the full set, not a search page. */
export function allFoundryShopEquipment() {
  const lookup = load();
  if (!lookup) return [] as FoundryShopLookupRow[];
  return equipmentRows(lookup);
}

export function foundryShopLookupStatus() {
  const lookup = load();
  return { loaded: Boolean(lookup), itemCount: lookup?.foundryItems?.length ?? lookup?.rows.filter((row) => row.status === "active" && row.pack && row.slug).length ?? 0, formulaCount: lookup?.formulas?.filter((row) => row.status === "active" && row.pack && row.slug).length ?? 0 };
}
