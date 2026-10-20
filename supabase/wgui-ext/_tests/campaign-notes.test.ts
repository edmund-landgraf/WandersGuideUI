import { assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import { notesFromCampaign, patchNotePage, toPageDto } from '../_wgui-ext/campaign-notes.ts';

const campaign = {
  notes: {
    pages: [
      { name: 'Private', icon: 'lock', color: 'gray', contents: { type: 'doc' } },
      { name: 'Shared', icon: 'book', color: 'blue', shared: true, contents: { type: 'doc' } },
    ],
  },
};

Deno.test('campaign notes preserve page identity and expose only explicit page data', () => {
  const notes = notesFromCampaign(campaign);
  assertEquals(toPageDto(notes.pages[1], 1), {
    name: 'Shared',
    icon: 'book',
    color: 'blue',
    shared: true,
    contents: { type: 'doc' },
    index: 1,
  });
});

Deno.test('campaign note patch changes only requested fields for a player', () => {
  const notes = notesFromCampaign(campaign);
  const pages = patchNotePage(notes.pages, 1, { contents: { type: 'doc', content: [] } }, false);
  assertEquals(pages[0], notes.pages[0]);
  assertEquals(pages[1], {
    name: 'Shared',
    icon: 'book',
    color: 'blue',
    shared: true,
    contents: { type: 'doc', content: [] },
  });
});

Deno.test('campaign note patch lets the GM update page metadata', () => {
  const notes = notesFromCampaign(campaign);
  const pages = patchNotePage(notes.pages, 0, { name: 'GM summary', shared: true }, true);
  assertEquals(pages[0].name, 'GM summary');
  assertEquals(pages[0].shared, true);
});

Deno.test('campaign note patch leaves an out-of-range page unchanged', () => {
  const notes = notesFromCampaign(campaign);
  assertEquals(patchNotePage(notes.pages, 4, { name: 'wrong' }, true), notes.pages);
});
Deno.test('malformed campaign notes do not shift page indexes', () => {
  assertEquals(notesFromCampaign({ notes: { pages: [{ name: 'Broken' }] } }), { pages: [] });
});
