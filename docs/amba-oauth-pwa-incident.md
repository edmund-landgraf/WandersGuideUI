# Do not deploy a service-worker kill-switch on amba

**Never again** replace `https://amba.wandersguide.site/sw.js` with an unregister/skipWaiting “kill-switch” worker, and never `client.navigate(client.url)` from a worker on that host.

Incident date: 2026-08-14. Host: `amba.wandersguide.site` (Apache + Kong/GoTrue on the same origin as the old Docker frontend PWA).

## What went wrong

`amba` is both:

- the **SPA** (Docker frontend nginx on `127.0.0.1:5193`)
- the **Supabase/GoTrue API** (`/auth/v1/` → Kong `127.0.0.1:8000`)

OAuth callback is `https://amba.wandersguide.site/auth/v1/callback`. GoTrue then sends the browser to `SITE_URL` / `redirectTo` with the session in the **URL hash** (`#access_token=...`).

A Workbox PWA on that same origin intercepts navigations. An old worker (even after `sw.js` on disk is updated, because `registerType: 'prompt'` keeps the old worker in control) served the SPA 404 (“You found a secret place”) for `/auth/v1/authorize?...`. Curl/Kong still 302’d to Google/GitHub/Discord. Incognito worked. Regular Chrome did not.

A kill-switch `sw.js` was then aliased on Apache **in front of** `ProxyPass /`:

- `skipWaiting` + delete caches + `unregister` + **`clients.forEach(c => c.navigate(c.url))`**

That second step is the landmine. After Google succeeded, the browser landed on:

`https://amba.wandersguide.site/sw.js#access_token=...`

The SPA never ran, so the hash was never consumed. The user saw raw JavaScript. Login had been fine minutes earlier.

## Why a kill-switch is the wrong tool here

1. `/sw.js` is a **document URL** as well as a worker script. OAuth `redirectTo` / post-activate `navigate()` can make that path the return URL. Hashes are not sent to the server; the tokens sit on whatever path the document has.
2. `client.navigate(client.url)` during `activate` races the OAuth redirect.
3. Serving a new worker does not take control while `registerType: 'prompt'` is waiting for a user click.
4. This host **must not** have a navigate-fallback worker in front of `/auth/`. Killing the worker by *being* `/sw.js` during login is how you steal the session URL.

## What to do instead

**Users (one-time, regular Chrome profile):** unregister the worker (Application → Service Workers), clear site data, or use a fresh profile. Incognito is the check that the **server** is fine.

**App (durable):**

- `workbox.navigateFallbackDenylist` must include `/auth/`, `/rest/`, `/functions/`, `/storage/` (WGUI `vite.config.ts` already does). Mirror that on the wanderers-guide Docker frontend and **rebuild the image**.
- Prefer `registerType: 'autoUpdate'` over `'prompt'` on a host that shares APIs, or disable the PWA on amba entirely.
- OAuth `redirectTo` must be `window.location.origin` (or origin + `/login`), never `window.location.href`.

**Apache (already on the VPS; do not add another worker):**

- `ProxyPass` `/auth/v1/` (and rest/storage/functions) to Kong **before** `/` to the frontend.
- HTML navigations to `/sw.js` 302 to `/` unless the request has `Service-Worker: script` (so a stuck tab can recover; the fragment is kept by the browser).
- Files under `/var/www/amba-pwa-fix/` were an emergency. Do not extend them. Do not add another unregister worker. Do not `navigate()` clients from a worker on this host.

## Related layout (do not collapse these)

| Public host | Process |
| --- | --- |
| `https://amba.wandersguide.site` | Old UI `:5193` + Kong `:8000` path split |
| `https://wgui.wandersguide.site` | WGUI pm2 `:5194` |

GoTrue: `SITE_URL=https://amba.wandersguide.site`, `ADDITIONAL_REDIRECT_URLS` includes `https://wgui.wandersguide.site`. Provider callback stays on amba `/auth/v1/callback`.
