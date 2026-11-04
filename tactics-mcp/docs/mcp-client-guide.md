# Controlling Wanderer's Guide from an MCP client

*A guide to the `wgui` (tactics-mcp) server: self-hosting it beside your own Wanderer's Guide stack, connecting clients, and using the 81 tools safely.*

Written Nov 3, 2026. Every step comes from the repo on DAEDALUS (`D:\repos\WanderersGuideUI\tactics-mcp`, `D:\repos\WanderersGuideUI`, `D:\repos\wanderers-guide`) or from the live production server. Anything that isn't specific to this repo is labelled **general MCP client config**. The last section lists what couldn't be verified.

---

## 1. Overview and architecture

```
MCP client (ChatGPT, Grokbot, Claude, Cursor, Codexâ€¦)
        â”‚  Streamable HTTP + OAuth/Bearer        or   stdio (local process)
        â–¼
tactics-mcp  (Node, src/http.ts, default 127.0.0.1:3104, path /mcp)
        â”‚  Supabase REST/functions (anon + service-role keys)
        â–¼
Wanderer's Guide Supabase stack (kong, auth/GoTrue, rest, functions, db)
        â–²
WGUI campaign UI (vite app, PM2 "wgui")   +   WG character builder/sheet
```

- **What it is:** `tactics-mcp` is the MCP server inside the WanderersGuideUI repo (package name `tactics-mcp`, server name `wgui-tactics`). It describes itself as "Encounter and character data for the GM. Mostly read-only, with scoped writes."
- **It's separate from AMBA.** Don't point WG clients at AMBA's bridge.
- **Production:** `https://wgui.wandersguide.site/mcp`. PM2 runs it as `wgui-mcp` from the `tactics-mcp` folder on port 3104. The campaign UI itself runs as the PM2 process `wgui`.
- **Tools:** there are 81: 42 need the `read` scope and 39 need `write`. 20 of them are encounter tools that require `view: "gm"`. The full list is in the Appendix and in `docs/mcp-tool-directory-67.md`.
- **Two transports:**
  - Streamable HTTP at `/mcp`, from `src/http.ts`.
  - stdio, with two entry points: `src/grokbotBridge.ts` (stdio to a remote HTTP server) and `src/localStdio.ts` (an in-process stdio server for local testing).

## 2. Prerequisites

- Node.js 20+. The WGUI README says this.
- A Wanderer's Guide Supabase project. This can be the self-hosted Docker stack (Part A1) or a hosted project.
- Supabase values for the MCP server: the URL, the anon key and the service-role key (see section A4).
- For OAuth from cloud clients such as ChatGPT: a public HTTPS origin in front of the server, and that origin on GoTrue's redirect allow-list.
- Git, npm, and optionally PM2 for running it long-term.

---

## Part A: self-hosting

### A1. The Wanderer's Guide stack (`wanderers-guide` repo)

- **Docs:** the upstream README points to [Self-hosting with Docker](https://docs.wanderersguide.app/docker).
- **Compose services** in `docker-compose.yml`: `frontend`, `kong` (the API gateway), `auth` (GoTrue), `rest`, `storage`, `meta`, `functions`, `db`, and an opt-in `studio`. There are also volumes `db-data` and `storage-data`.
- **Environment:** start from `.env.docker.example`. These are variable names only; never commit the values.

| Variable | Purpose |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | Public URL browsers use to reach kong |
| `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | Matched JWT set. The example says its defaults are for local dev only. Generate fresh ones for anything public (`openssl rand -hex 32`, plus Supabase's key generator) |
| `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Database |
| `FRONTEND_PORT`, `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, `VITE_ENV` | Frontend and auth redirects |
| `JWT_EXPIRY`, `EMAIL_AUTOCONFIRM` | Auth |
| `STUDIO_PORT`, `DEFAULT_ORG_NAME`, `DEFAULT_PROJECT_NAME` | Studio (`docker compose --profile studio up`) |
| `PATREON_V2_CLIENT_ID/SECRET`, `PATREON_CLIENT_ID/SECRET`, `CONTENT_UPDATE_KEY` | Optional integrations |

- **Starting it:** run `docker compose up` (add `--profile studio` if you want Studio).
- **Private fork's function-auth fix:** Edmund's private fork has a security fix on branch `security/function-auth` (see `PRIVATE-FORK-README.md`). With it, every edge function needs a valid user JWT or API client key. It matters to tactics-mcp because character export uses the user's identity.

### A2. The WGUI campaign UI (`WanderersGuideUI` repo, optional but usual)

```bash
npm install
cp .env.local.template .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_KEY, VITE_DDDICE_AUTH_KEY, VITE_ENV, â€¦
```

- **Helper services:** there are extra compose files in `docker/`: `wgui-ext.compose.yml`, `wgui-export.compose.yml` and `wgui-functions.compose.yml`.
- **Production deploy:** `scripts/vps-pull-build.sh` does `git pull --rebase origin main`, `npm install`, `npm run build`, `pm2 restart wgui --update-env`, then `pm2 save`. Edmund's rule is push to git, then pull on the VPS. No direct edits on the VPS.

### A2b. Docker stack .env and settings checklist (vanilla WG + tactics-mcp)

These facts come from `wanderers-guide/docker-compose.yml`, `.env.docker.example`, the variable names in the DAEDALUS stack `.env`, `WanderersGuideUI/docker/*.compose.yml`, `scripts/wgui-ext.mjs` and the tactics-mcp source. Values are shown only as placeholders.

**Ports in the stack** (compose defaults; DAEDALUS's running values in brackets):

| Service | Host port | Variable |
| --- | --- | --- |
| frontend (WG builder/sheet) | 3000 [5193] | `FRONTEND_PORT` |
| kong (Supabase API: `/auth/v1`, `/rest/v1`, `/functions/v1`) | 8000 / 8443 | `KONG_HTTP_PORT`, `KONG_HTTPS_PORT` |
| db (Postgres) | **54322** (don't change) | `POSTGRES_PORT` |
| studio (opt-in profile) | 54323 | `STUDIO_PORT` |
| WGUI campaign UI / tactics-mcp | 5194 / 3104 | (outside the stack) |

**Variables and what they must match:**

| Variable | Lives in | Must match / feeds | Example placeholder |
| --- | --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | stack `.env` | Becomes the frontend's `VITE_SUPABASE_URL` and GoTrue's `API_EXTERNAL_URL`. **tactics-mcp `SUPABASE_URL`** and WGUI `VITE_SUPABASE_URL` should be this kong URL | `http://localhost:8000` / `https://api.example.com` |
| `JWT_SECRET` | stack `.env` | Used by GoTrue, PostgREST, storage, functions and db. **tactics-mcp `JWT_SECRET` must be the same value** (character export signs as the user with it) | `openssl rand -hex 32` |
| `ANON_KEY` | stack `.env` | A JWT signed with `JWT_SECRET`. Becomes **tactics-mcp `SUPABASE_ANON_KEY`** and WGUI `VITE_SUPABASE_KEY` | `<anon JWT>` |
| `SERVICE_ROLE_KEY` | stack `.env` | A JWT signed with `JWT_SECRET`. Becomes **tactics-mcp `SUPABASE_SERVICE_ROLE_KEY`** (server only; never in a `VITE_` var) | `<service JWT>` |
| `POSTGRES_PASSWORD`, `POSTGRES_PORT` | stack `.env` | Internal DB roles (`docker/db-init/zzz-passwords.sh`) | `<password>`, `54322` |
| `SITE_URL` | stack `.env` | GoTrue `GOTRUE_SITE_URL`, the default post-login redirect (default `http://localhost:3000`) | `http://localhost:5193` |
| `ADDITIONAL_REDIRECT_URLS` | stack `.env` | GoTrue `GOTRUE_URI_ALLOW_LIST`. **Must include tactics-mcp's `MCP_PUBLIC_ORIGIN`** (for the OAuth callback) and the WGUI UI origin | `http://localhost:5194,https://wgui.example.com/**` |
| `GOTRUE_EXTERNAL_{GOOGLE,GITHUB,DISCORD}_ENABLED / _CLIENT_ID / _SECRET / _REDIRECT_URI` | stack `.env` | Social login, used by the MCP sign-in page too. The redirect URI is the kong callback, registered with each provider | `http://localhost:8000/auth/v1/callback` |
| `EMAIL_AUTOCONFIRM`, `JWT_EXPIRY` | stack `.env` | Email/password sign-up without SMTP (default `true`); token lifetime (default 3600) | `true`, `3600` |
| `VITE_ENV`, `DEFAULT_ORG_NAME`, `DEFAULT_PROJECT_NAME`, `CONTENT_UPDATE_KEY`, `PATREON_*` | stack `.env` | Optional | |
| `ADMIN_PANEL_PASSWORD` | stack `.env` | Only read by `docker/wgui-functions.compose.yml` (WGUI overlay) | optional |
| `WG_DIR` | shell for `npm run stack:up` | Path to the wanderers-guide checkout (default `../wanderers-guide`) | `../wanderers-guide` |
| `MCP_PUBLIC_ORIGIN` | tactics-mcp process | Public origin of tactics-mcp. Must appear in `ADDITIONAL_REDIRECT_URLS` | `https://wgui.example.com` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`, `VITE_ENV` | WGUI `.env.local` | `PUBLIC_SUPABASE_URL` / `ANON_KEY`. `npm run stdio:local` also reads these as `SUPABASE_URL`/`SUPABASE_ANON_KEY`, but still needs `SUPABASE_SERVICE_ROLE_KEY` from the environment | |

**What tactics-mcp needs from the stack:**

- **Vanilla WG tables, through `/rest/v1` with the service role:** `campaign`, `character`, `encounter`, `public_user` and `ability_block`.
- **Vanilla WG edge functions** such as `find-character`, `create-character`, `delete-content`, the `find-*`/`create-*` homebrew functions, and `get-content-source-stats`.
- **WGUI-only edge functions that vanilla WG doesn't have.** They come from `WanderersGuideUI/supabase/`:
  - `wgui-ext-find-campaign-characters`, `wgui-ext-find-encounter` and `wgui-ext-patch-encounter-dice` (from `supabase/wgui-ext/`).
  - `wgui-export-character` and `wgui-export-character-slim` (from `supabase/wgui-export/`).
  - These are mounted into the stack's `functions` container by `docker/wgui-functions.compose.yml`, which `npm run stack:up` / `export:up` run for you. With plain `docker compose up` in wanderers-guide they're **missing**. `list_campaign_characters`, the encounter reads, `patch_encounter_dice` and `export_character` would then fail.
- **No extra DB migrations for the MCP itself.** MCP tokens are stored in the tactics-mcp JSON file (`TACTICS_MCP_TOKEN_FILE`, default `data/tokens.json`), not in Postgres. The tactics-mcp source doesn't reference the two SQL files in `WanderersGuideUI/supabase/` (`recent-logins.sql`, `syndicated-nodes.sql`, both "apply once in the SQL editor"). They're for WGUI UI features.
- **Schema setup:** the stack builds the schema from `supabase/seed.sql`, mounted as a Postgres init script. **It only runs when the db volume is empty** (first boot, or after `down -v`, which deletes all data).

**Step by step:**

1. Clone `wanderers-guide` and `WanderersGuideUI` side by side, or set `WG_DIR`.
2. `cp .env.docker.example .env` in wanderers-guide. For any non-local host, generate a fresh `JWT_SECRET` and **re-sign** `ANON_KEY` and `SERVICE_ROLE_KEY` with it, because the example defaults are a public matched set.
3. Set `PUBLIC_SUPABASE_URL` (kong), `SITE_URL`, and `ADDITIONAL_REDIRECT_URLS` (include the WGUI origin and `MCP_PUBLIC_ORIGIN`).
4. Optional: social providers. Set the `GOTRUE_EXTERNAL_*` variables, and register `<PUBLIC_SUPABASE_URL>/auth/v1/callback` (locally `http://localhost:8000/auth/v1/callback`) with Google, GitHub and Discord.
5. From WanderersGuideUI, run `npm run stack:up`. This is the stack plus the wgui-ext and wgui-export overlays. Check the result with `npm run stack:config`. The first boot seeds the DB.
6. In WGUI, `cp .env.local.template .env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`, then build and serve it (A2/A6).
7. Start tactics-mcp with `SUPABASE_URL=<PUBLIC_SUPABASE_URL>`, `SUPABASE_ANON_KEY=<ANON_KEY>`, `SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>`, `JWT_SECRET=<JWT_SECRET>` and `MCP_PUBLIC_ORIGIN` (A5/A6).
8. Verify (A9): health, discovery, then `get_profile` and `list_campaign_characters`. The second one proves the wgui-ext overlay is loaded.

**Gotchas:**

- **Overlay code changes:** functions are copied into a tmpfs at container start, so a change to wgui-ext or wgui-export code needs `npm run stack:restart`. `export:bundle` rebuilds the export bundle.
- **A mismatched `JWT_SECRET`/keys trio** causes 401s everywhere. The three must be generated together.
- **Missing redirect origin:** if `MCP_PUBLIC_ORIGIN` isn't in `ADDITIONAL_REDIRECT_URLS`, GoTrue refuses the OAuth return and MCP sign-in fails near the end.
- **Edmund's private fork:** `docker-compose.override.yml` there (an "Experimental" nav-link injector) is not part of upstream. Vanilla doesn't need it.
- **Port collisions:** another local Postgres on 5432 is fine. The stack DB is on 54322; leave it there.
- **Unverified:** whether every WG function tactics-mcp calls exists in the *current public upstream* release. I only checked against Edmund's checkout, not a fresh upstream clone.

### A3. Installing and building tactics-mcp

```bash
cd WanderersGuideUI/tactics-mcp
npm install
npx tsc            # builds dist/ (needed for the stdio bridge)
npm test           # tsx --test test/*.test.ts
```

npm scripts in `package.json`:

| Script | Runs |
| --- | --- |
| `npm run dev` | `tsx src/http.ts`, the HTTP server |
| `npm run smoke` | `tsx src/smoke.ts`, an end-to-end HTTP smoke test (dev mint on port 3194) |
| `npm run stdio:local` | `tsx src/localStdio.ts`, a local stdio server |
| `npm run character:smoke` | `tsx src/character-smoke.ts` (needs `WG_ACCESS_TOKEN`) |
| `npm run grokbot:bridge` | `tsx src/grokbotBridge.ts`, a stdio-to-HTTP bridge |

Dependencies: `@modelcontextprotocol/sdk` ^1.29 and `zod` ^4. Dev dependencies: `tsx` and `typescript`.

### A4. Environment variables (read from `process.env`)

`src/http.ts` doesn't load a `.env` file itself. The process manager or shell has to supply these. `localStdio.ts` is the exception: it reads `.env.local`.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `TACTICS_MCP_HOST` | http.ts | Bind host. Default `127.0.0.1` |
| `TACTICS_MCP_PORT` | http.ts | Port. Default `3104` |
| `MCP_PUBLIC_ORIGIN` | http.ts | Public issuer origin (e.g. `https://wgui.wandersguide.site`). Must be on GoTrue's redirect allow-list |
| `SUPABASE_URL` | http/reader | WG Supabase URL |
| `SUPABASE_ANON_KEY` | http/reader | Anon key (sign-in flow and reads) |
| `SUPABASE_SERVICE_ROLE_KEY` | reader | Required: the Supabase reader is only installed when URL, anon key and service-role key are all set |
| `JWT_SECRET` / `SB_JWT_SECRET` | reader | Lets character export sign as the user. Without it (and without the service-role key), export fails with a clear error |
| `TACTICS_MCP_TOKEN_FILE` | tokens.ts | Token store. Default `data/tokens.json` (git-ignored). Stores SHA-256 hashes, never raw tokens |
| `TACTICS_MCP_DEV_MINT` | http.ts | `1` enables a dev-only unauthenticated mint and an `X-WGUI-User` header. **Never on a public host** |
| `GROKBOT_MCP_CLIENT_ID` / `GROKBOT_MCP_REDIRECT_URI` | oauth.ts | Override the registered Grokbot client (default id `grokbot-wgui`) |
| `CHATGPT_MCP_CLIENT_ID` | oauth.ts | Pins ChatGPT connector callbacks to one client id. When unset, any client id with a `https://chatgpt.com/connector/oauth/<id>` callback is accepted |
| `WGUI_MCP_TOKEN`, `WGUI_MCP_URL` | grokbotBridge.ts | Bearer token and server URL for the bridge |
| `WG_STDIO_TEST_EMAIL` / `WG_STDIO_TEST_PASSWORD` | localStdio.ts | Test account the local stdio server signs in as |
| `WG_ACCESS_TOKEN` | character-smoke / localStdio | User access token |

### A5. Running the HTTP server

```bash
TACTICS_MCP_HOST=127.0.0.1 TACTICS_MCP_PORT=3104 \
MCP_PUBLIC_ORIGIN=https://your-wgui.example \
SUPABASE_URL=â€¦ SUPABASE_ANON_KEY=â€¦ SUPABASE_SERVICE_ROLE_KEY=â€¦ \
npm run dev
# logs: listening on http://127.0.0.1:3104/mcp
```

**Endpoints**, from `src/http.ts`:

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /icon.png` | App icon |
| `GET /.well-known/oauth-protected-resource` | Resource metadata |
| `GET /.well-known/oauth-authorization-server` | AS metadata (`scopes_supported: read write`) |
| `GET/POST /oauth/mcp/authorize`, `GET/POST /oauth/mcp/callback` | Browser sign-in through Supabase (Google, GitHub, Discord, email) |
| `POST /oauth/mcp/token` | Exchanges code plus PKCE S256 verifier for a bearer token |
| `GET/POST /api/mcp-tokens`, `DELETE /api/mcp-tokens/<id>` | List, mint and revoke tokens (bearer required) |
| `POST /mcp` | MCP Streamable HTTP (bearer required, concurrent-request cap returns 429) |

### A6. PM2 (verified on prod, Nov 3, 2026)

Production (`vps-ahhh`, Node 22.23.4, npm 10.9.9, PM2 under systemd unit `pm2-administrator.service`, deployed commit `0f98ec5`) runs two fork-mode processes. Neither one was started from an ecosystem file, and there's no `.env` file in `tactics-mcp`. The env vars live in PM2's saved process environment.

| PM2 name | cwd | Exec | Listens | Env var names |
| --- | --- | --- | --- | --- |
| `wgui-mcp` | `<repo>/tactics-mcp` | `npm run dev` (= `tsx src/http.ts`) | `127.0.0.1:3104` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `MCP_PUBLIC_ORIGIN` |
| `wgui` | `<repo>` | `npx serve dist -s -l tcp://127.0.0.1:5194` | `127.0.0.1:5194` | (campaign UI static build) |

Prod doesn't set `TACTICS_MCP_HOST`/`TACTICS_MCP_PORT`; it uses the defaults `127.0.0.1:3104`. It doesn't set `CHATGPT_MCP_CLIENT_ID` or `GROKBOT_MCP_*` either.

The same setup for a self-hosted stack:

```bash
cd /path/to/WanderersGuideUI/tactics-mcp && npm install
SUPABASE_URL=https://your-supabase.example SUPABASE_ANON_KEY=â€¦ \
SUPABASE_SERVICE_ROLE_KEY=â€¦ JWT_SECRET=â€¦ MCP_PUBLIC_ORIGIN=https://wgui.example.com \
  pm2 start npm --name wgui-mcp -- run dev     # env is captured into the PM2 process

cd .. && npm install && npm run build
pm2 start npx --name wgui -- serve dist -s -l tcp://127.0.0.1:5194

pm2 save            # persist across reboots
pm2 startup         # once: installs the pm2-<user> systemd unit
# after a git pull:
pm2 restart wgui-mcp --update-env
```

`--update-env` reloads the env from the current shell, so export the same variables before restarting, or the saved values may be replaced.

### A7. Reverse proxy and HTTPS: pick nginx or Apache

tactics-mcp and the WGUI UI both bind to loopback only (`127.0.0.1:3104` and `127.0.0.1:5194`). One public HTTPS hostname fronts both. The OAuth and MCP paths go to 3104 and everything else goes to 5194. Pick **one** proxy: don't run Apache and nginx on 80/443 at the same time. Stop and disable the other one, e.g. `sudo systemctl disable --now apache2`.

Paths that must reach tactics-mcp (the same set prod proxies):

| Path | Match |
| --- | --- |
| `/.well-known/oauth-protected-resource` | exact |
| `/.well-known/oauth-authorization-server` | exact |
| `/oauth/mcp/â€¦` (authorize, callback, token) | prefix |
| `/mcp` | prefix (Streamable HTTP, long-lived responses) |
| everything else | â†’ WGUI UI on 5194 |

#### Option 1: nginx (recommended, the typical setup)

This is equivalent to prod's Apache routing. `wgui.example.com` is an example hostname. I checked the syntax with `nginx -t` (nginx 1.28.3) on a throwaway copy with a dummy self-signed certificate. It hasn't been run against a live tactics-mcp.

`/etc/nginx/sites-available/wgui.example.com`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name wgui.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name wgui.example.com;

    ssl_certificate     /etc/letsencrypt/live/wgui.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wgui.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;

    # OAuth discovery (tactics-mcp)
    location = /.well-known/oauth-protected-resource {
        proxy_pass http://127.0.0.1:3104;
    }
    location = /.well-known/oauth-authorization-server {
        proxy_pass http://127.0.0.1:3104;
    }

    # OAuth authorize / callback / token (tactics-mcp)
    location ^~ /oauth/mcp/ {
        proxy_pass http://127.0.0.1:3104;
    }

    # MCP Streamable HTTP (tactics-mcp)
    location ^~ /mcp {
        proxy_pass http://127.0.0.1:3104;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Everything else: WGUI campaign UI
    location / {
        proxy_pass http://127.0.0.1:5194;
        proxy_http_version 1.1;
    }
}
```

Get the certificate and enable the site:

```bash
sudo apt install nginx certbot python3-certbot-nginx
# First run: start with only the port-80 server block (or the default site) so certbot can answer the challenge
sudo certbot --nginx -d wgui.example.com        # creates /etc/letsencrypt/live/wgui.example.com/* and options-ssl-nginx.conf
sudo ln -s /etc/nginx/sites-available/wgui.example.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Notes:

- **`location ^~ /mcp`** matches `/mcp` and anything under it, the same as Apache's `ProxyPass /mcp`. The `=` and `^~` matches take precedence over `location /`, so order in the file doesn't matter.
- **Streamable HTTP settings:** `/mcp` needs `proxy_http_version 1.1`, `Connection ""`, `proxy_buffering off`, `proxy_cache off`, chunked encoding and a long read timeout so streamed responses aren't cut off or buffered.
- **Header inheritance:** `proxy_set_header` at server level is inherited only by locations that don't set their own. That's why `/mcp` repeats the headers.
- **`http2 on;`** needs nginx 1.25.1 or later. On older nginx, use `listen 443 ssl http2;` instead.
- **Optional extra paths:** to expose `/health`, `/icon.png` or `/api/mcp-tokens` publicly (prod doesn't), add `location = /health { proxy_pass http://127.0.0.1:3104; }` and the same for the others.

#### Option 2: Apache (what prod uses, verified on vps-ahhh)

On prod, Apache 2.4 terminates TLS with a Let's Encrypt (certbot) certificate. Port 80 redirects to HTTPS. (An nginx port-80 site for the same hostname is also enabled on prod, but Apache handles HTTPS.) The vhost from prod, with an example hostname:

```apache
<VirtualHost *:80>
    ServerName wgui.example.com
    RewriteEngine On
    RewriteRule ^ https://wgui.example.com%{REQUEST_URI} [L,R=301]
</VirtualHost>

<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName wgui.example.com
    ProxyPreserveHost On
    ProxyPass        /.well-known/oauth-protected-resource   http://127.0.0.1:3104/.well-known/oauth-protected-resource
    ProxyPassReverse /.well-known/oauth-protected-resource   http://127.0.0.1:3104/.well-known/oauth-protected-resource
    ProxyPass        /.well-known/oauth-authorization-server http://127.0.0.1:3104/.well-known/oauth-authorization-server
    ProxyPassReverse /.well-known/oauth-authorization-server http://127.0.0.1:3104/.well-known/oauth-authorization-server
    ProxyPass        /oauth/mcp/ http://127.0.0.1:3104/oauth/mcp/
    ProxyPassReverse /oauth/mcp/ http://127.0.0.1:3104/oauth/mcp/
    ProxyPass        /mcp http://127.0.0.1:3104/mcp
    ProxyPassReverse /mcp http://127.0.0.1:3104/mcp
    ProxyPass        /    http://127.0.0.1:5194/
    ProxyPassReverse /    http://127.0.0.1:5194/
    RequestHeader set X-Forwarded-Proto "https"
    SSLCertificateFile    /etc/letsencrypt/live/wgui.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/wgui.example.com/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
</IfModule>
```

- Enable `mod_proxy`, `mod_proxy_http`, `mod_headers`, `mod_rewrite` and `mod_ssl`. `certbot --apache -d wgui.example.com` creates the `-le-ssl.conf` file and the certificate.
- The `/mcp`, `/oauth/mcp/` and two `.well-known` rules must come **before** `ProxyPass /`.
- **Prod doesn't publicly proxy `/health`, `/icon.png` or `/api/mcp-tokens`.** Those fall through to the UI, so `https://<host>/health` returns the UI's index.html. Check health on the box (`curl http://127.0.0.1:3104/health` returns `{"ok":true,"transport":"streamable-http","surface":"wgui-tactics"}`). Add `ProxyPass` lines for those paths if you want public token minting or an icon.
- `MCP_PUBLIC_ORIGIN` must be the public `https://` origin, and must be on GoTrue's redirect allow-list.
- Cloud clients (ChatGPT, Grokbot) need public HTTPS. The Grokbot callback can't be localhost or an IP address.

### A8. Tokens and auth

- **Bearer only on `/mcp`:** a malformed, unknown, expired or revoked token is rejected, and there's no cookie fallback. An unauthenticated request gets a 401 with `WWW-Authenticate: Bearer resource_metadata="â€¦", scope="read write"`.
- **OAuth:** the authorization-code flow with PKCE S256. If authorize is sent **without** a scope (ChatGPT does this), the grant is **`read write`**. `scope=read` gives a read-only token. An unknown scope returns `invalid_scope`. Dynamic client registration isn't advertised.
- **Minted tokens:** `POST /api/mcp-tokens` with `{"label":"â€¦","scopes":["read","write"]}`. **If `scopes` is omitted, the token is read-only.** Tokens aren't upgraded later; mint a new one or sign in again.
- **Ownership:** this is separate from scope. Even with `write`, tools refuse to change characters you don't own, and encounter reads need campaign GM access.

### A9. Verification

1. `curl http://127.0.0.1:3104/health` on the server (publicly, `/health` is only reachable if you proxy it; see A7)
2. `curl https://your-host/.well-known/oauth-authorization-server`. Expect `scopes_supported` to be `["read","write"]`.
3. `curl -i -X POST https://your-host/mcp`. Expect a 401 with the `WWW-Authenticate` header.
4. With a token, send `tools/list` and expect **81 tools**. `tools/list` shows every tool to any token; scope is only checked when a tool is called.
5. Call `get_profile`, which should return your Supabase user id. Then try a read such as `list_campaign_characters`.
6. Check that a read-only token gets `AUTH_REQUIRED` ("MCP token missing scope write for â€¦") on a write tool.
7. Run `npm run smoke` locally for the full scripted check.

---

## Part B: connecting clients

### B1. ChatGPT (verified working, Nov 3)

1. In ChatGPT, turn on developer mode and create an app or connector with a custom MCP server.
2. Set the URL to `https://wgui.wandersguide.site/mcp` (or your own host).
3. Set Authentication to OAuth, the client ID to `chatgpt`, and the token auth method to `none` (public PKCE client).
4. Connect, then sign in to WG in the browser window that opens. You get a read+write grant.
5. The packaged plugin in `tactics-mcp/plugin/` (`.mcp.json`, `.app.json`, `.codex-plugin/plugin.json`, icons, an `encounters` skill) uses the same URL with `"type": "streamable-http"`.

### B2. Grokbot

From `docs/grokbot-mcp-setup.md`:

```text
Server name: wgui    Transport: Streamable HTTP
URL: https://wgui.wandersguide.site/mcp
OAuth client: grokbot-wgui   Redirect: https://www.cursor.com/agents/mcp/oauth/callback
```

Alternatives are `Authorization: Bearer <WGUI_MCP_TOKEN>` or the stdio bridge (B3).

### B3. stdio bridge (any client that launches local commands)

Run `npx tsc` first, then launch `node dist/grokbotBridge.js` directly, not through npm, so npm's output stays off stdout. Set `WGUI_MCP_TOKEN` in that process. `WGUI_MCP_URL` is optional and defaults to prod; plain HTTP is only allowed on loopback. Run one process per user.

```json
{
  "mcpServers": {
    "wgui": {
      "command": "node",
      "args": ["<absolute-path>/tactics-mcp/dist/grokbotBridge.js"],
      "env": { "WGUI_MCP_TOKEN": "<token>" }
    }
  }
}
```

The `mcpServers` block is the format in the repo docs. Putting the token in `env` is **general MCP client config**; the doc only says to "set WGUI_MCP_TOKEN in that process."

### B4. Local stdio for testing (`npm run stdio:local`)

- **How it works:** `localStdio.ts` reads `.env.local`, mapping `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` to `SUPABASE_URL` and `SUPABASE_ANON_KEY`. It signs in as `WG_STDIO_TEST_EMAIL` (there's a built-in test-account default) and serves all tools over stdio with `read` and `write`.
- **Requirements:** it needs `SUPABASE_SERVICE_ROLE_KEY`.
- **Use it only against a local or test stack.**

### B5. Claude Desktop / Claude Code, Cursor, Codex (general MCP client config)

The repo has no client-specific configs for these. Here's what the repo formats support:

- **Remote HTTP:** for any client that supports Streamable HTTP plus OAuth, use URL `â€¦/mcp`. Discovery is at `/.well-known/oauth-protected-resource`. If the client can't do OAuth, send a bearer header.
- **stdio:** use the `mcpServers` JSON from B3. Claude Desktop, Cursor (`.cursor/mcp.json`) and Claude Code (`.mcp.json`) all use an `mcpServers` map.
- **Codex:** the repo ships a Codex plugin manifest (`plugin/.codex-plugin/plugin.json`), which points to `.app.json` and the streamable-http `.mcp.json`.

---

## Part C: using it

Start every session with `get_profile`. Treat returned ids as authoritative, and re-read after every write.

### C1. Build a character end to end

| Step | Tool | Notes |
| --- | --- | --- |
| 1 | `create_character` (`name`, `level`) | Returns the id. If you get "user not found", call `ensure_public_user` once and retry |
| 2 | `set_books` (`characterId`, `add`) | Optional: enable content sources. Find their ids with `list_options kind=content-source` |
| 3 | `list_options kind=ancestry` / `background` / `class` | Find option ids |
| 4 | `set_identity` (`slot`, `optionId`) | Once each for ancestry, background and class |
| 5 | `list_open_choices` | Unfilled selects with legal options |
| 6 | `choose` (`choiceId`, `optionId`) | Repeat until no open choices remain. Illegal ids are rejected |
| 7 | `list_spell_options` (`source`) | For casters |
| 8 | `add_spell` (`spellId`, `rank`, `source`, `prepare`) or `set_spells` | |
| 9 | `list_options kind=item`, then `add_inventory_item` (`itemId`, `quantity`) | Gear. `remove_inventory_item` undoes it. `give_money` / `take_money` edit `inventory.coins` |
| 10 | `export_character` (json slim/full or pdf) | Check the result |

> *Example prompt:* "Using the wgui tools, create a level 1 human fighter named Aragorn. Use the Core rules only. Say what you'll change before each write, fill every open choice with sensible options, add a longsword and adventurer's pack, then export the slim JSON."

### C2. Join a campaign

Run `join_campaign` with `characterId` and the GM's `joinKey`. **Never echo the key.** If the character is already in the campaign, the result is `already=true`. Check with `list_campaign_characters`.

> *Prompt:* "Join my character 1234 to the campaign. I'll paste the join key; don't repeat it back."

### C2b. Create or edit a campaign / encounter

`create_campaign` and `update_campaign` post to stock `create-campaign`. `update_campaign` merges `meta_data` so campaign art stays. `create_encounter` omits `campaignId` for a standalone fight, or takes a campaign this user owns. `set_encounter_campaign` attaches or detaches (`campaignId` null). There is no delete tool.

### C3. GM encounter reads (all need `view: "gm"` and GM access)

1. `list_encounters`, then `get_encounter`.
2. `list_combatants` (initiative, defenses, conditions, HP) and `list_pcs` / `list_roster_edges`.
3. Per combatant: `get_stat_block`, `list_ability_groups` then `get_abilities`, `get_feats`, `get_class_features`, `get_skills`, `get_spells`, `get_character` / `get_monster`.
4. `get_round_log`.

> *Prompt:* "In campaign 12, summarize the current encounter: round, initiative order, who's below half HP, and the boss's best attack."

### C4. Homebrew creatures

1. `wgui_ext_hb_find_content_source` to find your homebrew source id. Creating one needs Patreon tier 2.
2. `wgui_ext_hb_find_creature` (`name`) to check for an existing creature or copy an official one's shape.
3. `wgui_ext_hb_create_creature` with a `record`: no id inserts a new creature, and an id updates that one.
4. `wgui_ext_hb_delete_content` (`id`, `type: "creature"`) removes it. This is destructive, so confirm first.
5. Use `wgui_ext_hb_create_content_update` to propose a change to existing content. It creates a PENDING proposal.

These creatures go into the homebrew catalog. To put one in a fight, call `add_encounter_combatant` with that creature's numeric `id` as `creatureId` (see C6).

### C5. Dice log

1. `get_dice_log` to read the tray and log.
2. `patch_encounter_dice` with the **full** `diceRollLog` you want to keep and/or `diceRollState`. A GM's write replaces whatever fields are sent. Players may only add, edit or drop rows they started.

It never changes initiative, HP, conditions or the roster. Those are C6.

> *Prompt:* "Read the dice log for encounter 7, then add a row 'Perception vs DC 20' with Valeros 1d20+7 = 22, keeping all existing rows."

### C6. Roster and initiative (GM only, `view: "gm"`, `write` scope)

1. `get_encounter` returns `encounterRevision`. Pass it on the next roster write when someone else might be editing the same fight. Omit it to use the revision at call time. A stale value returns `ENCOUNTER_REVISION_CONFLICT`; read again and retry.
2. `add_encounter_combatant` with `characterId` (a PC from `list_campaign_characters` that is already in the campaign; calls `wgui-ext-add-encounter-character`) or `creatureId` (from `wgui_ext_hb_find_creature`; calls `wgui-ext-add-encounter-creature`). The reply `name` is the character or creature name. `ally` applies to creatures and defaults to false.
3. `list_combatants`, then `remove_encounter_combatant` with that combatant id (`wgui-ext-remove-encounter-combatant`). This drops the row from the fight. It does not delete the character or the catalog creature.
4. `patch_encounter_combatant` (`wgui-ext-patch-encounter-combatant`) sets `initiative`, `hpCurrent`, `hpTemp`, and/or `conditions` on the encounter row. It does not edit the character sheet. A PC that was only linked by id has no encounter HP to edit until a snapshot exists; initiative still updates.
5. `roll_initiative` (`wgui-ext-roll-initiative`) rolls a server d20 plus `bonus` (pass Perception). `scope` `empty` fills blanks; `all` rerolls the combatants you list. Omit `rolls` to roll every combatant at +0. Each rolled row uses the character or creature name. `rollBatch` counts how many times initiative has been logged; it is not the combat round. Older `initiative_log` rows stored that same counter as `round` and still read. Send `clientRequestId` if a retry must not roll a second time.

> *Prompt:* "Add creature 501 as an enemy in encounter 7, roll initiative for everyone who doesn't have one, using Perception +5 for the new creature, then set it to 12 HP."

---

## 3. Scopes and safety

- **`read` versus `write`:** scope is enforced per tool before the handler runs. A missing scope returns `AUTH_REQUIRED` with the scope it needed.
- **Ownership and GM checks always apply.** You can't edit others' characters, and encounter reads need GM access.
- **Destructive tools:** `delete_character`, `wgui_ext_hb_delete_content`, `remove_*`, `set_spells` (replaces a list) and `patch_encounter_dice` (replaces fields). Have the model state the change and get a yes first.
- **Secrets:** keep tokens, codes, PKCE verifiers, cookies and join keys out of prompts, logs and repos. Tokens are stored only as hashes.
- **Dev mint:** never enable `TACTICS_MCP_DEV_MINT` on a public host.
- **Suggested bot instruction** (from grokbot-mcp-setup.md): "Use only tools discovered from the wgui MCP serverâ€¦ Say what will change before using a write tool, and only when the user asked. Re-read state after a failed or successful write before retrying. Do not invent endpoints, tool names, or schemas."

## 4. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Write tools fail with `AUTH_REQUIRED â€¦ scope write` | The token is read-only: an old grant, `scope=read`, or a token minted without `scopes`. Sign in again (OAuth with no scope now grants read+write, since commit dc9d79b) or mint with `["read","write"]`. Tokens aren't upgraded in place |
| ChatGPT shows only read tools / "doesn't show write" | Delete the connector and re-add it (ChatGPT caches the grant). Make sure the server is running the read+write default |
| OAuth sign-in succeeds, then fails before returning to ChatGPT | Check that the callback is `https://chatgpt.com/connector/oauth/<id>`, that `CHATGPT_MCP_CLIENT_ID` (if set) matches the client id you entered, that token auth is `none`, and that `MCP_PUBLIC_ORIGIN` is on the GoTrue allow-list |
| Can't reach "add account"/auth UI | Use the ChatGPT developer-mode app form: OAuth, client id `chatgpt`, token auth `none` |
| 401 on `/mcp` with a token | Token unknown, expired or revoked (check `GET /api/mcp-tokens`), or wrong host. No cookie fallback |
| `invalid_scope` | A scope other than `read`/`write` was requested, or an empty list |
| "user not found" on create | Call `ensure_public_user` once |
| Encounter tools reject input | Pass `view: "gm"`, and you must be the campaign's GM |
| `export_character` INTERNAL_ERROR | Set `JWT_SECRET` (or `SB_JWT_SECRET`) or `SUPABASE_SERVICE_ROLE_KEY` on the server |
| 429 `RATE_LIMITED` | Too many concurrent `/mcp` calls. Retry |
| stdio client garbled | Launch `node dist/grokbotBridge.js`, not `npm run`, so stdout stays clean |

## 5. Limitations and known write gaps

No tool exists today for:

- **Character portrait, art or background image.**
- **Character notes:** no standalone notes tool. `get_character` returns notes read-only, GM view.
- **Companions:** `choose` can pick a companion feat, but nothing creates or edits the companion.
- **Equip, invest or wield:** `add_inventory_item` has no equipped or invested flag.

Each of these would need a new server tool.

## Appendix: tool reference (81)

**Campaign, encounter and combat (33).**
- Read: `get_profile`, `get_campaign_owner_contacts`, `list_campaign_characters`.
- Read, GM view: `list_encounters`, `get_encounter`, `list_pcs`, `list_combatants`, `list_roster_edges`, `get_round_log`, `get_dice_log`, `get_stat_block`, `list_ability_groups`, `get_abilities`, `get_feats`, `get_class_features`, `get_skills`, `get_spells`, `get_character`, `get_monster`.
- Write: `ensure_public_user`, `join_campaign`, `patch_encounter_dice`.
- Write, GM view: `add_encounter_combatant`, `remove_encounter_combatant`, `patch_encounter_combatant`, `roll_initiative`.
- Campaign/encounter rows: `list_campaigns`, `get_campaign`, `create_campaign`, `update_campaign`, `create_encounter`, `update_encounter`, `set_encounter_campaign`.

**Character (18).**
- Read: `export_character`, `get_character_row`, `list_options`, `list_open_choices`, `list_spell_options`, `convert_coins`.
- Write: `create_character`, `delete_character`, `choose`, `set_identity`, `set_books`, `add_spell`, `remove_spell`, `set_spells`, `add_inventory_item`, `remove_inventory_item`, `give_money`, `take_money`.

**Homebrew (30).**
- Read: `wgui_ext_hb_find_*` for content_source, trait, ability_block, ancestry, background, class, archetype, versatile_heritage, class_archetype, item, language, creature, spell and content_update, plus `wgui_ext_hb_get_content_source_stats`.
- Write: `wgui_ext_hb_create_*` for the same 13 content types (content_source through spell), plus `wgui_ext_hb_create_content_update` and `wgui_ext_hb_delete_content`.

Parameters and return values for every tool are in `docs/mcp-tool-directory-67.md`.

## Not verified

- The exact shell command originally used to `pm2 start` prod (PM2 records the exec `npm run dev`, the cwd and the env names, but not the original command line).
- Whether every WG edge function tactics-mcp calls exists in a fresh public upstream wanderers-guide (checked only against Edmund's checkout; see A2b).
- Client-specific setup for Claude, Cursor and Codex beyond the repo's `mcpServers` and plugin formats (labelled general).
- Exact ChatGPT UI labels, which may change.
