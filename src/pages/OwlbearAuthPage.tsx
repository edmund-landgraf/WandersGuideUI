import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from '../supabase-client';

const MESSAGE_TYPE = 'wgui-owlbear-auth';

function allowedTarget(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value) return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function OwlbearAuth() {
  const [status, setStatus] = useState("Checking your Wanderer's Guide session…");

  useEffect(() => {
    const targetOrigin = allowedTarget(new URLSearchParams(window.location.search).get('targetOrigin'));
    if (!targetOrigin) {
      setStatus('Invalid Owlbear extension origin.');
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const session = data.session;
      if (!session?.access_token || !session.refresh_token) {
        setStatus("Log in to Wanderer's Guide in this browser, then return to Owlbear and try again.");
        return;
      }

      if (window.opener) {
        window.opener.postMessage(
          {
            type: MESSAGE_TYPE,
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
          },
          targetOrigin
        );
        window.close();
        return;
      }

      setStatus('Session found. Return to Owlbear.');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <p style={{ fontFamily: 'sans-serif', margin: 24 }}>{status}</p>;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <OwlbearAuth />
  </StrictMode>
);
