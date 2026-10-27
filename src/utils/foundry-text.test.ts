import { describe, expect, it } from 'vitest';
import { convertActionSymbolMarkup } from './actions';
import { autoLinkConditions, autoLinkKnownTraits, formatPaizoEntryProse, normalizeMarkdownTables, toStandard2eProse, toWgMarkdownLinks } from './foundry-text';
import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';

function renderProse(text: string) {
  return toWgMarkdownLinks(autoLinkConditions(toStandard2eProse(text)));
}

describe('WG / wiki condition links', () => {
  it('turns [[Concealed]] into a condition content link', () => {
    const out = renderProse(
      'Creatures in the aura are [[Concealed]]. This cloud is suppressed in water.'
    );
    expect(out).not.toContain('[[Concealed]]');
    expect(out).toContain('[concealed](<link_condition_concealed>)');
    expect(out).toContain('[suppressed](<link_condition_suppressed>)');
  });

  it('unwraps [[label](link_type_id)] wiki wrappers', () => {
    const out = toWgMarkdownLinks('See [[Hidden](link_condition_hidden)] nearby.');
    expect(out).toBe('See [Hidden](<link_condition_hidden>) nearby.');
  });

  it('unescapes markdown-escaped wiki brackets', () => {
    const out = renderProse('are \\[\\[Concealed\\]\\].');
    expect(out).toContain('[concealed](<link_condition_concealed>)');
  });
});

describe('action symbol markup', () => {
  it('turns stored abbr tags into action symbol codes', () => {
    const raw =
      '<abbr cost="ONE-ACTION" class="action-symbol">1</abbr> The spell has a range of touch.\n' +
      '<abbr cost="TWO-ACTIONS" class="action-symbol">2</abbr> (concentrate)\n' +
      '<abbr cost="THREE-ACTIONS" class="action-symbol">3</abbr> (concentrate)';
    const out = convertActionSymbolMarkup(raw);
    expect(out).toContain('`action_symbol_1`');
    expect(out).toContain('`action_symbol_2`');
    expect(out).toContain('`action_symbol_3`');
    expect(out).not.toContain('<abbr');
  });

  it('decodes entity-escaped action tags', () => {
    const raw = '&lt;abbr cost=&quot;REACTION&quot; class=&quot;action-symbol&quot;&gt;5&lt;/abbr&gt;';
    expect(toStandard2eProse(raw)).toContain('`action_symbol_5`');
  });
});

describe('Paizo entry prose', () => {
  it('turns an Activate sentence into labeled stat-block text', () => {
    const raw =
      'Activate—Final Glimmer (two actions, concentrate, manipulate). Frequency once per day. Requirements: you are within 10 feet. Effect: the lantern projects an image.';
    const out = formatPaizoEntryProse(raw);
    expect(out).toContain('**Activate** `action_symbol_2` Final Glimmer (concentrate, manipulate)');
    expect(out).toContain('**Frequency** once per day; **Requirements** you are within 10 feet');
    expect(out).toContain('**Effect** the lantern projects an image.');
  });

  it('keeps a content link on an Activate name', () => {
    const raw = 'Activate—[Dancing Lights](link_spell_9192) (two actions, concentrate, manipulate). Frequency three times per day.';
    const out = formatPaizoEntryProse(raw);
    expect(out).toContain('**Activate** `action_symbol_2` [Dancing Lights](link_spell_9192) (concentrate, manipulate)');
    expect(out).toContain('**Frequency** three times per day.');
  });

  it('labels a Passive line', () => {
    expect(formatPaizoEntryProse('Passive: you gain the feat while the shutter is open.')).toBe(
      '**Passive** you gain the feat while the shutter is open.'
    );
  });

  it('labels a Special line', () => {
    expect(formatPaizoEntryProse('Special: no investment is required.')).toBe('**Special** no investment is required.');
  });
});

describe('known trait links', () => {
  it('links concentrate and manipulate without touching nearby words', () => {
    const out = autoLinkKnownTraits('Activate concentrate, manipulate, and light.');
    expect(out).toContain('[concentrate](link_trait_1432)');
    expect(out).toContain('[manipulate](link_trait_1433)');
    expect(out).not.toContain('[light]');
  });
});

describe('normalizeMarkdownTables', () => {
  it('converts HTML spell-slot tables to GFM', () => {
    const html = `<table><tr><th>Lvl</th><th>Can.</th><th>1st</th></tr><tr><td>1</td><td>5</td><td>2</td></tr></table>`;
    const out = normalizeMarkdownTables(html);
    expect(out).toContain('| Lvl | Can. | 1st |');
    expect(out).toContain('| --- | --- | --- |');
    expect(out).toContain('| 1 | 5 | 2 |');
  });

  it('isolates pipe rows so GFM can parse them', () => {
    const out = normalizeMarkdownTables('Slots\n| Lvl | Can. |\n| --- | --- |\n| 1 | 5 |');
    expect(out).toContain('| Lvl | Can. |');
    expect(out).toContain('| 1 | 5 |');
  });

  it('joins pipe rows split by blank lines and inserts a delimiter', () => {
    const out = normalizeMarkdownTables('| Lvl | Can. |\n\n| 1 | 5 |\n\n| 2 | 5 |');
    expect(out).toMatch(/\| Lvl \| Can\. \|\n\| --- \| --- \|\n\| 1 \| 5 \|\n\| 2 \| 5 \|/);
  });
});

describe('getContentDataFromHref', () => {
  it('keeps id segments after extra underscores', () => {
    expect(getContentDataFromHref('link_feat_12_extra')).toEqual({ type: 'feat', id: '12_extra' });
  });
});
