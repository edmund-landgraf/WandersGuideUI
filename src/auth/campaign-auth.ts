import { supabase } from '../supabase-client';

export type OAuthProvider = 'google' | 'discord' | 'github';

/** OAuth providers enabled in the campaign UI. Add more as GoTrue is configured. */
export const ENABLED_OAUTH_PROVIDERS: OAuthProvider[] = ['google'];

export function campaignRedirectTo() {
  return `${window.location.origin}${window.location.pathname}`;
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
