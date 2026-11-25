import type { Campaign, Character, Encounter } from '@schemas/content';
import { campaignCopyAssetAction, migrateCampaignCopyAsset, stageCampaignCopyAssets, type CampaignCopyArtMap } from './phase1-campaign-copy-art';
import { asRecordList, loadEncountersForCampaignCopy, phase1Request } from './phase1-api';

import { buildCampaignCopyPlan, type CampaignCopyPlan } from './phase1-campaign-copy-plan';
import { parseCopyPreparation, validCopyReceipt } from './phase1-campaign-copy-manifest';
export { buildCampaignCopyPlan, campaignArtCopyAction } from './phase1-campaign-copy-plan';
export type { CampaignCopyPlan, CampaignArtCopyAction } from './phase1-campaign-copy-plan';

export type CampaignArtCopyOutcome = 'none' | 'kept' | 'rehosted' | 'unverified';

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
  artOutcome?: CampaignArtCopyOutcome;
};

// A pending operation survives a failed response and a reload in the same tab.
type PendingCopy = { id: string; artMap?: CampaignCopyArtMap };
const pendingCopies = new Map<string, PendingCopy>();

function pendingCopy(key: string): PendingCopy {
  const cached = pendingCopies.get(key);
  if (cached) return cached;
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as PendingCopy | null;
    if (stored && typeof stored.id === 'string') {
      pendingCopies.set(key, stored);
      return stored;
    }
  } catch { /* Storage may be disabled; retain the key in memory. */ }
  const operation = { id: crypto.randomUUID() };
  rememberCopy(key, operation);
  return operation;
}

function rememberCopy(key: string, operation: PendingCopy) {
  pendingCopies.set(key, operation);
  try { sessionStorage.setItem(key, JSON.stringify(operation)); } catch { /* In-memory fallback. */ }
}

function finishCopy(key: string) {
  pendingCopies.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}

type AtomicCopyResponse = {
  created: Campaign;
  encounterNames: string[];
  encounterCount: number;
};

export async function executeCampaignCopy(options: ExecuteCampaignCopyOptions): Promise<ExecuteCampaignCopyResult> {
  const { source, campaignId, accessToken, userId, dryRun = false } = options;
  if (dryRun) {
    const encounters = await loadEncountersForCampaignCopy(
      campaignId, accessToken
    );
    return { plan: buildCampaignCopyPlan(source, encounters) };
  }

  const key = `wgui:campaign-copy:${userId}:${campaignId}`;
  const operation = pendingCopy(key);
  // Prepare from the authoritative database, not the player-filtered encounter
  // API. A committed operation returns its receipt before any further staging.
  const prepared = await phase1Request<unknown>('wgui-ext-copy-campaign', {
    campaign_id: campaignId, operation_id: operation.id, prepare: true,
  }, accessToken);
  let result: AtomicCopyResponse;
  let expectedCount: number | undefined;
  if (prepared && typeof prepared === 'object' && 'created' in prepared) {
    result = prepared as AtomicCopyResponse;
  } else {
    const manifest = parseCopyPreparation(prepared,campaignId);
    expectedCount = manifest.encounterIds.length;
    operation.artMap ??= {};
    await stageCampaignCopyAssets(manifest.assets, operation.artMap, () => rememberCopy(key, operation),
      (ref) => migrateCampaignCopyAsset(ref, { accessToken }));
    // Send only references in the latest manifest. SQL checks all artwork on the
    // actual rows being inserted and aborts if a source edit introduced a new URL.
    const artMap = Object.fromEntries(manifest.assets.map((ref) => [ref, operation.artMap![ref]]));
    result = await phase1Request<AtomicCopyResponse>('wgui-ext-copy-campaign', {
      campaign_id: campaignId, operation_id: operation.id, art_map: artMap,
      expected_encounter_ids: manifest.encounterIds,
    }, accessToken);
  }
  if (!validCopyReceipt(result,expectedCount)) {
    throw new Error('Campaign copy result could not be confirmed. Retry to recover the same operation.');
  }
  const plan = {
    ...buildCampaignCopyPlan(source, []),
    encounterCount: result.encounterNames.length,
    encounterNames: result.encounterNames,
  };
  const copiedArtUrl = result.created.meta_data?.image_url || undefined;
  const sourceArt = source.meta_data?.image_url ?? '';
  const artOutcome = campaignArtCopyOutcome(sourceArt, copiedArtUrl, operation.artMap);
  finishCopy(key);
  return { plan, created: result.created, copiedArtUrl, artOutcome };
}

/** Report a verified staging outcome, not a planned action or an assumed receipt. */
export function campaignArtCopyOutcome(source: string, destination?: string, staged?: CampaignCopyArtMap): CampaignArtCopyOutcome {
  if (!source.trim() && !destination) return 'none';
  if (!destination || !source.trim()) return 'unverified';
  try {
    const action = campaignCopyAssetAction(source);
    if (action.kind === 'keep') return destination === action.url ? 'kept' : 'unverified';
    return staged && Object.prototype.hasOwnProperty.call(staged, source) && staged[source] === destination &&
      destination !== action.url ? 'rehosted' : 'unverified';
  } catch { return 'unverified'; }
}

/** Stock find-campaign({ id }) for scripts and dry runs. */
export async function loadCampaignById(campaignId: number, accessToken?: string): Promise<Campaign | null> {
  return asRecordList(await phase1Request<Campaign | Campaign[]>('find-campaign', { id: campaignId }, accessToken))[0] ?? null;
}
