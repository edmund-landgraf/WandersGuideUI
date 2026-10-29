// Local copy of the three helpers connect-raw already calls.
// Upstream keeps them on wanderers-guide security/function-auth, which this
// stack does not mount, so the export worker failed to build its module graph.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Character, PublicUser } from '../_shared/content';
import { HttpError } from '../_shared/http-errors.ts';

export async function authenticateBearer(token: string, _allowAnonymous = false) {
  if (!token) {
    throw new HttpError(401, 'Sign in required.', 'AUTH_REQUIRED');
  }
  const client = createClient(
    // @ts-ignore
    Deno.env.get('SUPABASE_URL') ?? '',
    // @ts-ignore
    Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, 'Your session has expired or is invalid. Please sign in again.', 'AUTH_REQUIRED');
  }
  return data.user;
}

export async function grantedCharacterIds(
  admin: SupabaseClient<any, 'public', any>,
  publicUser: PublicUser,
  clientId: string
): Promise<number[]> {
  const { data, error } = await admin
    .from('character')
    .select('id, details')
    .eq('user_id', publicUser.user_id);
  if (error) throw new HttpError(500, 'Failed to resolve API grants.', 'GRANT_LOOKUP_FAILED');
  return ((data ?? []) as Character[])
    .filter((character) => {
      const grants = ((character as any).details?.api_clients?.client_access ?? []) as any[];
      return grants.some((grant) => grant?.clientId === clientId && `${grant?.publicUserId}` === `${publicUser.id}`);
    })
    .map((character) => character.id);
}

export function scopeBodyToGrants(body: any, granted: number[], scopeList: boolean) {
  if (!body || typeof body !== 'object') return body;
  const next = { ...body };
  if (typeof next.id === 'number') {
    if (!granted.includes(next.id)) next.id = -1;
    return next;
  }
  if (Array.isArray(next.id)) {
    next.id = next.id.filter((id: number) => granted.includes(id));
    return next;
  }
  if (scopeList) next.id = granted;
  return next;
}
