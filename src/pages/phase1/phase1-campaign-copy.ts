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

// A pending operation survives a failed response and a reload in the same tab.
type PendingCopy = { id: string; artUrl?: string };
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
};

export async function executeCampaignCopy(options: ExecuteCampaignCopyOptions): Promise<ExecuteCampaignCopyResult> {
  const { source, campaignId, accessToken, userId, players, dryRun = false } = options;
  if (dryRun) {
    const encounters = await loadEncountersForCampaignCopy(
      campaignId, accessToken, userId, sameUserId(source.user_id, userId), ownCharacterIds(players, userId)
    );
    return { plan: buildCampaignCopyPlan(source, encounters) };
  }

  const key = `wgui:campaign-copy:${userId}:${campaignId}`;
  const operation = pendingCopy(key);
  const sourceArtUrl = source.meta_data?.image_url?.trim() ?? '';
  // Storage is outside Postgres. Keep the staged URL with this operation so a
  // retry after a failed/ambiguous database response does not upload it again.
  if (operation.artUrl === undefined) {
    operation.artUrl = sourceArtUrl ? await rehostCampaignArtUrl(sourceArtUrl) : '';
    rememberCopy(key, operation);
  }

  // No fallback to the old sequence of independent writes. The server reads
  // the source and creates the complete target in a single SQL transaction.
  const result = await phase1Request<AtomicCopyResponse>('wgui-ext-copy-campaign', {
    campaign_id: campaignId,
    operation_id: operation.id,
    art_url: operation.artUrl,
  }, accessToken);
  if (!result?.created?.id || !Array.isArray(result.encounterNames)) {
    throw new Error('Campaign copy result could not be confirmed. Retry to recover the same operation.');
  }
  const plan = {
    ...buildCampaignCopyPlan(source, []),
    encounterCount: result.encounterNames.length,
    encounterNames: result.encounterNames,
  };
  finishCopy(key);
  return { plan, created: result.created, copiedArtUrl: result.created.meta_data?.image_url || undefined };
}

/** Stock find-campaign({ id }) for scripts and dry runs. */
export async function loadCampaignById(campaignId: number, accessToken?: string): Promise<Campaign | null> {
  return asRecordList(await phase1Request<Campaign | Campaign[]>('find-campaign', { id: campaignId }, accessToken))[0] ?? null;
}
