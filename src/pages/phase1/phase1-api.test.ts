import { describe, expect, it } from 'vitest';
import type { Character, Encounter } from '@schemas/content';
import { encounterIncludesOwnCharacter, gmEncounterShownToPlayers, ownCharacterIds, sameUserId, visibleCampaignEncounters } from './phase1-api';

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

describe('sameUserId', () => {
  it('treats UUID case and surrounding space as the same account', () => {
    expect(sameUserId('AbC', ' abc ')).toBe(true);
    expect(sameUserId('abc', 'def')).toBe(false);
    expect(sameUserId(undefined, 'abc')).toBe(false);
  });
});

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

  it('hides an encounter the GM turned off, even when the player is in it', () => {
    const own = ownCharacterIds([{ id: 44, user_id: 'player' } as Character], 'player');
    const hidden = encounter({ ...fight, meta_data: { player_visible: false } });
    expect(visibleCampaignEncounters([hidden], 21, false, own)).toEqual([]);
    expect(visibleCampaignEncounters([hidden], 21, true, own)).toHaveLength(1);
  });

  it('shows an encounter the GM turned on to every player', () => {
    const shown = encounter({
      id: 3,
      campaign_id: 21,
      combatants: { list: [] },
      meta_data: { player_visible: true },
    });
    expect(visibleCampaignEncounters([shown], 21, false, new Set()).map((item) => item.id)).toEqual([3]);
  });

  it('reads the GM switch as on when a player character is already in an untoggled encounter', () => {
    expect(gmEncounterShownToPlayers(fight)).toBe(true);
    const empty = encounter({ id: 4, campaign_id: 21, combatants: { list: [] } });
    expect(gmEncounterShownToPlayers(empty)).toBe(false);
    expect(gmEncounterShownToPlayers(encounter({ ...empty, meta_data: { player_visible: true } }))).toBe(true);
  });

  it('matches a PC stored only on combatant.data.id', () => {
    const row = encounter({
      id: 9,
      campaign_id: 21,
      combatants: { list: [{ _id: 'c1', type: 'CHARACTER', ally: true, data: { id: 44, name: 'Kikkery' } as Encounter['combatants']['list'][number]['data'] }] },
    });
    expect(encounterIncludesOwnCharacter(row, new Set([44]))).toBe(true);
  });
});
