import { describe, expect, it } from 'vitest';
import type { Campaign, Encounter } from '@schemas/content';
import {
  buildCampaignCopyPlan,
  campaignArtCopyAction,
  encounterCreatePayloadForCopy,
} from './phase1-campaign-copy';

function campaign(partial: Partial<Campaign> & Pick<Campaign, 'id' | 'name'>): Campaign {
  return {
    created_at: '',
    user_id: 'gm',
    description: null,
    join_key: 'key',
    notes: null,
    recommended_options: null,
    recommended_variants: null,
    recommended_content_sources: null,
    custom_operations: null,
    meta_data: null,
    ...partial,
  };
}

describe('campaignArtCopyAction', () => {
  it('leaves public http links on the copied campaign', () => {
    expect(campaignArtCopyAction('https://i.imgur.com/abc.jpg')).toBe('keep');
  });

  it('rehosts site-relative and storage-backed art', () => {
    expect(campaignArtCopyAction('/backgrounds/woods.webp')).toBe('rehost');
    expect(
      campaignArtCopyAction('http://kong:8000/storage/v1/object/public/backgrounds/sample.jpg')
    ).toBe('rehost');
  });
});

describe('buildCampaignCopyPlan', () => {
  it('summarizes what a duplicate would create', () => {
    const source = campaign({
      id: 41,
      name: 'Vhalek',
      notes: { pages: [{ name: 'A', icon: '', color: '', contents: null, shared: false }] },
      meta_data: {
        image_url: '/backgrounds/mansion.webp',
        encounter_folders: [{ id: 'a', name: 'Act 1', parent_id: null, sort: 0 }],
      },
    });
    const encounters = [
      { id: 1, name: 'Ambush' } as Encounter,
      { id: 2, name: 'Foyer' } as Encounter,
    ];
    const plan = buildCampaignCopyPlan(source, encounters);
    expect(plan).toEqual({
      sourceCampaignId: 41,
      encounterCount: 2,
      notePageCount: 1,
      folderCount: 1,
      sourceArtUrl: '/backgrounds/mansion.webp',
      artAction: 'rehost',
      encounterNames: ['Ambush', 'Foyer'],
    });
  });
});

describe('encounterCreatePayloadForCopy', () => {
  it('strips session logs and player characters', () => {
    const row = {
      id: 9,
      name: 'Fight',
      icon: 'combat',
      color: '#111',
      meta_data: {
        description: 'hall',
        initiative_log: [],
        dice_roll_log: [],
        dice_roll_state: {},
        folder_id: 'f1',
      },
      combatants: {
        list: [
          { _id: 'p1', type: 'CHARACTER', ally: true, character: 1 },
          { _id: 'c1', type: 'CREATURE', ally: false },
        ],
      },
    } as unknown as Encounter;
    expect(encounterCreatePayloadForCopy(row, 42)).toMatchObject({
      campaign_id: 42,
      meta_data: { description: 'hall', folder_id: 'f1' },
      combatants: { list: [{ _id: 'c1', type: 'CREATURE', ally: false }] },
    });
    expect(encounterCreatePayloadForCopy(row, 42).meta_data).not.toHaveProperty('initiative_log');
  });
});