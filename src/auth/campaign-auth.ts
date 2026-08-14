import { supabase } from '../supabase-client';

export type OAuthProvider = 'google' | 'discord' | 'github';

/** OAuth providers enabled in the campaign UI. Add more as GoTrue is configured. */
export const ENABLED_OAUTH_PROVIDERS: OAuthProvider[] = ['google'];

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

export async function signOut() {
  return supabase.auth.signOut();
}

export function parseOAuthReturnError(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get('error_description') ?? params.get('error');
}
