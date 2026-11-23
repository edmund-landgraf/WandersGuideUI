import type { Item, Trait } from '@schemas/content';
import { formatShopPrice } from './shops-generate';

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

/** Coin price for an exact name and level. A blank catalog price is omitted. */
export function shopPriceIndex(items: Item[]) {
  const index = new Map<string, string>();
  for (const item of items) {
    const label = formatShopPrice(item.price);
    if (label === '—') continue;
    index.set(shopAonKey(item), label);
  }
  return index;
}

export function fillMissingShopPrices<T extends { name: string; level: number; price: string }>(
  stock: T[],
  index: ReadonlyMap<string, string>,
): T[] {
  return stock.map((row) => {
    if (row.price && row.price !== '—') return row;
    const price = index.get(shopAonKey(row));
    return price ? { ...row, price } : row;
  });
}

/**
 * A direct Archives item URL must identify a specific entry.
 * A search-results URL is not an item link and must never be labeled "AoN".
 */
export function validShopAonUrl(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    if (url.hostname === '2e.aonprd.com'
      && /^\/(?:Equipment|Weapons|Armor|Shields)\.aspx$/i.test(url.pathname)
      && /^\d+$/.test(url.searchParams.get('ID') ?? '')) return url.href;
    if (url.hostname === '2e.aonsrd.com'
      && /^\/(?:treasure|equipment\/[a-z-]+)\/\d+-[a-z0-9-]+\/?$/i.test(url.pathname)) return url.href;
  } catch {
    // Invalid, unsupported, or non-Archives URLs are never labeled AoN.
  }
  return undefined;
}

/** Older published shops can be resolved by exact name + level, not by search. */
export function fillMissingShopAon<T extends { name: string; level: number; aon?: string }>(
  stock: T[],
  index: ReadonlyMap<string, string>,
): (T & { aon?: string })[] {
  return stock.map((row) => {
    const direct = validShopAonUrl(row.aon) ?? validShopAonUrl(index.get(shopAonKey(row)));
    return row.aon === direct ? row : { ...row, aon: direct };
  });
}

let catalogPromise: Promise<Item[]> | null = null;

function loadPf2eShopCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetchPf2eShopCatalog().catch((cause: unknown) => {
      catalogPromise = null;
      throw cause;
    });
  }
  return catalogPromise;
}

export function loadShopAonIndex() {
  return loadPf2eShopCatalog().then(shopAonIndex);
}

export function loadShopPriceIndex() {
  return loadPf2eShopCatalog().then(shopPriceIndex);
}

function ownAonUrl(item: Item) {
  const metadata = item.meta_data as { aon_url?: string; source?: { url?: string } } | null | undefined;
  return validShopAonUrl(metadata?.aon_url) ?? validShopAonUrl(metadata?.source?.url);
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

/** Price printed in the stat block for this exact entry, including a parenthetical variant. */
export function priceFromStatBlock(name: string, text: string) {
  const decoded = text.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  const titles = [...decoded.matchAll(/<title\b[^>]*>\s*([\s\S]*?)\s+Source\b/gi)];
  const wanted = name.trim().toLowerCase().replace(/\s+/g, ' ');
  for (let index = 0; index < titles.length; index += 1) {
    const title = (titles[index][1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (title !== wanted) continue;
    const start = (titles[index].index ?? 0) + titles[index][0].length;
    const end = titles[index + 1]?.index ?? decoded.length;
    const price = decoded.slice(start, end).match(/\bPrice\s+([0-9][0-9,]*(?:\s+(?:pp|gp|sp|cp))+(?:\s+[0-9][0-9,]*(?:\s+(?:pp|gp|sp|cp))+)*)/i);
    if (!price) return null;
    return price[1].replace(/,/g, '').replace(/\s+/g, ' ').trim();
  }
  return null;
}

const equipmentText = new Map<number, Promise<string>>();

/** Detail text. The list endpoint only returns a summary that ends mid-sentence. */
export function fetchPf2eEquipmentText(equipmentId: number) {
  const cached = equipmentText.get(equipmentId);
  if (cached) return cached;
  const pending = fetch(`${apiBase()}/api/equipment/${equipmentId}`).then(async (response) => {
    if (!response.ok) return '';
    const row = (await response.json()) as { RawText?: string | null; RawMD?: string | null; Summary?: string | null };
    return (row.RawText || row.RawMD || row.Summary || '').trim();
  }).catch(() => '');
  equipmentText.set(equipmentId, pending);
  return pending;
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
