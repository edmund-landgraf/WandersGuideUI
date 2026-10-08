import { describe, expect, it } from 'vitest';
import type { Item, Trait } from '@schemas/content';
import { formatShopPrice, stockShop } from './shops-generate';

function item(partial: Partial<Item> & Pick<Item, 'id' | 'name' | 'group' | 'level' | 'rarity'>): Item {
  return { traits: [], meta_data: {}, price: { gp: 1 }, ...partial } as Item;
}

const traits = [{ id: 1, name: 'Alchemical' }, { id: 2, name: 'Magical' }] as Trait[];

describe('stockShop', () => {
  const catalog = [
    item({ id: 1, name: 'Rope', group: 'GENERAL', level: 0, rarity: 'COMMON' }),
    item({ id: 2, name: 'Longsword', group: 'WEAPON', level: 1, rarity: 'COMMON' }),
    item({ id: 3, name: 'Elixir', group: 'GENERAL', level: 3, rarity: 'COMMON', traits: [1] }),
    item({ id: 4, name: 'Wand', group: 'GENERAL', level: 4, rarity: 'UNCOMMON', traits: [2] }),
    item({ id: 5, name: 'Potency', group: 'RUNE', level: 4, rarity: 'COMMON', traits: [2] }),
    item({ id: 6, name: 'Hidden', group: 'GENERAL', level: 1, rarity: 'COMMON', meta_data: { unselectable: true } }),
  ];

  it('keeps general goods inside the level band and drops unselectable rows', () => {
    const stock = stockShop(catalog, traits, 'general', 1, () => 0);
    expect(stock.map((row) => row.name)).toEqual(['Rope']);
  });

  it('matches alchemical and magical traits, and keeps runes out of magic gear', () => {
    expect(stockShop(catalog, traits, 'alchemical', 5, () => 0).map((row) => row.name)).toEqual(['Elixir']);
    expect(stockShop(catalog, traits, 'magic', 5, () => 0).map((row) => row.name)).toEqual(['Wand']);
    expect(stockShop(catalog, traits, 'runes', 5, () => 0).map((row) => row.name)).toEqual(['Potency']);
  });

  it('formats coin prices', () => {
    expect(formatShopPrice({ gp: 2, sp: 5 })).toBe('2 gp 5 sp');
    expect(formatShopPrice(null)).toBe('—');
  });
});
