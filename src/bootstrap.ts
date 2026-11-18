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
