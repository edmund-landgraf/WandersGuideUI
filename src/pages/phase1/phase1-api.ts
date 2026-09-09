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
  if (envelope.status !== 'success')   throw new Error(functionName + ': ' + (envelope.message || 'request failed'));
  return envelope.data as T;
}

/**
 * Auth can leave a session without a `public_user` row. Stock create-campaign then
 * returns "User not found". Best-effort: older stacks without this endpoint still hit the
 * stock lookup next.
 */
export async function ensurePhase1PublicUser(accessToken?: string): Promise<void> {
  try {
    await phase1Request('wgui-ext-ensure-public-user', {}, accessToken);
  } catch {
    // Endpoint missing or already healthy — callers proceed to the stock write.
  }
}

type JoinResult = { character: Character; campaign: Campaign; already: boolean };

/**
 * Stock join is find-campaign({ join_key }) then update-character({ campaign_id }). The
 * membership trigger only keeps that write when a campaign_join_grant row exists, and the
 * grant is best-effort in find-campaign, so the write can silently leave campaign_id
 * unchanged while the UI reports success. Re-reading the saved row catches that.
 */
async function joinByKeyWithStockCalls(characterId: number, joinKey: string, accessToken?: string): Promise<JoinResult> {
  const campaign = asRecordList(await phase1Request<Campaign | Campaign[]>('find-campaign', { join_key: joinKey }, accessToken))[0];
  if (!campaign) throw new Error('Invalid join key. Please ask your GM for a valid key.');
  const campaignId = numericId(campaign.id);
  const character = asRecordList(
    await phase1Request<Character | Character[]>('update-character', { id: characterId, campaign_id: campaignId }, accessToken)
  )[0];
  if (!character || numericId(character.campaign_id) !== campaignId) {
    throw new Error('Could not join that campaign. Ask your GM to add the character instead.');
  }
  return { character, campaign, already: false };
}

/**
 * wgui-ext writes campaign_id with the service-role client after checking the key and the
 * character's owner. It is bind-mounted into the edge runtime rather than resident in it,
 * so fall back to the stock pair when the endpoint is not deployed.
 */
export async function joinPhase1CharacterByKey(characterId: number, joinKey: string, accessToken?: string): Promise<JoinResult> {
  try {
    return await phase1Request('wgui-ext-join-campaign', { character_id: characterId, join_key: joinKey }, accessToken);
  } catch {
    return await joinByKeyWithStockCalls(characterId, joinKey, accessToken);
  }
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
  const sessionId = userId.trim().toLowerCase();
  return new Set(
    characters
      .filter((item) => (item.user_id ?? '').trim().toLowerCase() === sessionId)
      .map((item) => numericId(item.id))
      .filter((id): id is number => id !== null)
  );
}

function combatantCharacterId(item: Encounter['combatants']['list'][number]): number | null {
  if (item.type && item.type !== 'CHARACTER') return null;
  const nested = item.data && typeof item.data === 'object' && 'id' in item.data ? item.data.id : undefined;
  return numericId(item.character) ?? numericId(nested);
}

export function encounterIncludesOwnCharacter(encounter: Encounter, characterIds: Set<number>): boolean {
  const list = encounter.combatants?.list ?? [];
  return list.some((item) => {
    const id = combatantCharacterId(item);
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

async function findCharacterList(body: Record<string, unknown>, accessToken?: string): Promise<Character[]> {
  try {
    return asRecordList(await phase1Request<Character | Character[]>('find-character', body, accessToken));
  } catch {
    return [];
  }
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

/**
 * The whole party, for the GM and for players alike.
 *
 * `find-character` is scoped by RLS to self, public and campaign-owner rows, so a player
 * calling it with a campaign_id gets back only their own PCs. wgui-ext serves the roster
 * the GM sees; the stock call remains as a fallback so the page still renders the
 * caller's own characters against a backend where the extension is not deployed yet.
 */
export async function loadPhase1CampaignPlayers(campaignId: number, userId: string, accessToken?: string): Promise<Character[]> {
  try {
    return asRecordList(
      await phase1Request<Character | Character[]>('wgui-ext-find-campaign-characters', { campaign_id: campaignId }, accessToken)
    );
  } catch {
    const [roster, mine] = await Promise.all([
      findCharacterList({ campaign_id: campaignId }, accessToken),
      findCharacterList({ user_id: userId }, accessToken),
    ]);
    const mineInCampaign = mine.filter((item) => campaignIdOf(item) === campaignId);
    return [...new Map([...roster, ...mineInCampaign].map((item) => [numericId(item.id) ?? item.id, item])).values()];
  }
}

/**
 * Campaign encounters for whoever is asking.
 *
 * Prefer wgui-ext: the `encounter` policy is owner-only, so stock `find-encounter` is
 * empty for every player, and the GM gets the identical payload there — one request path
 * feeding one view.
 *
 * The extension is bind-mounted into the edge runtime rather than resident in it, so a
 * stack brought up without the override simply does not have the endpoint. Falling back
 * to `find-encounter` keeps the GM working normally on such a stack and leaves a player
 * with an empty list, which is the pre-extension behaviour — better than error-paging
 * both roles.
 */
export async function loadPhase1CampaignEncounters(campaignId: number, accessToken?: string): Promise<Encounter[]> {
  let results: Encounter[];
  try {
    results = asRecordList(
      await phase1Request<Encounter | Encounter[]>('wgui-ext-find-encounter', { campaign_id: campaignId }, accessToken)
    );
  } catch {
    results = asRecordList(await phase1Request<Encounter | Encounter[]>('find-encounter', { campaign_id: campaignId }, accessToken));
  }
  return results.filter((item) => encounterBelongsToCampaign(item, campaignId));
}
