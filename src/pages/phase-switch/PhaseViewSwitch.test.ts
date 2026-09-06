import { describe, expect, it } from 'vitest';
import { OLD_UI_ORIGIN, originalCampaignUrl, phaseWorkspacePath } from './PhaseViewSwitch';

describe('phaseWorkspacePath standalone encounters', () => {
  it('maps Phase 1 list and detail without a campaign', () => {
    expect(phaseWorkspacePath('phase1', { section: 'encounters' })).toBe('/phase1/encounters');
    expect(phaseWorkspacePath('phase1', { section: 'encounters', encounterId: 21 })).toBe('/phase1/encounters/21');
  });

  it('falls Phase 0 standalone encounters back to /phase0', () => {
    expect(phaseWorkspacePath('phase0', { section: 'encounters', encounterId: 21 })).toBe('/phase0');
  });

  it('keeps campaign nested encounter URLs', () => {
    expect(phaseWorkspacePath('phase1', { campaignId: 21, encounterId: 21 })).toBe('/phase1/campaign/21/encounters/21');
  });
});

describe('originalCampaignUrl standalone encounters', () => {
  it('opens the classic encounters list', () => {
    expect(originalCampaignUrl({ section: 'encounters', encounterId: 21 })).toBe(`${OLD_UI_ORIGIN}/encounters`);
  });
});
