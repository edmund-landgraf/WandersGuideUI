import type { Campaign, Character, Encounter } from '@schemas/content';
import type { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase, supabaseInvokeHeaders } from '../../supabase-client';

type ApiEnvelope<T> = { status: 'success' | 'fail' | 'error'; data?: T; message?: string };

export async function phase1Request<T>(functionName: string, body: Record<string, unknown>, accessToken?: string): Promise<T> {
  const headers = await supabaseInvokeHeaders(accessToken);
  const { data, error } = await supabase.functions.invoke(functionName, { body, headers });
  if (error) {
    let detail = error.message || 'Request to ' + functionName + ' failed';
    const context = (error as FunctionsHttpError).context;
    if (context) {
      try {
        const payload = await context.clone().json();
        detail = payload?.message || payload?.data?.message || detail;
      } catch {
        // Preserve the SDK message when the response body is not JSON.
      }
    }
    throw new Error(functionName + ': ' + detail);
  }
  const envelope = data as ApiEnvelope<T> | null;
  if (!envelope) throw new Error(functionName + ': empty response');
  if (envelope.status !== 'success') throw new Error(functionName + ': ' + (envelope.message || 'request failed'));
  return envelope.data as T;
}

export function asRecordList<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function numericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function campaignIdOf(character: Character): number | null {
  return numericId(character.campaign_id);
}

export function encounterBelongsToCampaign(encounter: Encounter, campaignId: number): boolean {
  return numericId(encounter.campaign_id) === campaignId;
}

export function ownCharacterIds(characters: Character[], userId: string): Set<number> {
  return new Set(
    characters
      .filter((item) => item.user_id === userId)
      .map((item) => numericId(item.id))
      .filter((id): id is number => id !== null)
  );
}

export function encounterIncludesOwnCharacter(encounter: Encounter, characterIds: Set<number>): boolean {
  const list = encounter.combatants?.list ?? [];
  return list.some((item) => {
    if (item.type !== 'CHARACTER') return false;
    const id = numericId(item.character) ?? numericId(item.data && 'id' in item.data ? item.data.id : undefined);
    return id != null && characterIds.has(id);
  });
}

export function visibleCampaignEncounters(
  encounters: Encounter[],
  campaignId: number,
  isGm: boolean,
  characterIds: Set<number>
): Encounter[] {
  const forCampaign = encounters.filter((encounter) => encounterBelongsToCampaign(encounter, campaignId));
  if (isGm) return forCampaign;
  return forCampaign.filter((encounter) => encounterIncludesOwnCharacter(encounter, characterIds));
}

async function findEncounterList(body: Record<string, unknown>, accessToken?: string): Promise<Encounter[]> {
  return asRecordList(await phase1Request<Encounter | Encounter[]>('find-encounter', body, accessToken));
}

export async function loadPhase1Campaigns(userId: string, accessToken?: string): Promise<Campaign[]> {
  const owned = asRecordList(await phase1Request<Campaign | Campaign[]>('find-campaign', { user_id: userId }, accessToken));
  const characters = asRecordList(await phase1Request<Character | Character[]>('find-character', { user_id: userId }, accessToken));
  const joinedIds = [...new Set(characters.map(campaignIdOf).filter((id): id is number => id !== null))];
  const joined = (
    await Promise.all(
      joinedIds.map(async (id) => {
        try {
          return asRecordList(await phase1Request<Campaign | Campaign[]>('find-campaign', { id }, accessToken));
        } catch {
          return [];
        }
      })
    )
  ).flat();
  return [...new Map([...owned, ...joined].map((campaign) => [campaign.id, campaign])).values()];
}

export async function loadPhase1CampaignPlayers(campaignId: number, userId: string, accessToken?: string): Promise<Character[]> {
  const [roster, mine] = await Promise.all([
    (async () => {
      try {
        return asRecordList(await phase1Request<Character | Character[]>('find-character', { campaign_id: campaignId }, accessToken));
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        return asRecordList(await phase1Request<Character | Character[]>('find-character', { user_id: userId }, accessToken));
      } catch {
        return [];
      }
    })(),
  ]);
  const mineInCampaign = mine.filter((item) => campaignIdOf(item) === campaignId);
  return [...new Map([...roster, ...mineInCampaign].map((item) => [numericId(item.id) ?? item.id, item])).values()];
}

export async function loadPhase1CampaignEncounters(
  campaignId: number,
  campaignOwnerId: string | null | undefined,
  accessToken?: string
): Promise<Encounter[]> {
  let byCampaign: Encounter[] = [];
  let campaignError: unknown;
  try {
    byCampaign = (await findEncounterList({ campaign_id: campaignId }, accessToken)).filter((item) =>
      encounterBelongsToCampaign(item, campaignId)
    );
  } catch (error) {
    campaignError = error;
  }
  if (byCampaign.length > 0) return byCampaign;
  if (campaignOwnerId) {
    try {
      const byOwner = (await findEncounterList({ user_id: campaignOwnerId }, accessToken)).filter((item) =>
        encounterBelongsToCampaign(item, campaignId)
      );
      if (byOwner.length > 0) return byOwner;
    } catch {
      // Owner-id lookup is a fallback; keep the campaign_id error if that also failed.
    }
  }
  if (campaignError) throw campaignError;
  return [];
}
