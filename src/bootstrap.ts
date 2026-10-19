const search = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
const isAuthCallback = ['code', 'access_token', 'error', 'error_description', 'token_hash'].some(
  (key) => search.has(key) || hash.has(key)
);
const application = location.pathname.startsWith('/updates')
  ? import('./pages/launcher/updates.tsx')
  : location.pathname.startsWith('/owlbear/auth')
  ? import('./pages/OwlbearAuthPage.tsx')
  : location.pathname.startsWith('/shops')
    ? import('./pages/launcher/shops.tsx')
    : location.pathname.startsWith('/phase0')
      ? import('./pages/phase0/main.tsx')
      : location.pathname.startsWith('/phase1') ||
          location.pathname.startsWith('/tactics') ||
          location.pathname.startsWith('/sheet') ||
          location.pathname.startsWith('/builder') ||
          location.pathname.startsWith('/stat-block') ||
          isAuthCallback
        ? import('./pages/phase1/main.tsx')
        : import('./pages/launcher/main.tsx');

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
