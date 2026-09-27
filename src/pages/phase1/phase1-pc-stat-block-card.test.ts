import type { Character } from '@schemas/content';
import { describe, expect, it } from 'vitest';
import { characterToStatBlockCard } from './phase1-pc-stat-block-card';

describe('characterToStatBlockCard', () => {
  it('returns an empty card when content is missing', () => {
    const character = { id: 1, name: 'Ulysses', hero_points: 1 } as Character;
    const card = characterToStatBlockCard(character, null);
    expect(card.hasSheet).toBe(false);
    expect(card.name).toBe('Ulysses');
    expect(card.melee).toEqual([]);
  });
});
