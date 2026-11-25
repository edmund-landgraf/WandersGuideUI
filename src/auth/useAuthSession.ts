import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { consumeOAuthReturnPath, isOAuthReturnUrl } from './campaign-auth';
import { recordUserLogin } from './user-manager';
import { supabase } from '../supabase-client';

export function useAuthSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    const oauthReturn = isOAuthReturnUrl();

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        setSession(data.session);
        recordUserLogin(data.session.user.id, data.session.user.last_sign_in_at);
        return;
      }
      // Email sign-in never hits this branch with an empty session. OAuth can:
      // getSession() may run before the redirect code or hash is exchanged, so
      // showing the login form here throws away a session GoTrue already issued.
      if (!oauthReturn) setSession(null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT' || next) {
        setSession(next);
        recordUserLogin(next?.user.id, next?.user.last_sign_in_at);
      }
    });

    const stuckOAuthTimer = oauthReturn
      ? window.setTimeout(() => {
          if (!mounted) return;
          setSession((current) => (current === undefined ? null : current));
        }, 15_000)
      : undefined;

    return () => {
      mounted = false;
      if (stuckOAuthTimer !== undefined) window.clearTimeout(stuckOAuthTimer);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    if (window.location.pathname === '/') return;
    const next = consumeOAuthReturnPath();
    if (!next) return;
    const current = `${window.location.pathname}${window.location.search}`;
    if (next !== current && next.startsWith('/')) {
      window.location.replace(next);
    }
  }, [session]);

  return session;
}
