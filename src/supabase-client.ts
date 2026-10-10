import { createClient } from '@supabase/supabase-js';

/**
 * The single shared Supabase client for the entire app.
 *
 * There must be exactly ONE client: each `createClient()` runs its own token
 * auto-refresh loop and keeps its own in-memory session. When the app had two
 * (main.tsx and request-manager.ts), the second client could hold a stale
 * access token after the first refreshed (or vice versa), and auth events from
 * one never reached listeners on the other — so a session that died from
 * inactivity was noticed by one client while the rest of the app kept acting
 * logged in with dead credentials.
 */
const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

/**
 * Local GoTrue/Kong answers `Access-Control-Allow-Origin: *` together with
 * `Access-Control-Allow-Credentials: true`. Firefox rejects that pair, so every
 * call from :5194 to :8000 fails. In dev, talk to the Vite origin and let the
 * dev server proxy those paths to Kong.
 */
export function browserSupabaseUrl(configured: string | undefined, pageOrigin?: string) {
  if (!configured) return configured;
  if (!import.meta.env.DEV || !pageOrigin) return configured;
  try {
    const api = new URL(configured);
    const localApi = api.hostname === 'localhost' || api.hostname === '127.0.0.1';
    if (!localApi || api.port !== '8000') return configured;
    const page = new URL(pageOrigin);
    if (page.origin === api.origin) return configured;
    return page.origin;
  } catch {
    return configured;
  }
}

const supabaseUrl = browserSupabaseUrl(
  configuredSupabaseUrl,
  typeof window === 'undefined' ? undefined : window.location.origin
);

function isUnsetEnv(value: string | undefined) {
  return !value || /[<>]|API_URL|ANON_KEY/.test(value);
}

if (isUnsetEnv(supabaseUrl) || isUnsetEnv(supabaseKey)) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY. Copy .env.local.template to .env.local, replace the placeholders, and restart the Vite dev server.'
  );
}

const resolvedSupabaseUrl: string = supabaseUrl;
const resolvedSupabaseKey: string = supabaseKey;

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseKey, {
  auth: {
    // Chrome incognito can leave navigator.locks stuck. auth-js then treats a live
    // session as signed-out inside later requests, and find-campaign returns [].
    lock: async (_name, _acquireTimeout, fn) => await fn(),
  },
});

/** User JWT for edge functions. The SDK can invoke with the anon key right after OAuth, before storage catches up. */
export async function supabaseInvokeHeaders(accessToken?: string): Promise<Record<string, string> | undefined> {
  const token = accessToken ?? (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return undefined;
  return { Authorization: `Bearer ${token}` };
}
