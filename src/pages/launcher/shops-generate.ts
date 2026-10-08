import type { Item, Trait } from '@schemas/content';

export const SHOP_PRESETS = [
  { id: 'general', label: 'General goods' },
  { id: 'arms', label: 'Arms and armor' },
  { id: 'runes', label: 'Runes' },
  { id: 'alchemical', label: 'Alchemical' },
  { id: 'magic', label: 'Magic gear' },
] as const;

export type ShopPresetId = (typeof SHOP_PRESETS)[number]['id'];

const RARITY_RANK: Record<string, number> = {
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  UNIQUE: 3,
};

const STOCK_COUNT = 16;

function traitNames(item: Item, names: Map<number, string>) {
  return (item.traits ?? []).map((id) => names.get(id) ?? '').filter(Boolean);
}

function matchesPreset(item: Item, preset: ShopPresetId, names: Map<number, string>) {
  const labels = traitNames(item, names);
  if (preset === 'general') return item.group === 'GENERAL';
  if (preset === 'arms') return item.group === 'WEAPON' || item.group === 'ARMOR' || item.group === 'SHIELD';
  if (preset === 'runes') return item.group === 'RUNE';
  if (preset === 'alchemical') return labels.some((name) => name.includes('alchemical'));
  return item.group !== 'RUNE' && labels.some((name) => name.includes('magical'));
}

function sellable(item: Item) {
  return item.meta_data?.deprecated !== true && item.meta_data?.unselectable !== true;
}

function shuffle<T>(rows: T[], rng: () => number) {
  const copy = [...rows];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

export function stockShop(items: Item[], traits: Trait[], preset: ShopPresetId, level: number, rng: () => number = Math.random) {
  const names = new Map(traits.map((trait) => [trait.id, trait.name.toLowerCase()]));
  const matching = items.filter((item) => sellable(item) && matchesPreset(item, preset, names));
  const floor = Math.max(0, level - 2);
  const band = matching.filter((item) => item.level >= floor && item.level <= level);
  const pool = band.length > 0 ? band : matching.filter((item) => item.level <= level);
  const source = pool.length > 0 ? pool : matching;
  const byRarity = [...source].sort((a, b) => (RARITY_RANK[a.rarity] ?? 9) - (RARITY_RANK[b.rarity] ?? 9));
  const picked: Item[] = [];
  const ranks = [...new Set(byRarity.map((item) => RARITY_RANK[item.rarity] ?? 9))];
  for (const rank of ranks) {
    if (picked.length >= STOCK_COUNT) break;
    picked.push(...shuffle(byRarity.filter((item) => (RARITY_RANK[item.rarity] ?? 9) === rank), rng));
  }
  return picked.slice(0, STOCK_COUNT).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

export function formatShopPrice(price: Item['price']) {
  if (!price) return '—';
  const parts = (['pp', 'gp', 'sp', 'cp'] as const)
    .map((coin) => {
      const amount = Number(price[coin] ?? 0);
      return amount > 0 ? `${amount} ${coin}` : '';
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}
