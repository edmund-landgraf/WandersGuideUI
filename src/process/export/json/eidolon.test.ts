import { describe, expect, it } from 'vitest';
import { buildEidolonExport } from './eidolon';

const fey = {
  id: 34417,
  name: 'Fey Eidolon',
  description: [
    'Tradition primal',
    'Size Medium',
    'Suggested Attacks tendril (bludgeoning), horn (piercing)',
    'Skirmisher Str +0, Dex +4, Con +3, Int +0, Wis +1, Cha +1; +1 AC (+4 Dex cap)',
    'Skills Deception, Nature',
    'Senses low-light vision',
    'Language Fey',
    'Speed 25 feet',
  ].join('\n'),
};

describe('buildEidolonExport', () => {
  it('reads the selected eidolon type and shares the summoner HP pool', () => {
    const eidolon = buildEidolonExport({
      summonerId: 80,
      maxHp: 16,
      selections: {
        'class-feature-30220_pick': '34417',
        'class-feature-30842_evolution': '22514',
      },
      blocks: [
        { id: 30220, name: 'Eidolon', type: 'class-feature' },
        { id: 30842, name: 'Evolution Feat', type: 'class-feature' },
        fey,
        { id: 22514, name: 'Expanded Senses', type: 'feat' },
      ],
    });
    expect(eidolon).toMatchObject({
      summoner_id: 80,
      feature_id: 34417,
      name: 'Fey Eidolon',
      type: 'Fey',
      tradition: 'primal',
      size: 'Medium',
      hp_pool: 16,
      ac: 18,
      attributes: { ATTRIBUTE_DEX: 4, ATTRIBUTE_CON: 3 },
      saves: { fortitude: 'expert', reflex: 'trained', will: 'expert' },
    });
    expect(eidolon?.attacks).toEqual([
      { name: 'tendril', damage: 'bludgeoning' },
      { name: 'horn', damage: 'piercing' },
    ]);
    expect(eidolon?.evolutions).toEqual([{ id: 22514, name: 'Expanded Senses' }]);
  });

  it('returns null when no eidolon type was chosen', () => {
    expect(buildEidolonExport({ summonerId: 63, selections: { ancestry_boost: 'ATTRIBUTE_CON' }, blocks: [] })).toBeNull();
  });
});
