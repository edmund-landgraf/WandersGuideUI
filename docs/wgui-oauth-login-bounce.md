# wgui OAuth returns to the login page

Google, GitHub, and Discord all signed the user in, then `https://wgui.wandersguide.site/` showed the login page again. The providers were fine. The browser threw the new session away.

Incident date: 2026-11-21. Host: `wgui.wandersguide.site` (PM2 `wgui`). Auth API: `https://amba.wandersguide.site` (`wanderers-guide-auth-1`).

## What you saw

Click Google, GitHub, or Discord on the login page. The provider succeeds. The address bar comes back to `https://wgui.wandersguide.site/#` and the site is on the login screen.

Email/password still worked during the same window.

## What the server actually did

GoTrue allow-list already includes `https://wgui.wandersguide.site` and `https://wgui.wandersguide.site/**`. `SITE_URL` is `https://amba.wandersguide.site`. That was not the miss.

From `wanderers-guide-auth-1` around 22:28–22:29 UTC, each attempt from `wgui` did this:

1. `GET /authorize` → 302 to the provider (referer `https://wgui.wandersguide.site`).
2. `GET /callback` → login recorded (`provider: google`, then `github`) for the same account.
3. `GET /user` → **200**, referer `https://wgui.wandersguide.site/`.

The access token reached the page and was valid for about a second. Nothing in those lines is a redirect rejection or a provider error. Discord was the same client path; it was not tried in that log slice, but it uses the same return.

`/auth/v1/callback` on amba still reaches Kong (a bare callback is HTTP 400 JSON, not the SPA). This is not the amba service-worker incident in `docs/amba-oauth-pwa-incident.md`.

## Why the page went back to login

`src/supabase-client.ts` replaced the auth lock with a no-op:

```ts
lock: async (_name, _acquireTimeout, fn) => await fn()
```

That was there so a stuck `navigator.locks` in Chrome incognito would not make a live session look signed out. It also removed the only thing that kept auth startup single-file.

On return, GoTrue puts the session in the URL hash (`/#access_token=...`). Two calls start together (`getSession` in `App.tsx`, and anything else that touches auth, including `getUser`). With the lock skipped they both initialize:

- One reads the hash, stores the session, and calls `/user` (the 200 above).
- The other finds the hash already consumed and storage not written yet, and stores “signed out” over the login.

The session atom stays empty. Guarded routes (`AuthRouteWrapper`) send the browser to `/login`. The hash is gone, so a refresh cannot recover it.

## Fix

1. **`processLock`** (`src/supabase-client.ts`) — queues auth-js work in one tab so two `getSession` calls cannot fight over the OAuth redirect.

2. **`flowType: 'pkce'`** — social login returns `?code=` instead of `#access_token=`, which survives reloads and is easier to parse reliably.

3. **`useAuthSession`** — on an OAuth return URL, do not treat a transient empty `getSession()` as “signed out”; wait for `INITIAL_SESSION` / `SIGNED_IN`.

Email/password still works when OAuth fails because `signInWithPassword` never leaves the page and never depends on the URL hash.

```ts
import { processLock } from '@supabase/auth-js';

lock: processLock,
```

## What was deployed

The change is in the local working tree and was copied to `/home/administrator/node-sites/WandersGuideUI/src/supabase-client.ts` on the VPS. It is **not committed**. A later `git checkout` or `git pull` on that tree can put the no-op lock back.

Build and restart completed 2026-11-21 22:38 UTC:

- `npm run build` (tsc + vite) succeeded
- `ln -sfn ../videos dist/videos`
- `pm2 restart wgui --update-env` — process `wgui` online, pid 164119

The new auth chunk is `dist/assets/supabase-client-C-86NHJJ.js`.

Hard-reload `https://wgui.wandersguide.site/` before trying again. The PWA precaches the old bundle until that reload (or a service-worker update) picks up the new `sw.js`.
