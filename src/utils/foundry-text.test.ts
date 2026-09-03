import { describe, expect, it } from 'vitest';
import { autoLinkConditions, normalizeMarkdownTables, toStandard2eProse, toWgMarkdownLinks } from './foundry-text';
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
