import { describe, expect, it } from 'vitest';
import type { Item, Trait } from '@schemas/content';
import { collectShopCards, foundryItemSlug, renderProse, sanitizeShopFolderNote, shopExportHtml, shopFoundryManifest, shopFolderLabel, shopStockFoundryManifest } from './shops-export';

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
    expect(sanitizeShopFolderNote('  party loot / "night"  ')).toBe('party loot night');
    expect(shopFolderLabel('jh76', new Date(2026, 10, 23), 'party loot')).toBe('jh76 11-23 - party loot');
    expect(shopFoundryManifest('General store — Town', [
      item({ id: 1, name: 'Dagger', meta_data: { quantity: 2, bulk: {} } }),
    ], new Date(2026, 10, 23), { version: 1, rows: [{ wgId: 1, pack: 'pf2e.equipment-srd', slug: 'dagger', status: 'active' }] }, '  a/b  ').folder).toBe('GST 11-23 - ab');
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

  it('uses live item ids and keeps formulas in their own lookup', () => {
    const lookup = {
      version: 1 as const,
      rows: [
        { wgId: 18286, name: 'War Saddle', pack: 'pf2e.equipment-srd', slug: 'war-saddle', status: 'active' as const },
        { wgId: 14255, name: 'Camouflage Suit', pack: 'pf2e.equipment-srd', slug: 'camouflage-suit', status: 'active' as const },
        { wgId: 14256, name: 'Camouflage Suit (Superb)', pack: 'pf2e.equipment-srd', slug: 'camouflage-suit-superb', status: 'active' as const },
        { wgId: 14247, name: 'Boastful Hunter', pack: 'pf2e.equipment-srd', slug: 'boastful-hunter', status: 'active' as const },
        { wgId: 13653, name: 'Fingerprinting Kit', pack: null, slug: null, status: 'unresolved' as const },
        { wgId: 15079, name: 'Book of Translation (Standard)', pack: null, slug: null, status: 'unresolved' as const },
        { wgId: 15080, name: 'Book of Translation (Advanced)', pack: null, slug: null, status: 'unresolved' as const },
      ],
      formulas: [],
    };
    const manifest = shopStockFoundryManifest('dfas', [
      { id: 5468, name: 'Bloodstride Boots' },
      { id: 18286, name: 'War Saddle' },
      { id: 14255, name: 'Formula: Camouflage Suit' },
      { id: 14247, name: 'Formula: Boastful Hunter' },
      { id: 13653, name: 'Fingerprinting Kit' },
      { id: 15079, name: 'Formula: Book of Translation' },
      { id: 3017, name: 'Rod of Razors' },
    ], new Date(2026, 10, 23), lookup);
    expect(manifest.items.map((item) => item.slug)).toEqual(['war-saddle']);
    expect(manifest.skipped).toEqual([
      { id: 5468, name: 'Bloodstride Boots', status: 'unresolved' },
      { id: 14255, name: 'Formula: Camouflage Suit', status: 'formula-not-cataloged' },
      { id: 14247, name: 'Formula: Boastful Hunter', status: 'formula-not-cataloged' },
      { id: 13653, name: 'Fingerprinting Kit', status: 'unresolved' },
      { id: 15079, name: 'Formula: Book of Translation', status: 'formula-not-cataloged' },
      { id: 3017, name: 'Rod of Razors', status: 'unresolved' },
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

  it('resolves local equipment ids from the Foundry equipment list', () => {
    const lookup = {
      version: 1 as const,
      rows: [
        { wgId: 14943, pack: 'pf2e.equipment-srd', slug: null, status: 'unresolved' as const },
      ],
      foundryItems: [
        { wgId: 0, name: 'Cassock of Devotion', pack: 'pf2e.equipment-srd', slug: 'cassock-of-devotion', status: 'active' as const },
        { wgId: 0, name: 'Crown of the Master (Greater)', pack: 'pf2e.equipment-srd', slug: 'crown-of-the-master-greater', status: 'active' as const },
        { wgId: 0, name: 'Swarmform Collar', pack: 'pf2e.equipment-srd', slug: 'swarmform-collar', status: 'active' as const },
        { wgId: 0, name: 'Yiggite Preacher Snakeskin', pack: 'pf2e.equipment-srd', slug: 'yiggite-preacher-snakeskin', status: 'active' as const },
        { wgId: 0, name: 'Cognitive Mutagen (Moderate)', pack: 'pf2e.equipment-srd', slug: 'cognitive-mutagen-moderate', status: 'active' as const },
      ],
    };
    const manifest = shopStockFoundryManifest('dfas', [
      { id: 4707, name: 'Cassock of Devotion' },
      { id: 5727, name: 'Greater Crown of the Master' },
      { id: 4604, name: 'Swarmform Collar' },
      { id: 5995, name: 'Yiggite Preacher Snakeskin' },
      { id: 14943, name: 'Cognitive Mutagen (Moderate) (legacy)' },
    ], new Date(2026, 10, 23), lookup);
    expect(manifest.items.map((item) => item.slug)).toEqual([
      'cassock-of-devotion',
      'crown-of-the-master-greater',
      'swarmform-collar',
      'yiggite-preacher-snakeskin',
    ]);
    expect(manifest.skipped).toEqual([
      { id: 14943, name: 'Cognitive Mutagen (Moderate) (legacy)', status: 'unresolved' },
    ]);
  });

  it('does not resolve local ids by display-name guessing', () => {
    const lookup = {
      version: 1 as const,
      rows: [
        { wgId: 14943, pack: 'pf2e.equipment-srd', slug: null, status: 'unresolved' as const },
      ],
    };
    const manifest = shopStockFoundryManifest('dfas', [
      { id: 338, name: "Beekeeper's Smoker" },
      { id: 4748, name: 'Cloak of the False Foe' },
      { id: 5727, name: 'Greater Crown of the Master' },
      { id: 14943, name: 'Cognitive Mutagen (Moderate) (legacy)' },
    ], new Date(2026, 10, 23), lookup);
    expect(manifest.items).toEqual([]);
    expect(manifest.skipped).toEqual([
      { id: 338, name: "Beekeeper's Smoker", status: 'unresolved' },
      { id: 4748, name: 'Cloak of the False Foe', status: 'unresolved' },
      { id: 5727, name: 'Greater Crown of the Master', status: 'unresolved' },
      { id: 14943, name: 'Cognitive Mutagen (Moderate) (legacy)', status: 'unresolved' },
    ]);
  });

  it('writes the Foundry equipment name when it differs from the Wanderer\'s Guide label', () => {
    const manifest = shopStockFoundryManifest('Test', [
      { id: 12606, name: 'Wand of Dazzling Rays (4th-level)' },
    ], new Date(2026, 10, 23), {
      version: 1,
      rows: [{ wgId: 12606, name: 'Wand of Dazzling Rays (4th-level)', pack: 'pf2e.equipment-srd', slug: 'wand-of-dazzling-rays-4th-rank', status: 'active' }],
      foundryItems: [{ wgId: 12606, name: 'Wand of Dazzling Rays (4th-rank)', pack: 'pf2e.equipment-srd', slug: 'wand-of-dazzling-rays-4th-rank', status: 'active' }],
    });
    expect(manifest.items).toEqual([
      { pack: 'pf2e.equipment-srd', slug: 'wand-of-dazzling-rays-4th-rank', name: 'Wand of Dazzling Rays (4th-rank)', qty: 1 },
    ]);
  });

  it('uses a separate active formula lookup for Formula lines', () => {
    const manifest = shopStockFoundryManifest('Test', [
      { id: 42, name: 'Formula: Camouflage Suit' },
      { id: 43, name: 'Formula: Missing Item' },
    ], new Date(2026, 10, 23), {
      version: 1,
      rows: [],
      formulas: [{ wgId: 42, pack: 'pf2e.equipment-srd', slug: 'camouflage-suit-formula', status: 'active' }],
    });
    expect(manifest.items.map((item) => item.slug)).toEqual(['camouflage-suit-formula']);
    expect(manifest.skipped).toEqual([{ id: 43, name: 'Formula: Missing Item', status: 'formula-not-cataloged' }]);
  });
});
