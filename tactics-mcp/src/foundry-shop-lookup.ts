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

export function searchFoundryShopItems(query = "", limit = 50, formulas = false) {
  const lookup = load();
  if (!lookup) return { loaded: false, items: [] as FoundryShopLookupRow[] };
  const needle = query.trim().toLowerCase();
  const rows = (formulas ? lookup.formulas ?? [] : lookup.foundryItems ?? lookup.rows)
    .filter((row) => formulas ? row.status === "active" && row.pack && row.slug : row.pack === "pf2e.equipment-srd" && row.slug)
    .filter((row) => !needle || `${row.name ?? ""} ${row.slug} ${row.pack}`.toLowerCase().includes(needle))
    .slice(0, Math.max(1, Math.min(200, Math.trunc(limit))));
  return { loaded: true, source: formulas ? "formulas" : "pf2e.equipment-srd", items: rows };
}

export function foundryShopLookupStatus() {
  const lookup = load();
  return { loaded: Boolean(lookup), itemCount: lookup?.foundryItems?.length ?? lookup?.rows.filter((row) => row.status === "active" && row.pack && row.slug).length ?? 0, formulaCount: lookup?.formulas?.filter((row) => row.status === "active" && row.pack && row.slug).length ?? 0 };
}
