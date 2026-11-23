import { describe, expect, it } from 'vitest';
import type { Item, Trait } from '@schemas/content';
import { collectShopCards, foundryItemSlug, renderProse, shopExportHtml, shopFoundryManifest, shopFolderLabel, shopStockFoundryManifest } from './shops-export';

function item(partial: Partial<Item> & Pick<Item, 'id' | 'name'>): Item {
  return {
    group: 'GENERAL',
    level: 1,
    rarity: 'COMMON',
    traits: [],
    meta_data: {},
    price: { gp: 1 },
    description: '',
    ...partial,
  } as Item;
}

describe('collectShopCards', () => {
  it('embeds a linked spell and the condition that spell mentions', async () => {
    const stock = [
      item({
        id: 1,
        name: 'Wand',
        description: 'Casts [Zap](link_spell_9), which applies [Blinded](link_condition_blinded).',
      }),
    ];
    const { cards, capped } = await collectShopCards(stock, stock, [] as Trait[], async (type, id) => {
      if (type === 'spell' && id === 9) {
        return { name: 'Zap', description: 'The target is [Blinded](link_condition_blinded).' };
      }
      return null;
    });
    expect(capped).toBe(false);
    expect(cards.map((card) => card.title).sort()).toEqual(['Blinded', 'Wand', 'Zap']);
    const html = shopExportHtml('Magic shop', stock, cards);
    expect(html).toContain('<table>');
    expect(html).toContain('>Wand</button>');
    expect(html).toContain('data-open=');
    expect(html.match(/id="c\d+"/g)?.length).toBe(cards.length);
    expect(html).not.toContain('fetch(');
  });

  it('renders bold markers and a rule instead of leaving the markdown source', () => {
    const html = renderProse('**Ammunition** bolts\n\n***\n\nA large bow.', new Map());
    expect(html).toContain('<strong>Ammunition</strong>');
    expect(html).toContain('<hr>');
    expect(html).not.toContain('**');
  });
});

describe('shopFoundryManifest', () => {
  it('slugs names and caps quantity for the equipment pack', () => {
    expect(foundryItemSlug("Healer's Gloves")).toBe('healers-gloves');
    const manifest = shopFoundryManifest('General store — Town', [
      item({ id: 1, name: 'Dagger', meta_data: { quantity: 2, bulk: {} } }),
    ], new Date(2026, 10, 23), { version: 1, rows: [{ wgId: 1, pack: 'pf2e.equipment-srd', slug: 'dagger', status: 'active' }] });
    expect(manifest.ambaModuleId).toBe('wgui-shop');
    expect(manifest.encounterId).toBe('general-store-town');
    expect(manifest.folder).toBe('GST 11-23');
    expect(shopFolderLabel('jh76', new Date(2026, 10, 23))).toBe('jh76 11-23');
    expect(manifest.items).toEqual([
      { pack: 'pf2e.equipment-srd', slug: 'dagger', name: 'Dagger', qty: 2 },
    ]);
  });

  it('uses active catalog slugs and skips unresolved matches', () => {
    const manifest = shopStockFoundryManifest('Test', [
      { id: 10, name: 'Plate of Yled (Graveknight Plate)' },
      { id: 11, name: 'Energized Shield' },
      { id: 12, name: 'Vine of Roses' },
    ], new Date(2026, 10, 23), {
      version: 1,
      rows: [
        { wgId: 10, pack: 'pf2e.equipment-srd', slug: 'plate-of-yled', status: 'active' },
        { wgId: 11, pack: 'pf2e.equipment-srd', slug: null, status: 'unresolved' },
      ],
    });
    expect(manifest.items.map((item) => item.slug)).toEqual(['plate-of-yled']);
    expect(manifest.skipped).toEqual([
      { id: 11, name: 'Energized Shield', status: 'unresolved' },
      { id: 12, name: 'Vine of Roses', status: 'unresolved' },
    ]);
  });

  it('does not turn a legacy unresolved item into its remaster twin', () => {
    const manifest = shopStockFoundryManifest('Test', [
      { id: 14943, name: 'Cognitive Mutagen (Moderate) (legacy)' },
      { id: 16477, name: 'Cognitive Mutagen (Moderate)' },
    ], new Date(2026, 10, 23), {
      version: 1,
      rows: [
        { wgId: 14943, pack: 'pf2e.equipment-srd', slug: null, status: 'unresolved' },
        { wgId: 16477, pack: 'pf2e.equipment-srd', slug: 'cognitive-mutagen-moderate', status: 'active' },
      ],
    });
    expect(manifest.items).toEqual([
      { pack: 'pf2e.equipment-srd', slug: 'cognitive-mutagen-moderate', name: 'Cognitive Mutagen (Moderate)', qty: 1 },
    ]);
    expect(manifest.skipped).toEqual([
      { id: 14943, name: 'Cognitive Mutagen (Moderate) (legacy)', status: 'unresolved' },
    ]);
  });
});
