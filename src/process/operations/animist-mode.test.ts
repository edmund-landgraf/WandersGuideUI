import { describe, expect, it } from 'vitest';
import { inferAnimistPrimaryMode } from './animist-mode';

describe('inferAnimistPrimaryMode', () => {
  const modes = [
    { id: 39037, name: 'Custodian of Groves and Gardens - Primary' },
    { id: 39044, name: 'Steward of Stone and Fire - Primary' },
    { id: 40000, name: 'Some Other Mode' },
  ];

  it('infers the first selected primary apparition for a fresh Animist export', () => {
    expect(inferAnimistPrimaryMode('Animist', [], ['39037', '39044'], modes)).toEqual([
      'custodian_of_groves_and_gardens_primary',
    ]);
  });

  it('does not override an explicit active mode or activate non-Animist modes', () => {
    expect(inferAnimistPrimaryMode('Animist', ['steward_of_stone_and_fire_primary'], ['39037'], modes)).toEqual([
      'steward_of_stone_and_fire_primary',
    ]);
    expect(inferAnimistPrimaryMode('Druid', [], ['39037'], modes)).toEqual([]);
  });
});
