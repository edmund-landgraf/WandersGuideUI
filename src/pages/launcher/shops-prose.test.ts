import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { prepareShopProse, ShopProse } from './shops-public';

const SAMPLE = `A [_+1_](link_item_1) [sample](link_item_6) made of [_wood_](link_trait_2).

#### Grades

| Kind | Hardness | HP |
| --- | --- | --- |
| Thin |
| Standard | 5 | 20 |

**Activate** <abbr cost="ONE-ACTION" class="action-symbol">1</abbr> ([manipulate](link_trait_3))

* * *

**Activate–Sample** <abbr cost="TWO-ACTIONS" class="action-symbol">2</abbr>; **Effect** You cast *[sample spell](link_spell_4)* while _sample spell_ lasts, then [Strike](link_action_5).`;

describe('ShopProse', () => {
  it('renders links, headings, tables, action symbols, rules, and emphasis', () => {
    const markup = renderToStaticMarkup(createElement(ShopProse, { text: SAMPLE }));
    expect(markup).toContain('>+1</button>');
    expect(markup).toContain('>sample</button>');
    expect(markup).toContain('>wood</button>');
    expect(markup).not.toContain('_+1_');
    expect(markup).toContain('>manipulate</button>');
    expect(markup).toContain('>Strike</button>');
    expect(markup).toContain('<em><button');
    expect(markup).toContain('>sample spell</button>');
    expect(markup).toContain('<em>sample spell</em>');
    expect(markup).not.toContain('link_item_1');
    expect(markup).not.toContain('link_spell_4');
    expect(markup).not.toContain('<abbr');
    expect(markup).not.toContain('####');
    expect(markup).toContain('<table');
    expect(markup).toContain('Hardness');
    expect(markup).toContain('◆');
    expect(markup).toContain('◆◆');
    expect(markup).toContain('<hr');
    expect(markup).toContain('<strong>Activate</strong>');
  });

  it('renders markdown, HTML formatting, and plain text', () => {
    const markdown = renderToStaticMarkup(createElement(ShopProse, { text: 'A **bold** shop.\n\n- one' }));
    expect(markdown).toContain('<strong>bold</strong>');
    expect(markdown).toContain('<li>one</li>');

    const html = renderToStaticMarkup(createElement(ShopProse, { text: '<p>Welcome to <em>the</em> <strong>bazaar</strong>.</p>' }));
    expect(html).toContain('<em>the</em>');
    expect(html).toContain('<strong>bazaar</strong>');
    expect(html).not.toContain('<p>Welcome');

    const plain = renderToStaticMarkup(createElement(ShopProse, { text: 'Open from dawn until dusk.' }));
    expect(plain).toContain('Open from dawn until dusk.');
    expect(prepareShopProse('<span>kept</span>')).toBe('\nkept\n');
  });
});
