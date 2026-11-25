import type { Campaign, Encounter } from '../../schemas/content';
import { campaignCopyAssetAction } from './phase1-campaign-copy-art-policy';

export type CampaignArtCopyAction = 'none' | 'keep' | 'rehost' | 'blocked';

export type CampaignCopyPlan = {
  sourceCampaignId: number;
  encounterCount: number;
  notePageCount: number;
  folderCount: number;
  sourceArtUrl: string;
  artAction: CampaignArtCopyAction;
  encounterNames: string[];
};

export function campaignArtCopyAction(imageUrl: string | null | undefined): CampaignArtCopyAction {
  const source = imageUrl?.trim() ?? '';
  if (!source) return 'none';
  try { return campaignCopyAssetAction(source).kind === 'upload' ? 'rehost' : 'keep'; }
  catch { return 'blocked'; }
}

export function buildCampaignCopyPlan(source: Campaign, encounters: Encounter[]): CampaignCopyPlan {
  const sourceArtUrl = source.meta_data?.image_url?.trim() ?? '';
  return {
    sourceCampaignId: source.id,
    encounterCount: encounters.length,
    notePageCount: source.notes?.pages?.length ?? 0,
    folderCount: source.meta_data?.encounter_folders?.length ?? 0,
    sourceArtUrl,
    artAction: campaignArtCopyAction(sourceArtUrl),
    encounterNames: encounters.map((row) => row.name),
  };
}

