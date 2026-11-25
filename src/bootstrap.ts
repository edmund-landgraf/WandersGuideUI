// auth-js clears the hash before it writes the session. A reload in that gap
// (the PWA serves a fresh document) drops a login GoTrue already accepted.
// Store the session first so that reload still finds it. The client still
// reads the hash and replaces this with the full user.
function keepImplicitSessionAcrossReload() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const expires_at = Number(params.get('expires_at'));
  if (!access_token || !refresh_token || !Number.isFinite(expires_at) || expires_at <= 0) return;
  const body = (access_token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
  let sub = '';
  let email = '';
  try {
    const payload = JSON.parse(atob(body + '='.repeat((4 - (body.length % 4)) % 4))) as { sub?: string; email?: string };
    sub = payload.sub ?? '';
    email = payload.email ?? '';
  } catch {
    return;
  }
  if (!sub) return;
  const configured = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL;
  let projectRef = 'amba';
  try {
    if (configured) projectRef = new URL(configured).hostname.split('.')[0] || projectRef;
  } catch {
    /* production ref */
  }
  const expires_in = Number(params.get('expires_in'));
  const session = {
    access_token,
    refresh_token,
    token_type: params.get('token_type') || 'bearer',
    expires_in: Number.isFinite(expires_in) ? expires_in : expires_at - Math.round(Date.now() / 1000),
    expires_at,
    user: {
      id: sub,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  };
  try {
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(session));
  } catch {
    /* the auth client still parses the hash */
  }
}

keepImplicitSessionAcrossReload();

const search = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
const isAuthCallback = ['code', 'access_token', 'error', 'error_description', 'token_hash'].some(
  (key) => search.has(key) || hash.has(key)
);
const bootEntry = location.pathname.startsWith('/updates')
  ? 'updates'
  : location.pathname.startsWith('/owlbear/auth')
    ? 'owlbear-auth'
    : location.pathname.startsWith('/shops')
      ? 'shops'
      : location.pathname.startsWith('/phase0')
        ? 'phase0'
        : location.pathname.startsWith('/phase1') ||
            location.pathname.startsWith('/tactics') ||
            location.pathname.startsWith('/sheet') ||
            location.pathname.startsWith('/builder') ||
            location.pathname.startsWith('/stat-block') ||
            isAuthCallback
          ? 'phase1'
          : 'launcher';
const bootStarted = performance.now();
console.info('[wgui] boot', {
  path: location.pathname,
  entry: bootEntry,
  serviceWorker: navigator.serviceWorker?.controller?.scriptURL ?? null,
});
const application = bootEntry === 'updates'
  ? import('./pages/launcher/updates.tsx')
  : bootEntry === 'owlbear-auth'
  ? import('./pages/OwlbearAuthPage.tsx')
    : bootEntry === 'shops'
    ? import('./pages/launcher/shops.tsx')
    : bootEntry === 'phase0'
      ? import('./pages/phase0/main.tsx')
      : bootEntry === 'phase1'
        ? import('./pages/phase1/main.tsx')
        : import('./pages/launcher/main.tsx');

void application.then(() => {
  console.info('[wgui] boot ready', { entry: bootEntry, ms: Math.round(performance.now() - bootStarted) });
});

application.catch((error: unknown) => {
  const root = document.getElementById('root');
  const message =
    error instanceof Error ? error.stack || error.message : String(error);

  if (root) {
    root.textContent = `Unable to start Wanderer's Guide.\n\n${message}`;
    root.style.whiteSpace = 'pre-wrap';
    root.style.color = '#fecaca';
    root.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  }

  console.error('Failed to load application entry', error);
});
