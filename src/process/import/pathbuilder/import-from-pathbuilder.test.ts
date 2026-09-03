import { describe, expect, it } from 'vitest';
import { convertPathbuilderToFTC } from './import-from-pathbuilder';

const sampleBuild = {
  name: 'Test Wanderer',
  class: 'Witch',
  background: 'Hermit',
  ancestry: 'Human',
  heritage: 'Versatile Human',
  level: 3,
  alignment: 'N',
  deity: 'Desna',
  gender: 'she/her',
  age: 24,
  abilities: {
    breakdown: {
      ancestryFree: ['str'],
      ancestryBoosts: ['dex'],
      backgroundBoosts: ['int'],
      classBoosts: ['int'],
      mapLevelledBoosts: { '1': ['wis'] },
    },
  },
  feats: [
    ['Natural Ambition', null],
    ['Counterspell', null, 'Class Feat', 2],
    ['Unbreakable Goblin', null, 'Heritage', 1],
  ],
  lores: [['Engineering', 2]],
  specials: ['Familiar'],
  proficiencies: {
    classDC: 4,
    acrobatics: 2,
    arcana: 4,
    athletics: 0,
  },
  equipment: [
    ['Staff', 1, 'Invested'],
    ['Backpack', 1, 'Invested'],
  ],
  weapons: [{ name: 'Staff', qty: 1, pot: 1, str: 'striking' }],
  armor: [{ name: 'Explorer Clothing' }],
  money: { cp: 8, sp: 4, gp: 12, pp: 0 },
  spellCasters: [
    {
      name: 'Witch',
      spells: [{ spellLevel: 1, list: ['Magic Missile', 'Fear'] }],
      prepared: [{ spellLevel: 0, list: ['Ray of Frost'] }],
    },
  ],
  focus: {
    occult: {
      focusSpells: ['Phase Familiar'],
      focusCantrips: [],
    },
  },
};

describe('convertPathbuilderToFTC', () => {
  it('maps identity, coins, and heritage without using equipment qty as item level', () => {
    const ftc = convertPathbuilderToFTC(sampleBuild);
    expect(ftc.data.name).toBe('Test Wanderer');
    expect(ftc.data.class).toBe('Witch');
    expect(ftc.data.level).toBe(3);
    expect(ftc.data.coins).toEqual({ cp: 8, sp: 4, gp: 12, pp: 0 });
    expect(ftc.data.info?.alignment).toBe('N');
    expect(ftc.data.info?.beliefs).toBe('Desna');
    expect(ftc.data.selections).toEqual(
      expect.arrayContaining([
        { name: 'Versatile Human', level: 1 },
        { name: 'Strength', level: 1 },
        { name: 'Engineering Lore', level: 1 },
        { name: 'Acrobatics', level: 1 },
        { name: 'Arcana', level: 1 },
        { name: 'Counterspell', level: 2 },
        { name: 'Natural Ambition', level: 1 },
      ])
    );
    expect(ftc.data.items.every((item) => item.level === undefined)).toBe(true);
    expect(ftc.data.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Staff', 'Backpack', 'Explorer Clothing'])
    );
  });

  it('aliases remaster spell names and includes focus spells', () => {
    const ftc = convertPathbuilderToFTC(sampleBuild);
    expect(ftc.data.spells).toEqual(
      expect.arrayContaining([
        { name: 'Force Barrage', rank: 1, source: 'Witch' },
        { name: 'Frostbite', rank: 0, source: 'Witch' },
        { name: 'Phase Familiar', rank: 1, source: 'occult' },
      ])
    );
  });

  it('tolerates missing optional collections', () => {
    const ftc = convertPathbuilderToFTC({ name: 'Bare', class: 'Fighter', ancestry: 'Dwarf', level: 1 });
    expect(ftc.data.selections).toEqual([]);
    expect(ftc.data.items).toEqual([]);
    expect(ftc.data.spells).toEqual([]);
    expect(ftc.data.coins).toEqual({ cp: 0, sp: 0, gp: 0, pp: 0 });
  });
});
