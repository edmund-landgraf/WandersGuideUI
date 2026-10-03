import { supabase } from '../supabase-client';

export type OAuthProvider = 'google' | 'discord' | 'github';

/** OAuth providers enabled in the campaign UI. Add more as GoTrue is configured. */
export const ENABLED_OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'github', 'discord'];

const OAUTH_NEXT_KEY = 'wg_oauth_next';

export function campaignRedirectTo() {
  const next = `${window.location.pathname}${window.location.search}`;
  if (next && next !== '/') {
    sessionStorage.setItem(OAUTH_NEXT_KEY, next);
  }
  // Origin only: GoTrue often allow-lists `http://localhost:5194` exactly and
  // rejects `/phase1`, then falls back to the production Site URL.
  return window.location.origin;
}

export function peekOAuthReturnPath(): string | null {
  return sessionStorage.getItem(OAUTH_NEXT_KEY);
}

export function consumeOAuthReturnPath(): string | null {
  const next = peekOAuthReturnPath();
  if (!next) return null;
  sessionStorage.removeItem(OAUTH_NEXT_KEY);
  return next;
}

export async function signInWithOAuthProvider(
  provider: OAuthProvider,
  redirectTo = campaignRedirectTo()
) {
  return supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
}

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

function isLogoutRequest(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/logout');
}

/**
 * Drop the browser session even when GoTrue no longer has it.
 *
 * auth-js still POSTs /logout before it clears storage, including for
 * scope "local". On this stack that call 403s ("Session not found") or
 * fails another way, and any result other than 401/403/404 aborts the
 * clear — the header stays signed in. Answer the logout request locally
 * so the client always removes the session and fires SIGNED_OUT.
 */
export async function signOut() {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isLogoutRequest(input)) {
      return new Response(null, { status: 204 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    return await supabase.auth.signOut({ scope: 'local' });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function parseOAuthReturnError(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get('error_description') ?? params.get('error');
}
