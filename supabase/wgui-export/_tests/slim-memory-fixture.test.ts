import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectSlimCatalogPages, SLIM_CATALOG_PAGE_SIZE } from '../_wgui-export/slim-catalog.ts';
import { serializeSlimExport, slimExport } from '../_wgui-export/slim.ts';

test('104 books and 2731 spells: page all rules and serialize only required v4 output', async () => {
  const sources = Array.from({ length: 104 }, (_, i) => ({
    id: i + 3, name: 'Book ' + i, user_id: i >= 100 ? 'fixture-homebrew-owner' : null,
  }));
  const calls: (number | null)[] = [];
  const spells = await collectSlimCatalogPages(async (afterId, limit) => {
    calls.push(afterId);
    // Simulate a database-side cap smaller than the requested page size.
    const start = (afterId ?? 0) + 1;
    const end = Math.min(2731, start + Math.min(137, limit) - 1);
    // Simulate parsing a single PostgREST page, not preallocating the full catalog.
    return JSON.parse(JSON.stringify(Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => {
      const id = start + i;
      return {
        id, name: 'Spell ' + id, content_source_id: sources[(id - 1) % sources.length].id,
        rank: id % 10, traits: [1, 2], description: ('Rule text ' + id + ' ').repeat(120),
        search_tsv: ('search vector ' + id + ' ').repeat(240),
      };
    }))) as { id: number; content_source_id: number; description: string; search_tsv?: string }[];
  });
  assert.equal(spells.length, 2731);
  assert.equal(new Set(spells.map(row => row.id)).size, 2731);
  assert.equal(spells.at(-1)?.id, 2731);
  assert.ok(calls.length > Math.ceil(2731 / SLIM_CATALOG_PAGE_SIZE));
  assert.ok(spells.every(row => !('search_tsv' in row) && row.description.length > 0));
  const traits = [{ id: 1, content_source_id: 3, name: 'Fire' },
    { id: 2, content_source_id: 106, name: 'Homebrew Trait', search_tsv: 'unused' }];
  const homebrewSpells = spells.filter(spell => spell.content_source_id >= 103);
  const selected = { ...spells[0], rank: 2, casting_source: 'Primal' };
  const raw = { variables: { SPELL_IDS: { value: ['1'] } }, bonuses: { AC: [1, 2] }, history: { AC: [1, 2] } };
  const full = {
    version: 4,
    character: { id: 114, content_sources: { enabled: sources.map(row => row.id) }, companions: { list: [{ id: 4 }] }, search_tsv: 'unused' },
    content: {
      all_sources: sources, all_spells: spells, all_traits: traits, character_traits: [traits[0]],
      raw_data_dump: raw, spells: { all: [selected], normal: [selected], cantrips: [], rituals: [] },
      focus_spells: [selected], innate_spells: [{ spell: selected }], spell_slots: [{ spell: selected }],
      inventory_flat: [{ item: { name: 'Homebrew item', search_tsv: 'unused' } }],
      feats_features: { feats: [{ name: 'Feat' }] }, max_hp: 28, ac: 18,
    },
  };
  const direct = JSON.parse(serializeSlimExport(full));
  const legacy = JSON.parse(JSON.stringify(slimExport(full)));
  assert.deepEqual(direct, legacy);
  assert.deepEqual(direct.content.all_spells, homebrewSpells);
  assert.deepEqual(direct.content.all_traits, [{ id: 2, content_source_id: 106, name: 'Homebrew Trait' }]);
  assert.equal(direct.slim.dropped.all_spells, 2731 - homebrewSpells.length);
  assert.deepEqual(direct.content.raw_data_dump, { variables: raw.variables });
  assert.equal(direct.slim.dropped['raw_data_dump.bonuses'], 1);
  assert.equal(direct.slim.dropped['raw_data_dump.history'], 1);
  assert.deepEqual(direct.content.spells.all, [selected]);
  assert.deepEqual(direct.content.focus_spells, [selected]);
  assert.deepEqual(direct.content.innate_spells, [{ spell: selected }]);
  assert.deepEqual(direct.content.spell_slots, [{ spell: selected }]);
  assert.deepEqual(direct.character.content_sources.enabled, sources.map(row => row.id));
  assert.equal(direct.character.companions.list.length, 1);
  assert.equal(direct.content.inventory_flat[0].item.search_tsv, undefined);
  // The shared compiler objects were not changed by the serializer.
  assert.equal(full.content.all_spells.length, 2731);
  assert.equal(full.content.raw_data_dump.bonuses.AC.length, 2);
  assert.equal(full.content.all_traits[1].search_tsv, 'unused');
  const maxRssMiB = process.resourceUsage().maxRSS / 1024;
  console.log('Synthetic slim export fixture peak Node RSS: ' + maxRssMiB.toFixed(1) + ' MiB (not a Deno worker measurement)');
  if (process.platform === 'linux') assert.ok(maxRssMiB < 256, 'synthetic fixture must fit below the 256 MiB comparison budget');
});

test('slim catalog refuses a nonadvancing or oversized page rather than silently losing rows', async () => {
  await assert.rejects(collectSlimCatalogPages(async () => [{ id: 1 }], 2), /did not advance/);
  await assert.rejects(collectSlimCatalogPages(async () => [{ id: 1 }, { id: 2 }], 1), /Invalid slim catalog page/);
  await assert.rejects(collectSlimCatalogPages(async () => { throw Error('database failed'); }), /database failed/);
});

test('non-caster slim export keeps existing empty catalog omission and dropped counters', () => {
  const payload = { version: 4, character: { id: 1 }, content: { all_sources: [], all_spells: [], all_traits: [], raw_data_dump: { variables: {}, bonuses: undefined, history: undefined } } };
  const result = JSON.parse(serializeSlimExport(payload));
  assert.equal(result.content.all_spells, undefined);
  assert.equal(result.content.all_traits, undefined);
  assert.deepEqual(result.slim.dropped, { all_spells: 0, all_traits: 0, 'raw_data_dump.bonuses': 1, 'raw_data_dump.history': 1 });
});
