// Shared authorization for the wgui-ext-* endpoints.
//
// These endpoints exist because campaign play needs a read the stock API cannot serve:
// `encounter` RLS is owner-only (`user_id = auth.uid()`), so a player whose PC the GM
// added to a fight sees nothing, and `character` SELECT covers self/public/admin/campaign
// owner but not fellow players, so allied combatants would render from stale
// `combatant.data`. Rather than widen either policy — which would also open PostgREST
// and change the original app's behavior — the carve-out authorizes the caller
// explicitly and then reads with a service-role client.
//
// This whole directory is bind-mounted into the edge runtime at
// /home/deno/functions/_wgui-ext, so nothing lives in the wanderers-guide checkout. The
// `../_shared/*` imports below resolve to that project's real modules inside the
// container. See docs/player-encounter-visibility-change.md.

import { SupabaseClient } from '@supabase/supabase-js';
import type { Campaign, Character } from '../_shared/content';
import { fetchData } from '../_shared/helpers.ts';
import { HttpError, isAuthenticationError } from '../_shared/http-errors.ts';

/**
 * `Combatant` is referenced by the Encounter type in content.d.ts but never declared
 * there, so the fields we match on are described locally. Mirrors CombatantSchema in
 * frontend/src/schemas/content.ts: a CHARACTER combatant carries the character id on
 * `character`, and a snapshot of the sheet on `data`.
 */
interface CombatantLike {
  type?: string;
  character?: number | string | null;
  data?: { id?: number | string | null } | null;
}

export interface EncounterLike {
  id: number;
  campaign_id?: number | null;
  combatants?: { list?: CombatantLike[] | null } | null;
}

/** What the caller is allowed to see in one campaign. */
export interface CampaignAccess {
  userId: string;
  campaign: Campaign;
  isGm: boolean;
  /** The caller's own character ids in this campaign. Empty for a GM playing no PC. */
  characterIds: Set<number>;
}

function toId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The authenticated caller's user id.
 *
 * `verify_jwt` cannot be relied on: the self-hosted stack runs the edge runtime with
 * VERIFY_JWT=false and kong's functions route carries only the cors plugin (unlike
 * rest-v1, which has key-auth + acl), so an anonymous POST reaches the handler. Every
 * wgui-ext endpoint therefore establishes identity itself.
 */
export async function requireCallerId(
  client: SupabaseClient<any, 'public', any>,
  token: string
): Promise<string> {
  const unauthenticated = new HttpError(401, 'Sign in to view this campaign.', 'AUTH_REQUIRED');
  if (!token) throw unauthenticated;

  const {
    data: { user },
    error,
  } = await client.auth.getUser(token);

  if (error && isAuthenticationError(error)) throw error;
  // Only a genuine upstream failure is a 503. A rejected or session-less token means the
  // caller is not signed in, which is a 401 — not "try again later".
  if (error && ((error as { status?: number }).status ?? 0) >= 500) {
    throw new HttpError(503, 'Authentication is temporarily unavailable.', 'AUTH_UNAVAILABLE');
  }
  if (
    error ||
    !user ||
    ('is_anonymous' in user && (user as { is_anonymous?: boolean }).is_anonymous === true)
  ) {
    throw unauthenticated;
  }
  return user.id;
}

/**
 * Authorize the caller against one campaign, or throw.
 *
 * A caller is the GM (owns the campaign) or a player (owns at least one character whose
 * campaign_id is this campaign). Knowing a campaign id is never sufficient: the
 * character_campaign_membership trigger from migration 20260718120000 guarantees that
 * column was earned through a join grant, which is what makes it usable as membership.
 *
 * A campaign that does not exist and one the caller has no part in return the same
 * failure, so this cannot be used to probe for campaign ids.
 */
export async function authorizeCampaign(
  client: SupabaseClient<any, 'public', any>,
  admin: SupabaseClient<any, 'public', any>,
  token: string,
  campaignId: number
): Promise<CampaignAccess> {
  const userId = await requireCallerId(client, token);

  const campaigns = await fetchData<Campaign>(admin, 'campaign', [
    { column: 'id', value: campaignId },
  ]);
  const campaign = campaigns[0];
  if (!campaign) {
    throw new HttpError(403, 'You do not have access to this campaign.', 'CAMPAIGN_FORBIDDEN');
  }

  const characters = await fetchData<Character>(admin, 'character', [
    { column: 'user_id', value: userId },
    { column: 'campaign_id', value: campaignId },
  ]);
  const characterIds = new Set(
    characters.map((character) => toId(character.id)).filter((id): id is number => id !== null)
  );

  const isGm = campaign.user_id === userId;
  if (!isGm && characterIds.size === 0) {
    throw new HttpError(403, 'You do not have access to this campaign.', 'CAMPAIGN_FORBIDDEN');
  }

  // `campaign` still carries join_key (it was read with the service-role client). It is
  // for the caller's own authorization decisions — never put it in a response body.
  return { userId, campaign, isGm, characterIds };
}

/** The character id a combatant refers to, from either the id field or the sheet snapshot. */
export function combatantCharacterId(combatant: CombatantLike): number | null {
  if (combatant.type && combatant.type !== 'CHARACTER') return null;
  return toId(combatant.character) ?? toId(combatant.data?.id);
}

/** True when any CHARACTER combatant is one of the given characters. */
export function encounterIncludesCharacter(
  encounter: EncounterLike,
  characterIds: Set<number>
): boolean {
  const list = encounter.combatants?.list ?? [];
  return list.some((combatant) => {
    const id = combatantCharacterId(combatant);
    return id !== null && characterIds.has(id);
  });
}
