import { describe, expect, it } from 'vitest';
import type { Item, Trait } from '@schemas/content';
import { activeShopRarities, formatShopPrice, raritiesForSettlement, STOCK_COUNT, stockShop } from './shops-generate';

function item(partial: Partial<Item> & Pick<Item, 'id' | 'name' | 'group' | 'level' | 'rarity'>): Item {
  return { traits: [], meta_data: {}, price: { gp: 1 }, bulk: null, ...partial } as Item;
}

const traits = [
  { id: 1, name: 'Alchemical' },
  { id: 2, name: 'Magical' },
  { id: 3, name: 'Ammunition' },
  { id: 4, name: 'Gadget' },
  { id: 5, name: 'Potion' },
  { id: 6, name: 'Tattoo' },
  { id: 7, name: 'Oil' },
] as Trait[];

describe('stockShop', () => {
  const catalog = [
    item({ id: 1, name: 'Rope', group: 'GENERAL', level: 0, rarity: 'COMMON' }),
    item({ id: 2, name: 'Longsword', group: 'WEAPON', level: 1, rarity: 'COMMON' }),
    item({ id: 3, name: 'Elixir', group: 'GENERAL', level: 3, rarity: 'COMMON', traits: [1] }),
    item({ id: 4, name: 'Wand', group: 'GENERAL', level: 4, rarity: 'UNCOMMON', traits: [2] }),
    item({ id: 5, name: 'Potency', group: 'RUNE', level: 4, rarity: 'COMMON', traits: [2] }),
    item({ id: 6, name: 'Hidden', group: 'GENERAL', level: 1, rarity: 'COMMON', meta_data: { unselectable: true } }),
    item({ id: 7, name: 'Arrow', group: 'GENERAL', level: 0, rarity: 'COMMON', traits: [3] }),
    item({
      id: 8,
      name: 'Bolts',
      group: 'GENERAL',
      level: 0,
      rarity: 'COMMON',
      meta_data: { foundry: { stack_group: 'bolts' } },
    }),
    item({ id: 9, name: 'Clockwork Spy', group: 'GENERAL', level: 1, rarity: 'UNCOMMON', traits: [4] }),
    item({ id: 13, name: 'Breastplate', group: 'ARMOR', level: 1, rarity: 'COMMON' }),
    item({ id: 14, name: 'Hand Cannon', group: 'WEAPON', level: 1, rarity: 'UNCOMMON', meta_data: { group: 'firearm' } }),
    item({ id: 15, name: 'Gold Ring', group: 'GENERAL', level: 1, rarity: 'COMMON', usage: 'worn ring' }),
    item({ id: 16, name: 'Healing Potion', group: 'GENERAL', level: 1, rarity: 'COMMON', traits: [5] }),
    item({ id: 17, name: 'Winter Cloak', group: 'GENERAL', level: 1, rarity: 'COMMON', usage: 'worn cloak' }),
    item({ id: 18, name: 'Eye Tattoo', group: 'GENERAL', level: 1, rarity: 'UNCOMMON', traits: [6] }),
    item({ id: 19, name: 'Adamantine Chunk', group: 'MATERIAL', level: 8, rarity: 'UNCOMMON' }),
  ];

  it('stocks every common good from level 0 through the shop level, including a little armor and weapons', () => {
    const stock = stockShop(catalog, traits, 'general', 1, () => 0);
    expect(stock.map((row) => row.name)).toEqual([
      'Formula: Arrow',
      'Formula: Bolts',
      'Formula: Rope',
      'Formula: Breastplate',
      'Formula: Gold Ring',
      'Formula: Healing Potion',
      'Formula: Longsword',
      'Formula: Winter Cloak',
    ]);
    expect(stock.every((row) => row.shopQuantity >= 1)).toBe(true);
  });

  it('finds ammunition by trait or Foundry stack group, not by the retired AMMUNITION item group', () => {
    expect(stockShop(catalog, traits, 'ammo', 1, () => 0).map((row) => row.name)).toEqual([
      'Formula: Arrow',
      'Formula: Bolts',
    ]);
  });

  it('weights rarity and lets a checked set replace that mix', () => {
    expect(raritiesForSettlement('village')).toEqual(['COMMON', 'UNCOMMON', 'RARE']);
    expect(activeShopRarities([], 'village')).toEqual(['COMMON', 'UNCOMMON', 'RARE']);
    expect(activeShopRarities([], 'town')).toEqual(['COMMON', 'UNCOMMON', 'RARE']);
    expect(activeShopRarities(['RARE'], 'village')).toEqual(['RARE']);
    expect(raritiesForSettlement('metro20')).toEqual(['COMMON', 'UNCOMMON', 'RARE']);
    const commonOnly = new Set(['COMMON']);
    expect(stockShop(catalog, traits, 'gadget', 2, () => 0, undefined, new Set(), 16, commonOnly)).toEqual([]);
    expect(stockShop(catalog, traits, 'general', 2, () => 0, undefined, new Set(), 16, new Set(['UNCOMMON'])).map((row) => row.name)).toEqual([
      'Formula: Clockwork Spy',
      'Formula: Eye Tattoo',
      'Formula: Hand Cannon',
    ]);
  });

  it('finds gadgets by the Gadget trait after the GADGET item group was folded into GENERAL', () => {
    expect(stockShop(catalog, traits, 'gadget', 2, () => 0, undefined, new Set(), 16, new Set(['UNCOMMON'])).map((row) => row.name)).toEqual([
      'Formula: Clockwork Spy',
    ]);
  });

  it('matches alchemical and magical traits, and keeps runes out of magic gear', () => {
    expect(stockShop(catalog, traits, 'alchemical', 5, () => 0, undefined, new Set(), 2).map((row) => row.name)).toEqual([
      'Formula: Elixir',
    ]);
    expect(stockShop(catalog, traits, 'magic', 4, () => 0, undefined, new Set(), 16, new Set(['UNCOMMON'])).map((row) => row.name)).toEqual(['Formula: Wand']);
    expect(stockShop(catalog, traits, 'runes', 4, () => 0).map((row) => row.name)).toEqual(['Formula: Potency']);
  });

  it('matches the remaining legacy counters by group, usage, or trait', () => {
    expect(stockShop(catalog, traits, 'armorer', 2, () => 0).map((row) => row.name)).toEqual(['Formula: Breastplate']);
    expect(stockShop(catalog, traits, 'blacksmith', 2, () => 0).map((row) => row.name)).toEqual(['Formula: Longsword']);
    expect(stockShop(catalog, traits, 'gunsmith', 2, () => 0).map((row) => row.name)).toEqual(['Formula: Arrow', 'Formula: Bolts']);
    expect(stockShop(catalog, traits, 'jeweler', 2, () => 0).map((row) => row.name)).toEqual(['Formula: Gold Ring']);
    expect(stockShop(catalog, traits, 'potion', 2, () => 0).map((row) => row.name)).toEqual(['Formula: Healing Potion']);
    expect(stockShop(catalog, traits, 'tailor', 2, () => 0).map((row) => row.name)).toEqual(['Formula: Winter Cloak']);
    expect(stockShop(catalog, traits, 'tattoo', 2, () => 0, undefined, new Set(), 16, new Set(['UNCOMMON'])).map((row) => row.name)).toEqual(['Formula: Eye Tattoo']);
    const highBand = () => 0.9;
    expect(stockShop(catalog, traits, 'materials', 9, highBand, undefined, new Set(), 16, new Set(['UNCOMMON'])).map((row) => row.name)).toEqual([
      'Adamantine Chunk',
    ]);
    expect(stockShop(catalog, traits, 'lost', 2, () => 0).map((row) => row.name)).toEqual([
      'Formula: Rope',
      'Formula: Breastplate',
      'Formula: Gold Ring',
      'Formula: Healing Potion',
      'Formula: Longsword',
      'Formula: Winter Cloak',
    ]);
    expect(stockShop(catalog, traits, 'lost', 2, () => 0, undefined, new Set(), 16, new Set(['UNCOMMON'])).map((row) => row.name)).toEqual([
      'Formula: Clockwork Spy',
      'Formula: Eye Tattoo',
      'Formula: Hand Cannon',
    ]);
  });

  it('formats coin prices', () => {
    expect(formatShopPrice({ gp: 2, sp: 5 })).toBe('2 gp 5 sp');
    expect(formatShopPrice(null)).toBe('—');
    expect(formatShopPrice({ gp: 4 }, 50)).toBe('6 gp');
    expect(formatShopPrice({ gp: 4 }, -100)).toBe('—');
    expect(stockShop(catalog, traits, 'general', 1, () => 0, undefined, new Set(), 2)).toHaveLength(2);
  });

  it('keeps a village counter from level 0 and lets a town reach the settlement ceiling', () => {
    const mixed = [
      item({ id: 10, name: 'Torch', group: 'GENERAL', level: 0, rarity: 'COMMON' }),
      item({ id: 11, name: 'Lantern', group: 'GENERAL', level: 3, rarity: 'COMMON' }),
      item({ id: 12, name: 'Spyglass', group: 'GENERAL', level: 4, rarity: 'COMMON' }),
    ];
    expect(stockShop(mixed, traits, 'general', 2, () => 0).map((row) => row.name)).toEqual(['Formula: Torch']);
    expect(stockShop(mixed, traits, 'general', 4, () => 0).map((row) => row.name)).toEqual([
      'Formula: Torch',
      'Formula: Lantern',
      'Formula: Spyglass',
    ]);
  });

  it('does not lock common band items onto every regenerate when the pool is larger than the counter', () => {
    const ammo = Array.from({ length: 24 }, (_, index) =>
      item({
        id: 100 + index,
        name: `Ammo ${String(index).padStart(2, '0')}`,
        group: 'GENERAL',
        level: index % 3,
        rarity: 'COMMON',
        traits: [3],
      }),
    );
    const seed = (start: number) => {
      let value = start;
      return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
      };
    };
    const first = stockShop(ammo, traits, 'ammo', 2, seed(3)).map((row) => row.name);
    const second = stockShop(ammo, traits, 'ammo', 2, seed(99), undefined, new Set(stockShop(ammo, traits, 'ammo', 2, seed(3)).map((row) => row.id))).map(
      (row) => row.name,
    );
    expect(first).toHaveLength(STOCK_COUNT);
    expect(second).toHaveLength(STOCK_COUNT);
    expect(first).not.toEqual(second);
    expect(first.filter((name) => second.includes(name)).length).toBeLessThan(STOCK_COUNT);
  });

  it('keeps stock inside the selected books', () => {
    const mixed = [
      item({ id: 20, name: 'Core Rope', group: 'GENERAL', level: 0, rarity: 'COMMON', content_source_id: 1 }),
      item({ id: 21, name: 'Lost Rope', group: 'GENERAL', level: 0, rarity: 'COMMON', content_source_id: 2 }),
    ];
    expect(stockShop(mixed, traits, 'general', 1, () => 0, new Set([1])).map((row) => row.name)).toEqual(['Formula: Core Rope']);
  });
});
