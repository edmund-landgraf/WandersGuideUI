import { describe, expect, it } from 'vitest';
import type { Item } from '@schemas/content';
import { shopDraft } from './shops-syndicate';
import { shopAonHref, shopAonIndex } from './shops-pf2e';

const ABYSIUM = 'https://2e.aonprd.com/Equipment.aspx?ID=1405';

function item(partial: Partial<Item> & Pick<Item, 'id' | 'name'>): Item {
  return {
    group: 'MATERIAL',
    level: 0,
    rarity: 'RARE',
    traits: [],
    meta_data: {},
    price: { gp: 450 },
    description: '',
    content_source_id: 1,
    ...partial,
  } as Item;
}

describe('shop AoN links', () => {
  const pf2e = item({
    id: -7913,
    name: 'Abysium Chunk',
    meta_data: { shop_source: 'pf2e-local', aon_url: ABYSIUM } as Item['meta_data'],
  });
  const guide = item({ id: 42, name: 'Abysium Chunk' });

  it('uses the catalog ID and ignores name search', () => {
    expect(shopAonHref(pf2e)).toBe(ABYSIUM);
    expect(shopAonHref(item({
      id: 1,
      name: 'Rope',
      meta_data: { aon_url: 'https://2e.aonprd.com/Search.aspx?q=Rope' } as Item['meta_data'],
    }))).toBeUndefined();
  });

  it('gives a Wanderer\'s Guide copy the matching Archives ID', () => {
    const index = shopAonIndex([pf2e]);
    expect(shopAonHref(guide, index)).toBe(ABYSIUM);
    const draft = shopDraft('general', 'village', [guide], [], 0, 'default', '', { aonIndex: index });
    expect(draft.stock[0].aon).toBe(ABYSIUM);
  });
});
