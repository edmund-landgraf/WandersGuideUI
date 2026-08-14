import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { consumeOAuthReturnPath } from './campaign-auth';
import { supabase } from '../supabase-client';

export function useAuthSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      mounted = false;
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
