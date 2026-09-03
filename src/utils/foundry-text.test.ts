import { describe, expect, it } from 'vitest';
import { autoLinkConditions, toStandard2eProse, toWgMarkdownLinks } from './foundry-text';
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

describe('getContentDataFromHref', () => {
  it('keeps id segments after extra underscores', () => {
    expect(getContentDataFromHref('link_feat_12_extra')).toEqual({ type: 'feat', id: '12_extra' });
  });
});
