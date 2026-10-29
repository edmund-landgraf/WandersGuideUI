# amba login and character-export failures

Two separate outages on `amba.wandersguide.site`. The first is the service worker stealing the OAuth hash. The second is `wgui-export-character` failing to boot when `caller-auth.ts` is not in the functions tmpfs. They share a host and an amber/broken login-or-export symptom. The fixes are not the same.

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

## If login is broken again

Two different failures look the same from the user’s side (“I clicked Google and nothing useful happened”). Split them before changing anything.

| What you see | Where the bug is | Fix |
| --- | --- | --- |
| Incognito works. Regular Chrome shows the SPA 404 (“You found a secret place”) on `/auth/v1/authorize`, or DevTools shows a service worker controlling the page. | Stale worker on that Chrome profile. The server is fine. | Unregister the worker once (steps below). Do not deploy a new `sw.js`. |
| After the provider, the address bar is `https://amba.wandersguide.site/sw.js#access_token=...` and the page is raw JavaScript. | A worker (or Apache alias) made `/sw.js` the document. The hash never reached the SPA. | Remove that alias / kill-switch. Recover the tab with the Apache 302 below. Do not add another unregister worker. |
| Incognito also fails, and `curl -sI` of `/auth/v1/authorize?provider=google` does not 302 to Google. | Kong, GoTrue, or Apache `ProxyPass` order. | API path split below. Still do not touch `sw.js`. |

Incognito (or a fresh profile) is the server check. If it logs in, stop looking at Apache and GoTrue.

### One-time recovery for a stuck Chrome profile

On `https://amba.wandersguide.site` (and `https://wgui.wandersguide.site` if that profile has the app installed):

1. DevTools → **Application** → **Service Workers** → **Unregister**.
2. **Application** → **Storage** → **Clear site data**.
3. Hard reload, then sign in again.

That is the whole client fix. Updating `sw.js` on disk does nothing while `registerType: 'prompt'` is waiting for a click, and `client.navigate()` during activate is what put the tokens on `/sw.js`.

### Confirm the server before changing it

From any machine, not from the broken browser:

```bash
curl -sI "https://amba.wandersguide.site/auth/v1/authorize?provider=google"
```

A healthy GoTrue answers **302** toward Google (or another provider). A 200 HTML body that contains “secret place” means the SPA handled `/auth/` — the worker or the frontend proxy ate the API path.

Apache on the VPS must proxy API prefixes to Kong **before** `ProxyPass /` to the frontend (`127.0.0.1:5193`):

- `/auth/v1/` → Kong `127.0.0.1:8000`
- the same for `/rest/`, `/storage/`, `/functions/`

HTML navigations to `/sw.js` should **302 to `/`** unless the request has the header `Service-Worker: script`. The browser keeps `#access_token=...` across that redirect, so a tab already stuck on `/sw.js#access_token=...` can land on `/#access_token=...` and the SPA can read the session. Do not serve a script body for a normal document request to `/sw.js`.

Leave `/var/www/amba-pwa-fix/` alone. It was the emergency alias. Do not add files there, and do not register another worker from that tree.

### App changes that prevent a repeat

WGUI already denies the API prefixes in `vite.config.ts` (`navigateFallbackDenylist`: `/auth/`, `/oauth/`, `/rest/`, `/functions/`, `/storage/`, plus `/pg/`, `/.well-known/`, `/help`, `/owlbear/auth`, `/videos`). The old Docker frontend on amba (`:5193`) is a separate image. Mirror that denylist there and **rebuild the image**. A config edit in this repo does not update the worker amba is serving.

OAuth return URL in this repo is `window.location.origin` only (`campaignRedirectTo` in `src/auth/campaign-auth.ts`). The in-app return path is stored in `sessionStorage` (`wg_oauth_next`), not in `redirectTo`. Password recovery uses `window.location.origin` plus `/update-password`. Do not pass `window.location.href` (it includes the current path and can pin the session hash to whatever URL the worker last controlled, including `/sw.js`).

`registerType` in this repo is still `'prompt'`. On a host that also serves `/auth/`, `'autoUpdate'` (or no PWA) is safer, because a prompt-gated worker keeps the previous script in control after you ship a fix. Changing it still requires a rebuild of whichever frontend that host actually serves, plus the one-time unregister above for browsers that already have the old worker.

GoTrue stays on amba: `SITE_URL=https://amba.wandersguide.site`, provider callback `https://amba.wandersguide.site/auth/v1/callback`. `ADDITIONAL_REDIRECT_URLS` must include `https://wgui.wandersguide.site` (and local origins you actually use, exactly — GoTrue falls back to `SITE_URL` when `redirectTo` is not on the list). Do not move the provider callback onto wgui.

### Do not

- Replace, alias, or ship a kill-switch `/sw.js` (`skipWaiting` + unregister + `clients.navigate`).
- Call `client.navigate` from any worker on `amba.wandersguide.site`.
- Put the session hash on a script URL. Hashes are not sent to the server; they stay on the document path the browser landed on.

## Related layout (do not collapse these)

| Public host | Process |
| --- | --- |
| `https://amba.wandersguide.site` | Old UI `:5193` + Kong `:8000` path split |
| `https://wgui.wandersguide.site` | WGUI pm2 `:5194` |

GoTrue: `SITE_URL=https://amba.wandersguide.site`, `ADDITIONAL_REDIRECT_URLS` includes `https://wgui.wandersguide.site`. Provider callback stays on amba `/auth/v1/callback`.

## Character export (`wgui-export-character`) will not boot

Incident date: 2026-10-27. Container: `wanderers-guide-functions-1`. Launcher row: export / character file (`wgui-export-character`).

The functions container copies two trees into a tmpfs at `/home/deno/functions` **only when it starts** (`docker/wgui-functions.compose.yml`):

- Base: `wanderers-guide/supabase/functions` (`WG_FUNCTIONS_DIR`, production `main`)
- Overlay: this repo’s `supabase/wgui-ext` and `supabase/wgui-export` (`_wgui-ext`, `wgui-ext-*`, `_wgui-export`, `wgui-export-*`)

`connect-raw.ts` calls `authenticateBearer`, `grantedCharacterIds`, and `scopeBodyToGrants`. Those lived only on the wanderers-guide branch `security/function-auth` as `_shared/caller-auth.ts`. Upstream `main` does not have that file, and this account cannot push it (`403` on `wanderers-guide/wanderers-guide`).

On 2026-10-27 the container was recreated while the VPS checkout stayed on `main` (`959d39fc`). `FETCH_HEAD` from `security/function-auth` is not what the container copies. The worker graph failed:

`InvalidWorkerCreation: worker boot error: failed to create the graph`

The launcher treats a body that is not JSend `success`, `fail`, or `error` as unconfirmed (amber). Other rows do not import that file, so they stayed green. A later copy of `caller-auth.ts` onto the VPS at `wanderers-guide/supabase/functions/_shared/caller-auth.ts` made export answer again, and the next `_shared` replace will delete it.

This repo now ships the helper beside the importer: `supabase/wgui-export/_wgui-export/caller-auth.ts`, imported as `./caller-auth.ts`. After the 2026-10-29 functions restart, that path existed in the tmpfs and a no-auth POST returned `401` with `"status":"fail"`, which the probe counts as up. Background and the local rest/password case: `docs/export-caller-auth-plan.md`, `docs/local-stack-rest-and-export-boot.md`.

### If the export row is amber again

| What you see | Where the bug is | Fix |
| --- | --- | --- |
| HTTP 500 and `failed to create the graph`. `ls` inside the container has no `/home/deno/functions/_wgui-export/caller-auth.ts`. | Overlay was not copied, or the container started before the file existed. Editing the file on disk does not update tmpfs. | Restart `wanderers-guide-functions-1` from a checkout whose `connect-raw.ts` imports `./caller-auth.ts`. |
| Same 500, and the import is `../_shared/caller-auth.ts`. | Worker is resolving the helper in the wanderers-guide base tree, which is `main`. | Point the import at `./caller-auth.ts` and restart. Do not depend on the stray `_shared` file. |
| HTTP 401 and `"status":"fail"` (`AUTH_REQUIRED`) on a no-auth POST. | Export is up. The probe uses a fake bearer (`anon`), which is not a session. | Leave it. A real session or granted API key is a separate call. |
| HTTP 404 on that function only. | The `wgui-export-*` directory was not in the entrypoint copy list. | Restore the overlay copy in `docker/wgui-functions.compose.yml` and recreate the container. |
| `InvalidWorkerCreation` on a different function name. | That function’s own import failed. | Read the functions log for the name before treating it as this file. |

From the VPS:

```bash
docker exec wanderers-guide-functions-1 ls /home/deno/functions/_wgui-export/caller-auth.ts
curl -sS -D - -o - -X POST "https://amba.wandersguide.site/functions/v1/wgui-export-character" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer anon" \
  -H "apikey: anon" \
  -d "{}"
```

Up: the file exists, HTTP 401, body contains `"status":"fail"`. Broken: HTTP 500 and `failed to create the graph`. Then restart the functions container so the entrypoint copies `_wgui-export` again. A file saved after start is invisible until that restart. The same rule applies to any new file under `supabase/wgui-export/_wgui-export/` or `supabase/wgui-ext/_wgui-ext/`.

Remove `/home/administrator/wanderers-guide/supabase/functions/_shared/caller-auth.ts` once the overlay copy is confirmed inside the container. If `security/function-auth` later adds its own `_shared/caller-auth.ts`, the paths differ, so export keeps the overlay file.

Do not merge-wait on `security/function-auth`. Do not put this helper only in upstream `_shared`. Gateway `VERIFY_JWT=true` would also 401 API-key callers before the function runs; these routes stay `verify_jwt = false` and reject anonymous callers themselves.
