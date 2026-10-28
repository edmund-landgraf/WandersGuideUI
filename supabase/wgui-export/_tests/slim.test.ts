import { assert, assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import { slimExport, SLIM_VERSION } from '../_wgui-export/slim.ts';

function fullExport() {
  return {
    version: 4,
    character: { id: 80, name: 'Veshka', spells: { list: [{ spell_id: 4888, rank: 0, source: 'SUMMONER' }] } },
    content: {
      _README: 'readme',
      all_sources: [
        { id: 3, name: 'Core', user_id: null },
        { id: 900, name: 'My homebrew', user_id: 'u-1' },
      ],
      all_spells: [
        { id: 4888, name: 'Tangle Vine', content_source_id: 3, search_tsv: 'x' },
        { id: 9001, name: 'Homebrew Bolt', content_source_id: 900 },
      ],
      all_traits: [{ id: 1, name: 'Fire', content_source_id: 3 }],
      feats_features: { classFeatures: [{ id: 7, name: 'Eidolon', search_tsv: 'y' }] },
      spell_slots: [{ rank: 0, source: 'SUMMONER', amt: 5 }],
      spells: [{ id: 4888, name: 'Tangle Vine' }],
      focus_spells: [{ id: 1, name: 'Boost Eidolon' }],
      innate_spells: [],
      raw_data_dump: { variables: { CASTING_SOURCES: { value: [] } }, bonuses: { big: 1 }, history: { big: 2 } },
    },
  };
}

Deno.test('slimExport drops core catalog rows and keeps homebrew ones', () => {
  const slim = slimExport(fullExport()) as any;
  assertEquals(slim.content.all_spells, [{ id: 9001, name: 'Homebrew Bolt', content_source_id: 900 }]);
  assertEquals('all_traits' in slim.content, false);
  assertEquals(slim.slim, {
    version: SLIM_VERSION,
    dropped: { all_spells: 1, all_traits: 1, 'raw_data_dump.bonuses': 1, 'raw_data_dump.history': 1 },
  });
});

Deno.test('slimExport keeps everything the importer reads', () => {
  const full = fullExport();
  const slim = slimExport(full) as any;
  assertEquals(slim.version, 4);
  assertEquals(slim.character, full.character);
  for (const key of ['_README', 'all_sources', 'spell_slots', 'spells', 'focus_spells', 'innate_spells']) {
    assertEquals(slim.content[key], (full.content as any)[key], key);
  }
  assertEquals(slim.content.raw_data_dump, { variables: full.content.raw_data_dump.variables });
  assertEquals(slim.content.feats_features, { classFeatures: [{ id: 7, name: 'Eidolon' }] });
  assert(!JSON.stringify(slim).includes('search_tsv'));
});

Deno.test('slimExport passes through anything that is not an export', () => {
  assertEquals(slimExport(null), null);
  assertEquals(slimExport({ status: 'fail' }), { status: 'fail' });
});