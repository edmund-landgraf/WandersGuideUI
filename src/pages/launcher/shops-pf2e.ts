import type { Item, Trait } from '@schemas/content';

type Pf2eEquipmentRow = {
  EquipmentId: number;
  AonUrl?: string | null;
  Name: string;
  Level: number;
  Rarity: string | null;
  Traits: string | null;
  ItemCategory: string | null;
  ItemSubcategory: string | null;
  SourceBook: string | null;
  Summary: string | null;
  PriceCp: number | null;
  BulkText: string | null;
  WeaponGroup: string | null;
  WeaponCategory: string | null;
  WeaponType: string | null;
  ArmorCategory: string | null;
  ArmorGroupText: string | null;
  Hands: string | null;
  AmmunitionText: string | null;
};

type Pf2eEquipmentResponse = {
  rows: Pf2eEquipmentRow[];
  total: number;
  limit: number;
  offset: number;
};

export const PF2E_SHOP_SOURCE = 'pf2e-local';

function apiBase() {
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (host === 'localhost' || host === '127.0.0.1' || import.meta.env.DEV) return 'http://127.0.0.1:3333';
  return 'https://pf2.unwhelm.online';
}

function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function sourceId(sourceBook: string | null) {
  let hash = 0;
  for (const char of sourceBook ?? 'PF2E') hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return -Math.max(1, Math.abs(hash));
}

function traitId(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return -100000 - Math.max(1, Math.abs(hash));
}

function itemGroup(row: Pf2eEquipmentRow): Item['group'] {
  const category = normalize(row.ItemCategory);
  const type = normalize(row.WeaponType);
  if (category.includes('rune')) return 'RUNE';
  if (category.includes('armor') || row.ArmorCategory) return 'ARMOR';
  if (category.includes('shield')) return 'SHIELD';
  if (category.includes('weapon') || row.WeaponCategory || type.includes('weapon')) return 'WEAPON';
  if (category.includes('material')) return 'MATERIAL';
  return 'GENERAL';
}

function price(priceCp: number | null) {
  if (priceCp == null) return null;
  let remaining = Math.max(0, Math.round(priceCp));
  const pp = Math.floor(remaining / 1000);
  remaining %= 1000;
  const gp = Math.floor(remaining / 100);
  remaining %= 100;
  const sp = Math.floor(remaining / 10);
  const cp = remaining % 10;
  return { pp, gp, sp, cp };
}

function parseTraits(value: string | null | undefined) {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function mapRow(row: Pf2eEquipmentRow): Item {
  const names = parseTraits(row.Traits);
  const group = itemGroup(row);
  return {
    id: -Math.abs(row.EquipmentId),
    created_at: new Date(0).toISOString(),
    name: row.Name,
    price: price(row.PriceCp),
    bulk: row.BulkText,
    level: row.Level,
    rarity: normalize(row.Rarity).toUpperCase() as Item['rarity'],
    availability: null,
    traits: names.map(traitId),
    description: row.Summary ?? '',
    group,
    hands: row.Hands,
    size: 'MEDIUM',
    craft_requirements: null,
    usage: [row.ItemSubcategory, row.AmmunitionText].filter(Boolean).join(' '),
    meta_data: {
      category: normalize(row.ItemCategory),
      group: normalize(row.WeaponGroup || row.ArmorGroupText),
      pf2e_traits: row.Traits ?? '',
      shop_source: PF2E_SHOP_SOURCE,
      aon_url: row.AonUrl?.trim() || undefined,
      unselectable: false,
    },
    operations: null,
    content_source_id: sourceId(row.SourceBook),
    version: 'pf2e-local',
  } as unknown as Item;
}

export function isPf2eShopItem(item: Item) {
  return (item.meta_data as (Item['meta_data'] & { shop_source?: string }) | null | undefined)?.shop_source === PF2E_SHOP_SOURCE;
}

/** Archives page with a numeric ID. Local EquipmentId is not an AoN id. */
export function shopAonHref(item: Item, index?: ReadonlyMap<string, string>): string | undefined {
  return ownAonUrl(item) ?? index?.get(shopAonKey(item));
}

export function shopAonKey(item: { name: string; level: number }) {
  return `${item.name.trim().toLowerCase()}|${item.level}`;
}

export function shopAonIndex(items: Item[]) {
  const index = new Map<string, string>();
  for (const item of items) {
    const href = ownAonUrl(item);
    if (href) index.set(shopAonKey(item), href);
  }
  return index;
}

function ownAonUrl(item: Item) {
  const stored = (item.meta_data as { aon_url?: string } | null | undefined)?.aon_url?.trim();
  if (!stored || /Search\.aspx/i.test(stored) || !/[?&]ID=\d+/i.test(stored)) return undefined;
  return stored;
}

export function mergeShopCatalog(wanderersGuide: Item[], pf2e: Item[]) {
  const keys = new Set(
    wanderersGuide.map((item) => `${normalize(item.name)}|${item.level}|${item.rarity}|${item.group}`),
  );
  return [
    ...wanderersGuide,
    ...pf2e.filter((item) => {
      const key = `${normalize(item.name)}|${item.level}|${item.rarity}|${item.group}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    }),
  ];
}

export function pf2eTraits(items: Item[]): Trait[] {
  const names = new Map<number, string>();
  for (const item of items) {
    const metadata = item.meta_data as (Item['meta_data'] & { pf2e_traits?: string }) | null | undefined;
    for (const id of item.traits ?? []) {
      const name = parseTraits(metadata?.pf2e_traits).find(
        (trait) => traitId(trait) === id,
      );
      if (name) names.set(id, name);
    }
  }
  return [...names].map(([id, name]) => ({
    id,
    name,
    created_at: new Date(0).toISOString(),
    description: '',
    content_source_id: 0,
    uuid: id,
    search_tsv: null,
  })) as unknown as Trait[];
}

export async function fetchPf2eShopCatalog() {
  const first = await fetch(`${apiBase()}/api/equipment?limit=500&offset=0`);
  if (!first.ok) throw new Error(`PF2E equipment API returned ${first.status}`);
  const firstPage = (await first.json()) as Pf2eEquipmentResponse;
  const pageCount = Math.ceil(firstPage.total / firstPage.limit);
  const pages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => {
      const offset = (index + 1) * firstPage.limit;
      return fetch(`${apiBase()}/api/equipment?limit=${firstPage.limit}&offset=${offset}`).then(async (response) => {
        if (!response.ok) throw new Error(`PF2E equipment API returned ${response.status}`);
        return (await response.json()) as Pf2eEquipmentResponse;
      });
    }),
  );
  return [...firstPage.rows, ...pages.flatMap((page) => page.rows)].map(mapRow);
}
