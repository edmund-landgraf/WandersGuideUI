import { describe, expect, it } from 'vitest';
import { missingPartyCharacterIds, reconcilePartyAutoSync } from './phase1-party-auto-sync';

describe('encounter party auto-sync', () => {
  it('does not re-add a character while moving them from the encounter to the bench', () => {
    const present = new Set<number>();
    const inParty = new Set([67]);
    const pendingAdds = new Set<number>();
    const pendingRemovals = new Set([67]);

    reconcilePartyAutoSync(present, inParty, pendingAdds, pendingRemovals);

    expect(missingPartyCharacterIds([67], present, inParty, pendingAdds, pendingRemovals)).toEqual([]);
    expect(pendingRemovals).toEqual(new Set([67]));
  });

  it('releases the removal guard after the party write confirms the character is resting', () => {
    const present = new Set<number>();
    const pendingAdds = new Set<number>();
    const pendingRemovals = new Set([67]);

    reconcilePartyAutoSync(present, new Set(), pendingAdds, pendingRemovals);

    expect(pendingRemovals).toEqual(new Set());
    expect(missingPartyCharacterIds([67], present, new Set(), pendingAdds, pendingRemovals)).toEqual([]);
  });

  it('deduplicates pending additions until the saved encounter contains the character', () => {
    const pendingAdds = new Set([67]);
    const pendingRemovals = new Set<number>();

    expect(missingPartyCharacterIds([67], new Set(), new Set([67]), pendingAdds, pendingRemovals)).toEqual([]);
    reconcilePartyAutoSync(new Set([67]), new Set([67]), pendingAdds, pendingRemovals);
    expect(pendingAdds).toEqual(new Set());
  });
});
