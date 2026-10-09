import { describe, expect, it } from 'vitest';
import type { Item, Trait } from '@schemas/content';
import { collectShopCards, renderProse, shopExportHtml } from './shops-export';

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
