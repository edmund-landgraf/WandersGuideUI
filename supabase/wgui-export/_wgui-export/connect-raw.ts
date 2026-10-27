// Raw-file connect for wgui-export-character.
// Stock helpers.connect() always JSON-stringifies a JSend body. Export must return
// application/json (the v4 object) or application/pdf bytes. Auth is the same
// find-character path (API-key grant check, then owner JWT).
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import type { Character, JSendResponse, PublicUser } from '../_shared/content';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchData, logEvent } from '../_shared/helpers.ts';
import { HttpError, isAuthenticationError, readJsonBody } from '../_shared/http-errors.ts';
import { bucketFor, checkRateLimit, rateLimitHeaders } from '../_shared/rate-limit.ts';
// @ts-ignore
import { SignJWT } from 'npm:jose@5.9.6';
import { authenticateBearer, grantedCharacterIds, scopeBodyToGrants } from '../_shared/caller-auth.ts';

function asHttpResponse(result: JSendResponse | Response, rlHeaders: Record<string, string>): Response {
  if (result instanceof Response) {
    const headers = new Headers(result.headers);
    for (const [key, value] of Object.entries({ ...corsHeaders, ...rlHeaders })) {
      if (!headers.has(key)) headers.set(key, value);
    }
    return new Response(result.body, { status: result.status, headers });
  }
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

async function isInOwnedCampaign(
  adminClient: SupabaseClient<any, 'public', any>,
  userId: string,
  characterId: number
): Promise<boolean> {
  const { data: ch, error } = await adminClient.from('character').select('campaign_id').eq('id', characterId).maybeSingle();
  if (error) throw new HttpError(500, 'Failed to resolve campaign access.', 'GRANT_LOOKUP_FAILED');
  const campaignId = (ch as any)?.campaign_id;
  if (campaignId == null) return false;
  const { data: camp } = await adminClient.from('campaign').select('user_id').eq('id', campaignId).maybeSingle();
  return (camp as any)?.user_id === userId;
}

async function generateUserJWT(userId: string) {
  // @ts-ignore
  const JWT_SECRET = Deno.env.get('SB_JWT_SECRET') ?? Deno.env.get('JWT_SECRET');
  if (!JWT_SECRET) throw new Error('Missing SB_JWT_SECRET / JWT_SECRET');
  const key = new TextEncoder().encode(JWT_SECRET);
  return await new SignJWT({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'https://fdrjqcyjklatdrmjdnys.supabase.co/auth/v1',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

async function handleApiRouting<T>(
  apiKey: string,
  body: T,
  executeFn: (
    client: SupabaseClient<any, 'public', any>,
    body: T,
    token: string
  ) => Promise<JSendResponse | Response>,
  supportsCharacterAPI: boolean | undefined,
  rlHeaders: Record<string, string>,
  allowAnonymous = false,
  scopeCharacterList = false
): Promise<Response> {
  const adminClient = createClient(
    // @ts-ignore
    Deno.env.get('SUPABASE_URL') ?? '',
    // @ts-ignore
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: publicUsers, error: errorPublicUsers } = await adminClient
    .from('public_user')
    .select('*')
    .not('api', 'is', null)
    .contains('api', { clients: [{ api_key: apiKey }] });

  if (errorPublicUsers || !publicUsers || publicUsers.length === 0) {
    return new Response(JSON.stringify({ status: 'fail', data: { message: 'Invalid API Key' } }), {
      headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  const publicUser = publicUsers[0] as PublicUser;
  const apiClient = publicUser.api?.clients?.find((client) => client.api_key === apiKey);
  if (!apiClient) {
    return new Response(
      JSON.stringify({ status: 'fail', data: { message: 'Invalid API Key, no client found' } }),
      {
        headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' },
        status: 401,
      }
    );
  }

  const userId = publicUser.user_id;
  if (!supportsCharacterAPI && !allowAnonymous) {
    // An API key is a character-API credential, not a full session for its owner.
    return new Response(
      JSON.stringify({
        status: 'fail',
        data: { message: 'API keys can only be used with character endpoints.' },
      } satisfies JSendResponse),
      {
        headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' },
        status: 403,
      }
    );
  }
  if (supportsCharacterAPI) {
    // Only characters granted to THIS client and owned by the key's user.
    const granted = await grantedCharacterIds(adminClient, publicUser, apiClient.id);
    // GM access: a PC that joined a campaign owned by the key's user may be exported by that
    // user's key, even though another player owns it. Only a single numeric id qualifies, and
    // only while the PC's campaign_id points at a campaign this user owns.
    const requestedId = (body as any)?.id;
    if (typeof requestedId === 'number' && !granted.includes(requestedId)
      && (await isInOwnedCampaign(adminClient, publicUser.user_id, requestedId))) {
      granted.push(requestedId);
    }
    body = scopeBodyToGrants(body, granted, !!scopeCharacterList);
  }

  const { data: userData, error: errorUser } = await adminClient.auth.admin.getUserById(userId);
  if (errorUser || !userData) {
    return new Response(JSON.stringify({ status: 'error', message: 'Failed to retrieve user data' }), {
      headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }

  const limitedUserToken = await generateUserJWT(userData.user.id);
  const supabaseClient = createClient(
    // @ts-ignore
    Deno.env.get('SUPABASE_URL') ?? '',
    // @ts-ignore
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${limitedUserToken}` } } }
  );
  return asHttpResponse(await executeFn(supabaseClient, body, limitedUserToken), rlHeaders);
}

export async function connect<T = Record<string, any>>(
  req: Request,
  executeFn: (
    client: SupabaseClient<any, 'public', any>,
    body: T,
    token: string
  ) => Promise<JSendResponse | Response>,
  options?: { supportsCharacterAPI?: boolean; bypassAuth?: boolean; maxBodyBytes?: number }
) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const rawAuthHeader = req.headers.get('Authorization')?.trim() ?? '';
    const token = rawAuthHeader.replace('Bearer ', '').trim();
    const is36 = token.length === 36 && !options?.bypassAuth;
    const looksLikeJwt = token.split('.').length === 3;
    if (token && !is36 && !looksLikeJwt && !options?.bypassAuth) {
      return new Response(
        JSON.stringify({
          status: 'fail',
          data: {
            message:
              'Invalid token format. Expected a 36-character API key (UUID) or a JWT. See https://docs.wanderersguide.app/api-reference/authentication.',
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? '')
      .split(',')[0]
      .trim();
    const { bucket, limit } = bucketFor({ token, is36, bypassAuth: options?.bypassAuth, ip });
    const rl = checkRateLimit(bucket, limit);
    const rlHeaders = rateLimitHeaders(rl);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({
          status: 'fail',
          data: { message: `Rate limit exceeded. Try again in ${rl.resetSeconds}s.` },
        }),
        { headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    const body = (await readJsonBody(req, options?.maxBodyBytes ?? 8 * 1024 * 1024)) as T;
    if (is36) {
      return await handleApiRouting(token, body, executeFn, options?.supportsCharacterAPI, rlHeaders);
    }

    if (!options?.bypassAuth) await authenticateBearer(token, false);
    const supabaseClient = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      options?.bypassAuth ? {} : { global: { headers: { Authorization: rawAuthHeader } } }
    );
    return asHttpResponse(await executeFn(supabaseClient, body, token), rlHeaders);
  } catch (error) {
    if (error instanceof HttpError || isAuthenticationError(error)) {
      const failure =
        error instanceof HttpError
          ? error
          : new HttpError(401, 'Your session has expired or is invalid. Please sign in again.', 'AUTH_REQUIRED');
      if (failure.status >= 500) {
        logEvent('error', 'wgui-export-character', 'request_failed', {
          code: failure.code,
          status: failure.status,
        });
      }
      return new Response(
        JSON.stringify({
          status: failure.status >= 500 ? 'error' : 'fail',
          ...(failure.status >= 500
            ? { message: failure.message, code: failure.code }
            : { data: { message: failure.message, code: failure.code } }),
        }),
        { status: failure.status, headers: { ...corsHeaders, ...failure.headers, 'Content-Type': 'application/json' } }
      );
    }
    logEvent('error', 'wgui-export-character', 'unhandled_error', {
      message: (error as any)?.message ?? String(error),
    });
    console.error(error);
    return new Response(JSON.stringify({ status: 'fail', data: error }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
}
