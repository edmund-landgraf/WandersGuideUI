import { describe, expect, it } from 'vitest';
import type { Item } from '@schemas/content';
import { shopDraft } from './shops-syndicate';
import { fillMissingShopAon, shopAonHref, shopAonIndex } from './shops-pf2e';

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
    meta_data: { shop_source: 'pf2e-local', aon_url: ABYSIUM } as unknown as Item['meta_data'],
  });
  const guide = item({ id: 42, name: 'Abysium Chunk' });
  const guideWithSource = item({
    id: 43,
    name: 'Ethersight Ring',
    meta_data: { source: { url: 'https://2e.aonprd.com/Equipment.aspx?ID=4874' } } as unknown as Item['meta_data'],
  });

  it('uses the catalog ID and ignores name search', () => {
    expect(shopAonHref(pf2e)).toBe(ABYSIUM);
    expect(shopAonHref(item({
      id: 1,
      name: 'Rope',
      meta_data: { aon_url: 'https://2e.aonprd.com/Search.aspx?q=Rope' } as unknown as Item['meta_data'],
    }))).toBeUndefined();
  });

  it('gives a Wanderer\'s Guide copy the matching Archives ID', () => {
    const index = shopAonIndex([pf2e]);
    expect(shopAonHref(guide, index)).toBe(ABYSIUM);
    expect(shopAonHref(guideWithSource)).toBe('https://2e.aonprd.com/Equipment.aspx?ID=4874');
    const draft = shopDraft('general', 'village', [guide], [], 0, 'default', '', { aonIndex: index });
    expect(draft.stock[0].aon).toBe(ABYSIUM);
  });

  it('fills a published row that was saved without a link', () => {
    const index = shopAonIndex([pf2e]);
    const [filled] = fillMissingShopAon([{ name: 'Abysium Chunk', level: 0 }], index);
    expect(filled.aon).toBe(ABYSIUM);
    const [kept] = fillMissingShopAon([{ name: 'Abysium Chunk', level: 0, aon: 'https://2e.aonprd.com/Equipment.aspx?ID=1' }], index);
    expect(kept.aon).toBe('https://2e.aonprd.com/Equipment.aspx?ID=1');
    const [search] = fillMissingShopAon([{ name: 'Rope', level: 0 }], new Map());
    expect(search.aon).toBeUndefined();
    const [upgraded] = fillMissingShopAon([{ name: 'Abysium Chunk', level: 0, aon: search.aon }], index);
    expect(upgraded.aon).toBe(ABYSIUM);
    expect(shopAonHref(item({
      id: 2,
      name: 'False Link',
      meta_data: { source: { url: 'https://2e.aonprd.com/Search.aspx?q=Fake' } } as unknown as Item['meta_data'],
    }))).toBeUndefined();
    expect(shopAonHref(item({
      id: 3,
      name: 'Another False Link',
      meta_data: { source: { url: 'https://example.com/Equipment.aspx?ID=44' } } as unknown as Item['meta_data'],
    }))).toBeUndefined();
  });
});
