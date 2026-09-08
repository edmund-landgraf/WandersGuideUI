import { describe, expect, it } from 'vitest';
import type { Character, Encounter } from '@schemas/content';
import { encounterIncludesOwnCharacter, ownCharacterIds, visibleCampaignEncounters } from './phase1-api';

function encounter(partial: Partial<Encounter> & Pick<Encounter, 'id' | 'campaign_id' | 'combatants'>): Encounter {
  return {
    created_at: '',
    user_id: 'gm',
    name: 'Fight',
    icon: 'combat',
    color: '#000',
    meta_data: {},
    ...partial,
  };
}

describe('visibleCampaignEncounters', () => {
  const fight = encounter({
    id: 9,
    campaign_id: 21,
    combatants: { list: [{ _id: 'c1', type: 'CHARACTER', ally: true, character: 44 }] },
  });

  it('keeps GM encounters for the campaign even with string campaign ids', () => {
    const row = encounter({ ...fight, campaign_id: '21' as unknown as number });
    expect(visibleCampaignEncounters([row], 21, true, new Set())).toHaveLength(1);
  });

  it('shows a player only encounters that include their PC', () => {
    const own = ownCharacterIds([{ id: 44, user_id: 'player' } as Character], 'player');
    expect(visibleCampaignEncounters([fight], 21, false, own).map((item) => item.id)).toEqual([9]);
    expect(visibleCampaignEncounters([fight], 21, false, new Set([99]))).toEqual([]);
  });

  it('matches character ids when the encounter stores them as strings', () => {
    const row = encounter({
      id: 9,
      campaign_id: 21,
      combatants: { list: [{ _id: 'c1', type: 'CHARACTER', ally: true, character: '44' as unknown as number }] },
    });
    expect(encounterIncludesOwnCharacter(row, new Set([44]))).toBe(true);
  });
});
