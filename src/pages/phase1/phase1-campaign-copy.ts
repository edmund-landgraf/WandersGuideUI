import type { Campaign, Character, Encounter } from '@schemas/content';
import { needsRehostForCopy, rehostCampaignArtUrl } from '@upload/image-upload';
import { asRecordList, loadEncountersForCampaignCopy, ownCharacterIds, phase1Request, sameUserId } from './phase1-api';

export type CampaignArtCopyAction = 'none' | 'keep' | 'rehost';

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
  return needsRehostForCopy(source) ? 'rehost' : 'keep';
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

export function encounterCreatePayloadForCopy(encounter: Encounter, targetCampaignId: number): Record<string, unknown> {
  const meta = encounter.meta_data ?? {};
  const { initiative_log: _initiative, dice_roll_log: _diceLog, dice_roll_state: _diceState, ...restMeta } = meta;
  return {
    id: -1,
    created_at: '',
    user_id: '',
    name: encounter.name,
    icon: encounter.icon,
    color: encounter.color,
    campaign_id: targetCampaignId,
    combatants: {
      list: (encounter.combatants?.list ?? []).filter((combatant) => combatant.type !== 'CHARACTER'),
    },
    meta_data: restMeta,
  };
}

export type ExecuteCampaignCopyOptions = {
  source: Campaign;
  campaignId: number;
  accessToken?: string;
  userId: string;
  players: Character[];
  dryRun?: boolean;
};

export type ExecuteCampaignCopyResult = {
  plan: CampaignCopyPlan;
  created?: Campaign;
  copiedArtUrl?: string;
};

export async function executeCampaignCopy(options: ExecuteCampaignCopyOptions): Promise<ExecuteCampaignCopyResult> {
  const { source, campaignId, accessToken, userId, players, dryRun = false } = options;
  const isGm = sameUserId(source.user_id, userId);
  const encounters = await loadEncountersForCampaignCopy(
    campaignId,
    accessToken,
    userId,
    isGm,
    ownCharacterIds(players, userId)
  );
  const plan = buildCampaignCopyPlan(source, encounters);

  if (dryRun) {
    return { plan };
  }

  const sourceArtUrl = source.meta_data?.image_url?.trim() ?? '';
  const copiedArtUrl = sourceArtUrl ? await rehostCampaignArtUrl(sourceArtUrl) : '';
  const created = await phase1Request<Campaign>('create-campaign', {
    name: source.name,
    description: source.description ?? 'A new adventure begins...',
    notes: source.notes,
    recommended_options: source.recommended_options,
    recommended_variants: source.recommended_variants,
    recommended_content_sources: source.recommended_content_sources,
    meta_data: {
      ...source.meta_data,
      party_ids: [],
      ...(copiedArtUrl ? { image_url: copiedArtUrl } : sourceArtUrl ? { image_url: sourceArtUrl } : {}),
    },
  });

  for (const encounter of encounters) {
    await phase1Request('create-encounter', encounterCreatePayloadForCopy(encounter, created.id));
  }

  return { plan, created, copiedArtUrl: copiedArtUrl || sourceArtUrl || undefined };
}

/** Stock find-campaign({ id }) for scripts and dry runs. */
export async function loadCampaignById(campaignId: number, accessToken?: string): Promise<Campaign | null> {
  return asRecordList(await phase1Request<Campaign | Campaign[]>('find-campaign', { id: campaignId }, accessToken))[0] ?? null;
}