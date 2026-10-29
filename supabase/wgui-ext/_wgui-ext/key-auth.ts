// Key-scoped caller resolution for the wgui-ext-*-key-* endpoints (Foundry import, etc).
//
// These endpoints do their own auth instead of going through helpers.connect(): the stock
// connect() swaps an API key for a minted owner JWT before the handler runs, which loses
// the client id and so the grant scope. Here an API key stays an API key.
//
//   Authorization: Bearer <36-char API key>  -> characters granted to that client
//                                               (details.api_clients.client_access) AND
//                                               owned by the key's user
//   Authorization: Bearer <user session JWT> -> the caller's own characters
//   anything else / nothing                  -> 401
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Character, PublicUser } from '../_shared/content';
import { corsHeaders } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/helpers.ts';
import { HttpError, readJsonBody } from '../_shared/http-errors.ts';
import { requireCallerId } from './shared.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface KeyCaller {
  kind: 'api_key' | 'user';
  userId: string;
  publicUserId: number | null;
  clientId: string | null;
  /** Character ids this caller may see, ascending. */
  characterIds: number[];
}

const unauthorized = () =>
  new HttpError(401, 'Authentication required. Send an API key or a user session JWT.', 'AUTH_REQUIRED');

function isGrantedTo(character: Character, publicUserId: number, clientId: string): boolean {
  const grants = ((character as any).details?.api_clients?.client_access ?? []) as any[];
  return grants.some((g) => g?.clientId === clientId && `${g?.publicUserId}` === `${publicUserId}`);
}

export async function resolveKeyCaller(
  req: Request,
  admin: SupabaseClient<any, 'public', any>
): Promise<KeyCaller> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw unauthorized();

  if (UUID.test(token)) {
    const { data, error } = await admin
      .from('public_user')
      .select('id, user_id, api')
      .not('api', 'is', null)
      .contains('api', { clients: [{ api_key: token }] });
    if (error) throw new HttpError(503, 'Could not verify the API key.', 'AUTH_UNAVAILABLE');
    const publicUser = (data ?? [])[0] as PublicUser | undefined;
    const client = publicUser?.api?.clients?.find((c) => c.api_key === token);
    if (!publicUser || !client) throw new HttpError(401, 'Invalid API key.', 'INVALID_API_KEY');

    const { data: rows, error: rowsError } = await admin
      .from('character')
      .select('id, user_id, details')
      .eq('user_id', publicUser.user_id);
    if (rowsError) throw new HttpError(500, 'Failed to resolve API grants.', 'GRANT_LOOKUP_FAILED');
    // An API key is account-wide: every character the key's user owns (no per-character grant filter).
    const characterIds = ((rows ?? []) as Character[])
      .map((c) => c.id)
      .sort((a, b) => a - b);
    return { kind: 'api_key', userId: publicUser.user_id, publicUserId: publicUser.id, clientId: client.id, characterIds };
  }

  if (token.split('.').length !== 3) throw unauthorized();
  const anon = createClient(
    // @ts-ignore
    Deno.env.get('SUPABASE_URL') ?? '',
    // @ts-ignore
    Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  );
  const userId = await requireCallerId(anon, token);
  const { data: rows, error } = await admin.from('character').select('id').eq('user_id', userId);
  if (error) throw new HttpError(500, 'Failed to load characters.', 'CHARACTER_LOOKUP_FAILED');
  const { data: pu } = await admin.from('public_user').select('id').eq('user_id', userId).maybeSingle();
  return {
    kind: 'user',
    userId,
    publicUserId: (pu as any)?.id ?? null,
    clientId: null,
    characterIds: ((rows ?? []) as { id: number }[]).map((r) => r.id).sort((a, b) => a - b),
  };
}

/** The summary row both key-scoped endpoints return. Never the full sheet. */
export interface KeyCharacterSummary {
  id: number;
  name: string;
  level: number | null;
  class: string | null;
  ancestry: string | null;
  campaign_id: number | null;
  image_url: string | null;
  updated_at: string | null;
}

export async function loadCharacterSummaries(
  admin: SupabaseClient<any, 'public', any>,
  ids: number[]
): Promise<KeyCharacterSummary[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from('character')
    .select('id, name, level, campaign_id, updated_at, details')
    .in('id', ids);
  if (error) throw new HttpError(500, 'Failed to load characters.', 'CHARACTER_LOOKUP_FAILED');
  return ((data ?? []) as any[])
    .map((c) => ({
      id: c.id,
      name: c.name ?? '',
      level: c.level ?? null,
      class: c.details?.class?.name ?? null,
      ancestry: c.details?.ancestry?.name ?? null,
      campaign_id: c.campaign_id ?? null,
      image_url: c.details?.image_url ?? c.details?.info?.image_url ?? null,
      updated_at: c.updated_at ?? null,
    }))
    .sort((a, b) => a.id - b.id);
}

/**
 * GM access (Foundry "Import PCs from one campaign"): the caller's user owns the campaign.
 * A GM may read every PC whose campaign_id is that campaign (players attach PCs through the
 * join key), and nothing else of those players. Ownership is checked with the service role.
 */
export async function ownedCampaigns(
  admin: SupabaseClient<any, 'public', any>,
  userId: string
): Promise<{ id: number; name: string }[]> {
  const { data, error } = await admin.from('campaign').select('id, name').eq('user_id', userId);
  if (error) throw new HttpError(500, 'Failed to load campaigns.', 'CAMPAIGN_LOOKUP_FAILED');
  return ((data ?? []) as { id: number; name: string }[]).sort((a, b) => a.id - b.id);
}

export async function campaignCharacterIds(
  admin: SupabaseClient<any, 'public', any>,
  campaignIds: number[]
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>(campaignIds.map((id) => [id, []]));
  if (campaignIds.length === 0) return out;
  const { data, error } = await admin.from('character').select('id, campaign_id').in('campaign_id', campaignIds);
  if (error) throw new HttpError(500, 'Failed to load campaign characters.', 'CHARACTER_LOOKUP_FAILED');
  for (const r of (data ?? []) as { id: number; campaign_id: number }[]) out.get(r.campaign_id)?.push(r.id);
  for (const ids of out.values()) ids.sort((a, b) => a - b);
  return out;
}

/** Display names of the players who own these characters (GM view only). */
export async function playerNames(
  admin: SupabaseClient<any, 'public', any>,
  characterIds: number[]
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (characterIds.length === 0) return out;
  const { data: chars } = await admin.from('character').select('id, user_id').in('id', characterIds);
  const userIds = [...new Set(((chars ?? []) as any[]).map((c) => c.user_id))];
  const { data: users } = await admin.from('public_user').select('user_id, display_name').in('user_id', userIds);
  const byUser = new Map(((users ?? []) as any[]).map((u) => [u.user_id, u.display_name ?? null]));
  for (const c of (chars ?? []) as any[]) out.set(c.id, byUser.get(c.user_id) ?? null);
  return out;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Request wrapper: CORS, JSON body, caller resolution, JSend errors. */
export async function serveKeyScoped<T>(
  req: Request,
  name: string,
  handler: (caller: KeyCaller, body: T, admin: SupabaseClient<any, 'public', any>) => Promise<unknown>
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createServiceClient();
    const caller = await resolveKeyCaller(req, admin);
    const body = ((await readJsonBody(req, 64 * 1024)) ?? {}) as T;
    return json(200, { status: 'success', data: await handler(caller, body, admin) });
  } catch (error) {
    if (error instanceof HttpError) {
      return json(error.status, error.status >= 500
        ? { status: 'error', message: error.message, code: error.code }
        : { status: 'fail', data: { message: error.message, code: error.code } });
    }
    console.error(name, error);
    return json(500, { status: 'error', message: 'Unexpected error.' });
  }
}
