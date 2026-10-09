import type { Item, Trait } from '@schemas/content';

export const SHOP_PRESETS = [
  { id: 'general', label: 'General store' },
  { id: 'magic', label: 'Magic shop' },
  { id: 'alchemical', label: 'Alchemy shop' },
  { id: 'ammo', label: 'Ammunition shop' },
  { id: 'gadget', label: 'Gadget shop' },
  { id: 'armorer', label: 'Armor shop' },
  { id: 'blacksmith', label: 'Blacksmith' },
  { id: 'gunsmith', label: 'Gunsmith' },
  { id: 'jeweler', label: 'Jeweller' },
  { id: 'lost', label: 'Lost goods' },
  { id: 'tailor', label: 'Magical tailor' },
  { id: 'potion', label: 'Potion shop' },
  { id: 'materials', label: 'Raw materials' },
  { id: 'tattoo', label: 'Tattoo parlor' },
  { id: 'runes', label: 'Runes' },
] as const;

export type ShopPresetId = (typeof SHOP_PRESETS)[number]['id'];

export const SETTLEMENT_LEVELS = [
  { id: 'village', label: 'Village (2)', level: 2 },
  { id: 'town', label: 'Town (4)', level: 4 },
  { id: 'city', label: 'City (7)', level: 7 },
  { id: 'metro10', label: 'Metropolis (10)', level: 10 },
  { id: 'metro13', label: 'Metropolis (13)', level: 13 },
  { id: 'metro16', label: 'Metropolis (16)', level: 16 },
  { id: 'metro20', label: 'Metropolis (20)', level: 20 },
] as const;

export type SettlementId = (typeof SETTLEMENT_LEVELS)[number]['id'];

export const SHOP_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'] as const;

export type ShopRarity = (typeof SHOP_RARITIES)[number];

/** Village-store mix from the legacy generator. Unique stays at 0 until a shopkeeper checks it. */
export const RARITY_WEIGHTS: Record<ShopRarity, number> = {
  COMMON: 81,
  UNCOMMON: 15,
  RARE: 3,
  UNIQUE: 0,
};

export function raritiesForSettlement(_id: SettlementId): ShopRarity[] {
  return SHOP_RARITIES.filter((rarity) => RARITY_WEIGHTS[rarity] > 0);
}

/** Checked rarities replace the weighted mix. None checked keeps common, uncommon, and rare. */
export function activeShopRarities(selected: readonly ShopRarity[], settlement: SettlementId): ShopRarity[] {
  return selected.length > 0 ? [...selected] : raritiesForSettlement(settlement);
}

export const STOCK_COUNT = 15;

/** Armor, blacksmith, and gunsmith use the full 0–20 catalog. They are not capped by settlement. */
export const WIDE_CATALOG_PRESETS = new Set<ShopPresetId>(['armorer', 'blacksmith', 'gunsmith']);

/**
 * Exact content-source titles. "(in progress)" and remaster names do not match, so
 * Advanced Player's Guide and Secrets of Magic stay unchecked. Runes live mainly in
 * GM Core, tattoos and most potions in Treasure Vault; those books start unchecked.
 */
export const DEFAULT_SHOP_BOOKS = [
  'Core Rulebook',
  "Advanced Player's Guide",
  'Gamemastery Guide',
  'Guns & Gears',
  'Secrets of Magic',
] as const;

export function shopCeiling(preset: ShopPresetId, settlement: SettlementId) {
  if (WIDE_CATALOG_PRESETS.has(preset)) return 20;
  return SETTLEMENT_LEVELS.find((row) => row.id === settlement)?.level ?? 2;
}

/** One band through town. City and up split the 0–ceiling span into low, then mid, then high. */
export function levelProfiles(ceiling: number) {
  const max = Math.max(0, ceiling);
  if (max <= 4) return [{ min: 0, max, weight: 1 }];
  if (max <= 7) return [
    { min: 0, max: 3, weight: 2 },
    { min: 4, max, weight: 1 },
  ];
  const lowEnd = Math.max(1, Math.round(max * 0.4));
  const midEnd = Math.max(lowEnd + 1, Math.round(max * 0.7));
  return [
    { min: 0, max: lowEnd, weight: 3 },
    { min: lowEnd + 1, max: midEnd, weight: 2 },
    { min: midEnd + 1, max, weight: 1 },
  ];
}

function traitNames(item: Item, names: Map<number, string>) {
  return (item.traits ?? []).map((id) => names.get(id) ?? '').filter(Boolean);
}

function hasLabel(labels: string[], needle: string) {
  return labels.some((name) => name.includes(needle));
}

function usageText(item: Item) {
  return (item.usage ?? '').toLowerCase();
}

function weaponGroup(item: Item) {
  return String(item.meta_data?.group ?? '').toLowerCase();
}

function isAmmunition(item: Item, labels: string[]) {
  if (hasLabel(labels, 'ammunition')) return true;
  const usage = usageText(item);
  if (usage.includes('ammo') || usage.includes('ammunition')) return true;
  const category = String(item.meta_data?.category ?? '').toLowerCase();
  if (category === 'ammo' || category === 'ammunition') return true;
  const stack = (item.meta_data?.foundry?.stack_group ?? '').toLowerCase();
  if (stack.includes('arrow') || stack.includes('bolt') || stack.includes('sling') || stack.includes('ammo')) return true;
  const tags = item.meta_data?.foundry?.tags;
  const tagList = Array.isArray(tags) ? tags : Object.values(tags ?? {});
  return tagList.some((tag) => String(tag).toLowerCase().includes('ammo'));
}

const FIREARM_GROUPS = new Set(['firearm', 'crossbow']);
const BLACKSMITH_GROUPS = new Set(['axe', 'brawling', 'club', 'flail', 'hammer', 'knife', 'pick', 'polearm', 'spear', 'sword', 'shield']);
const JEWELRY_USAGE = ['circlet', 'necklace', 'ring', 'eyepiece', 'goggle', 'amulet', 'bracelet', 'crown', 'tiara', 'spellheart'];
const TAILOR_USAGE = ['cloak', 'boot', 'glove', 'belt', 'hat', 'hood', 'robe', 'garment', 'bracer', 'shoe', 'slippers'];

function matchesPreset(item: Item, preset: ShopPresetId, names: Map<number, string>) {
  const labels = traitNames(item, names);
  const usage = usageText(item);
  const group = weaponGroup(item);
  if (preset === 'general') return item.group !== 'RUNE';
  if (preset === 'magic') return item.group !== 'RUNE' && hasLabel(labels, 'magical');
  if (preset === 'alchemical') return hasLabel(labels, 'alchemical');
  if (preset === 'ammo') return isAmmunition(item, labels);
  if (preset === 'gadget') return hasLabel(labels, 'gadget');
  if (preset === 'armorer') return item.group === 'ARMOR' || item.group === 'SHIELD';
  if (preset === 'blacksmith') {
    if (item.group !== 'WEAPON') return false;
    if (FIREARM_GROUPS.has(group)) return false;
    return BLACKSMITH_GROUPS.has(group) || group === '';
  }
  if (preset === 'gunsmith') return isAmmunition(item, labels) || FIREARM_GROUPS.has(group) || hasLabel(labels, 'firearm');
  if (preset === 'jeweler') return JEWELRY_USAGE.some((part) => usage.includes(part)) || hasLabel(labels, 'spellheart');
  if (preset === 'lost') return item.group !== 'RUNE' && !isAmmunition(item, labels);
  if (preset === 'tailor') return TAILOR_USAGE.some((part) => usage.includes(part));
  if (preset === 'potion') return hasLabel(labels, 'potion') || hasLabel(labels, 'oil');
  // Catalog trait is "Precious", not "precious material". Most chunks are GENERAL.
  if (preset === 'materials') return item.group === 'MATERIAL' || hasLabel(labels, 'precious material');
  if (preset === 'tattoo') return hasLabel(labels, 'tattoo') || usage.includes('tattoo');
  return item.group === 'RUNE';
}

function sellable(item: Item) {
  return item.meta_data?.deprecated !== true && item.meta_data?.unselectable !== true;
}

const CONSUMABLE_TRAITS = ['consumable', 'potion', 'elixir', 'oil', 'ammunition', 'scroll', 'snare', 'catalyst'];

function isConsumable(item: Item, labels: string[]) {
  if ((item.meta_data?.quantity ?? 0) > 1) return true;
  return CONSUMABLE_TRAITS.some((name) => hasLabel(labels, name));
}

function categoryWeight(item: Item, preset: ShopPresetId) {
  if (preset !== 'general' && preset !== 'lost') return 1;
  if (item.group === 'ARMOR' || item.group === 'SHIELD' || item.group === 'WEAPON') return 5;
  if (item.group === 'MATERIAL') return 1;
  return 10;
}

function pickOne<T>(rows: { value: T; weight: number }[], rng: () => number) {
  const live = rows.filter((row) => row.weight > 0);
  if (live.length === 0) return null;
  const total = live.reduce((sum, row) => sum + row.weight, 0);
  let roll = rng() * total;
  for (const row of live) {
    roll -= row.weight;
    if (roll <= 0) return row.value;
  }
  return live[live.length - 1].value;
}

function rollInt(rng: () => number, min: number, max: number) {
  return min + Math.floor(rng() * (max - min + 1));
}

export type ShopStockItem = Item & {
  shopKey: string;
  shopQuantity: number;
  packSize: number;
};

const FORMULA_COPPER = [
  50, 100, 200, 300, 500, 800, 1300, 1800, 2500, 3500,
  5000, 7000, 10000, 15000, 22500, 32500, 50000, 75000, 120000, 200000, 350000,
];

const FORMULA_CHANCE = 15;

export function formulaCopper(level: number) {
  const index = Math.max(0, Math.min(FORMULA_COPPER.length - 1, level));
  return FORMULA_COPPER[index];
}

function copperPrice(copper: number): Item['price'] {
  const pp = Math.floor(copper / 1000);
  const gp = Math.floor((copper % 1000) / 100);
  const sp = Math.floor((copper % 100) / 10);
  const cp = copper % 10;
  return { pp, gp, sp, cp };
}

export function isShopFormula(item: Item) {
  return item.name.startsWith('Formula: ') || item.name.toLowerCase().includes('formula');
}

export function shopLineQuantity(item: ShopStockItem) {
  return Math.max(1, item.shopQuantity) * Math.max(1, item.packSize);
}

function inBand(level: number, ceiling: number) {
  return levelProfiles(ceiling).some((band) => level >= band.min && level <= band.max);
}

export function listShopPool(
  items: Item[],
  traits: Trait[],
  preset: ShopPresetId,
  level: number,
  sourceIds?: ReadonlySet<number>,
  rarities?: ReadonlySet<string>,
) {
  const names = new Map(traits.map((trait) => [trait.id, trait.name.toLowerCase()]));
  const allowed = rarities ?? new Set(raritiesForSettlement('village'));
  return items.filter((item) => {
    if (!sellable(item) || !matchesPreset(item, preset, names)) return false;
    if (sourceIds !== undefined && !sourceIds.has(item.content_source_id)) return false;
    if (!allowed.has(item.rarity)) return false;
    return inBand(item.level, level);
  });
}

function stockQuantity(item: Item, labels: string[], rng: () => number) {
  const consumable = isConsumable(item, labels);
  let quantity = consumable ? rollInt(rng, 1, 8) : rollInt(rng, 1, 3);
  if (item.rarity === 'UNCOMMON') quantity = Math.floor(quantity * 0.625);
  else if (item.rarity === 'RARE') quantity = Math.floor(quantity * 0.525);
  if (quantity <= 0 || item.rarity === 'UNIQUE') quantity = 1;
  return quantity;
}

function toLine(item: Item, labels: string[], rng: () => number, formula: boolean): ShopStockItem {
  const packSize = Math.max(1, Number(item.meta_data?.quantity ?? 1) || 1);
  const shopQuantity = stockQuantity(item, labels, rng);
  if (!formula) {
    return { ...item, shopKey: String(item.id), shopQuantity, packSize };
  }
  const priced = item.level <= 20 ? { ...item, price: copperPrice(formulaCopper(item.level)) } : item;
  const name = priced.name.startsWith('Formula: ') ? priced.name : `Formula: ${priced.name}`;
  return {
    ...priced,
    name,
    bulk: 'L',
    shopKey: `${item.id}:formula`,
    shopQuantity,
    packSize,
  };
}

export function stockShop(
  items: Item[],
  traits: Trait[],
  preset: ShopPresetId,
  level: number,
  rng: () => number = Math.random,
  sourceIds?: ReadonlySet<number>,
  avoidIds: ReadonlySet<number> = new Set(),
  count = STOCK_COUNT,
  rarities?: ReadonlySet<string>,
) {
  const names = new Map(traits.map((trait) => [trait.id, trait.name.toLowerCase()]));
  const allowed = [...(rarities ?? new Set<string>(raritiesForSettlement('village')))] as ShopRarity[];
  const ceiling = Math.max(0, level);
  const bands = levelProfiles(ceiling);
  const eligible = items.filter((item) => {
    if (!sellable(item) || !matchesPreset(item, preset, names)) return false;
    if (sourceIds !== undefined && !sourceIds.has(item.content_source_id)) return false;
    if (!allowed.includes(item.rarity as ShopRarity)) return false;
    return inBand(item.level, ceiling);
  });
  const size = Math.max(0, Math.min(100, Math.round(count)));
  const picked: ShopStockItem[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  while (picked.length < size && attempts < size * 12 && eligible.length > 0) {
    attempts += 1;
    const band = pickOne(bands.map((row) => ({ value: row, weight: row.weight })), rng);
    if (!band) break;
    const rarity = pickOne(
      allowed.map((row) => ({ value: row, weight: rarities ? 1 : RARITY_WEIGHTS[row] ?? 0 })),
      rng,
    );
    if (!rarity) break;
    const choices = eligible.filter((item) => {
      if (item.level < band.min || item.level > band.max) return false;
      if (item.rarity !== rarity) return false;
      return !seen.has(String(item.id));
    });
    if (choices.length === 0) continue;
    const item = pickOne(
      choices.map((row) => ({
        value: row,
        weight: categoryWeight(row, preset) * (avoidIds.has(row.id) ? 0.08 : 1),
      })),
      rng,
    );
    if (!item) continue;
    const labels = traitNames(item, names);
    const formula = item.rarity !== 'UNIQUE' && rng() * 100 <= FORMULA_CHANCE;
    const line = toLine(item, labels, rng, formula);
    if (seen.has(line.shopKey)) continue;
    seen.add(String(item.id));
    seen.add(line.shopKey);
    picked.push(line);
  }
  return picked.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

export function asShopLine(item: Item): ShopStockItem {
  if ('shopKey' in item && 'shopQuantity' in item) return item as ShopStockItem;
  return {
    ...item,
    shopKey: String(item.id),
    shopQuantity: 1,
    packSize: Math.max(1, Number(item.meta_data?.quantity ?? 1) || 1),
  };
}

const COPPER: Record<'cp' | 'sp' | 'gp' | 'pp', number> = { cp: 1, sp: 10, gp: 100, pp: 1000 };

export function formatShopPrice(price: Item['price'], markup = 0) {
  if (!price) return '—';
  const coins = ['pp', 'gp', 'sp', 'cp'] as const;
  const copper = coins.reduce((sum, coin) => sum + Number(price[coin] ?? 0) * COPPER[coin], 0);
  const adjusted = Math.max(0, Math.round(copper * (1 + markup / 100)));
  if (adjusted <= 0) return '—';
  let left = adjusted;
  const parts = coins
    .map((coin) => {
      const amount = Math.floor(left / COPPER[coin]);
      left -= amount * COPPER[coin];
      return amount > 0 ? `${amount} ${coin}` : '';
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}

export function formatShopOffer(item: ShopStockItem, markup = 0) {
  const pack = Math.max(1, item.packSize);
  const base = formatShopPrice(item.price, markup);
  if (base === '—') return base;
  const packed = pack > 1 ? `${base} for ${pack}` : base;
  return isShopFormula(item) && item.rarity !== 'COMMON' ? `${packed}*` : packed;
}
