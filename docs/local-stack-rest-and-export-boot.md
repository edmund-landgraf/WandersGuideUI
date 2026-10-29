# Local stack: PostgREST password drift and export worker boot

Incident date: 2026-10-29. Host: this machine (`PTOLEMY`), Docker project `wanderers-guide`. Browser app at `http://localhost:8000` (Kong) and the WandersGuideUI dev server talking to that gateway.

This is the recovery runbook for two failures that showed up together. They have different causes. Fixing one does not fix the other.

Do not paste the contents of the env files below into chat, tickets, or commits. The paths and variable names are enough.

## What you saw

1. Character loads failed with `find-character: name resolution failed`. The same line was logged for `find-campaign`, `get-user`, and `wgui-ext-ensure-public-user`.
2. The launcher export row stayed yellow (amber alert). The probe for `wgui-export-character` got a body that was not JSend.

`find-character` itself was fine. The function worker started. It calls PostgREST through Kong at `SUPABASE_URL=http://kong:8000`. Kong then proxies `/rest/v1` to the Docker DNS name `rest`. That name only exists while `wanderers-guide-rest-1` is running and attached to the compose network. The container was crash-looping, so Kong logged a bad address for `rest:3000`, and the edge function reported that as `name resolution failed`.

The export row is a separate check. `src/pages/launcher/function-probe.ts` marks a function **up** only when the HTTP body is JSON with `status` of `success`, `fail`, or `error`. A `500` whose body is `{"msg":"InvalidWorkerCreation: worker boot error: failed to create the graph"}` is **unconfirmed**, which the launcher draws in amber. A missing function (`404`) is red.

## Where the local keys live

These files are on this machine and are gitignored. Containers do not read them live. Compose reads them when a container is created or recreated, then stores that snapshot in the container config.

| Path | What it holds |
|---|---|
| `D:\repos\edmund-landgraf\wanderers-guide\.env` | Stack secrets. `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, `CONTENT_UPDATE_KEY`, and the Google / GitHub / Discord client ids and secrets. Also `PUBLIC_SUPABASE_URL` (`http://localhost:8000`), `POSTGRES_PORT` (`54322`), `SITE_URL`. |
| `D:\repos\edmund-landgraf\wanderers-guide\.env.docker.example` | The published template. The JWT and anon key in that example are the upstream local defaults. This machine's `.env` is not that template. Do not copy the example over `.env`. |
| `D:\repos\edmund-landgraf\WandersGuideUI\.env.local` | Vite browser config. `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (the anon key, must match `ANON_KEY` in the stack `.env`), `VITE_DDDICE_AUTH_KEY`, `VITE_CLAUDE_KEY`, and a second copy of the Google client id and secret. |
| `D:\repos\edmund-landgraf\WandersGuideUI\.env.local.template` | Names only. Safe to commit. |

`POSTGRES_PASSWORD` is the password PostgREST, GoTrue, and Storage are supposed to use for the roles `authenticator`, `supabase_auth_admin`, and `supabase_storage_admin`. It is also the `postgres` superuser password inside the database container. The database volume stores the role passwords that were applied at init (or by a later `ALTER ROLE`). Changing `.env` does not change those roles.

`docker/wgui-functions.compose.yml` passes `ADMIN_PANEL_PASSWORD` from the stack `.env` into the functions container. An empty value makes `admin-unlock` return `ADMIN_PASSWORD_UNSET`. After changing it, recreate the functions container (`npm run stack:up`); a running container keeps the old env.

Postgres data is the Docker volume for `wanderers-guide-db-1`, published on `127.0.0.1:54322`. Wiping that volume is a new database. It is not a password fix.

## What happened on 2026-10-29

### PostgREST

`wanderers-guide-rest-1` was restarting. Its log was:

`password authentication failed for user "authenticator"`

against `db` port 5432. Kong was healthy and `kong` resolved from the functions container (`172.19.0.8` that day). `getent hosts rest` from Kong failed because the restarting container had no network alias.

The role passwords and the container env had drifted:

| Container | Password it was started with |
|---|---|
| `wanderers-guide-db-1` `POSTGRES_PASSWORD` | 33 characters |
| `wanderers-guide-auth-1` GoTrue URL | same 33 characters |
| `wanderers-guide-rest-1` `PGRST_DB_URI` | a different 64-character password |
| `wanderers-guide-storage-1` `DATABASE_URL` | that same 64-character password |

Auth was already up. Rest and storage had been created earlier, when `.env` still had the old password, and had not been recreated after the password change. The volume kept the old role passwords until they were altered.

`wanderers-guide/docker/db-init/zzz-passwords.sh` is the script that runs:

```sql
ALTER ROLE authenticator           WITH LOGIN PASSWORD '<POSTGRES_PASSWORD>';
ALTER ROLE supabase_auth_admin     WITH LOGIN PASSWORD '<POSTGRES_PASSWORD>';
ALTER ROLE supabase_storage_admin  WITH LOGIN PASSWORD '<POSTGRES_PASSWORD>';
```

Docker only runs scripts in `docker-entrypoint-initdb.d` when the data directory is empty. A volume that already has data skips it. Editing `.env` or restarting `db` does not re-run it.

The repair that worked:

1. Inside the **running** database container, set those three roles to that container's current `POSTGRES_PASSWORD` (the 33-character value auth was already using).
2. Recreate **rest** and **storage** from `D:\repos\edmund-landgraf\wanderers-guide` so their URIs are rendered from the current `.env`.

After that, rest logged `Successfully connected to PostgreSQL` and Kong could open `http://rest:3000/`.

Setting the roles to the database container's password and leaving rest on the old URI does nothing. That was the first attempt. Rest kept failing until it was recreated.

### Export worker

`supabase/wgui-export/_wgui-export/connect-raw.ts` imports `./caller-auth.ts`. That helper is not in upstream `wanderers-guide` `main`. It lives in this repo at `supabase/wgui-export/_wgui-export/caller-auth.ts`. See `docs/export-caller-auth-plan.md` for why it cannot live only on the wanderers-guide checkout.

`/home/deno/functions` inside `wanderers-guide-functions-1` is a tmpfs. The entrypoint in `docker/wgui-functions.compose.yml` fills it at **start**:

- Base: `D:\repos\edmund-landgraf\wanderers-guide\supabase\functions` mounted at `/wgui-fn/base`
- Overlay: `D:\repos\edmund-landgraf\WandersGuideUI\supabase\wgui-ext` and `supabase\wgui-export`

A file saved on disk after the container started is not in the tmpfs. The worker then fails at boot with `failed to create the graph` because the import does not exist. The launcher stays yellow. Restarting the functions container copies the overlay again. After the 2026-10-29 restart, `/home/deno/functions/_wgui-export/caller-auth.ts` was present and a no-auth POST returned `401` with `"status":"fail"`, which the probe counts as up.

## How this happens again

**Password drift**

- Someone changes `POSTGRES_PASSWORD` in `wanderers-guide\.env` and recreates `db` or `auth` only.
- A restored database dump was taken under a different password than the `.env` in use now.
- `rest` or `storage` is left running across a compose change. `docker restart` keeps the old env. Only create / recreate / `up` reads `.env` again.
- `zzz-passwords.sh` is edited and nobody applies it to the existing volume.

**Export stays yellow**

- `caller-auth.ts` is added or edited, and `wanderers-guide-functions-1` is not restarted.
- The functions container is recreated from a checkout where `connect-raw.ts` still imports `../_shared/caller-auth.ts` and that file is not in the wanderers-guide tree. The overlay copy must stay `./caller-auth.ts` next to `connect-raw.ts`.
- The entrypoint's copy list drops `_wgui-export`. The import then resolves to nothing.
- Any new file under `supabase/wgui-export/_wgui-export/` or `supabase/wgui-ext/_wgui-ext/` has the same rule: it is visible to Deno only after a functions restart.

**Looks like the same bug and is not**

- `InvalidWorkerCreation` on a different function means that function's own import failed. Read the functions log for the function name before treating it as the export file.
- A red launcher row is `404` (function directory not copied). Yellow is a worker that did not return JSend.
- Auth login failures after a password change mean `supabase_auth_admin` was altered to a value GoTrue's container does not have. Recreate `auth` from the same `.env`, or set the role back to the password in that container's `GOTRUE_DB_DATABASE_URL`.

## What to check

Run these from any directory. They do not print secrets.

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
```

`wanderers-guide-rest-1` should be `Up`, not `Restarting`. Then:

```powershell
docker logs wanderers-guide-rest-1 --tail 20
```

Healthy: `Successfully connected to PostgreSQL`. Broken: `password authentication failed for user "authenticator"`.

Confirm the four passwords are the same length and the same SHA-256, still without printing them:

```powershell
python -c @"
import json, subprocess, hashlib
from urllib.parse import urlparse, unquote

def show(name, key):
    spec = json.loads(subprocess.check_output(['docker','inspect',name]))
    env = dict(x.split('=',1) for x in spec[0]['Config']['Env'])
    raw = env.get(key, '')
    who = key
    if '://' in raw:
        u = urlparse(raw)
        raw = unquote(u.password or '')
        who = u.username
    print(name, who, len(raw), hashlib.sha256(raw.encode()).hexdigest())

show('wanderers-guide-db-1','POSTGRES_PASSWORD')
show('wanderers-guide-rest-1','PGRST_DB_URI')
show('wanderers-guide-auth-1','GOTRUE_DB_DATABASE_URL')
show('wanderers-guide-storage-1','DATABASE_URL')
"@
```

All four lines must share one hash. If rest is restarting, `docker exec` into it will fail; `docker inspect` still works, which is why the snippet uses inspect.

Kong must resolve `rest` once the container stays up:

```powershell
docker exec wanderers-guide-kong-1 wget -qO- --timeout=5 http://rest:3000/ | Select-Object -First 1
```

A JSON OpenAPI document means the alias exists. `bad address 'rest:3000'` means rest is not on the network.

Export probe (the literal `anon` token is not a JWT; a `401` JSend `fail` is still **up**):

```powershell
curl.exe -sS -m 30 -D - -X POST http://127.0.0.1:8000/functions/v1/wgui-export-character -H "Content-Type: application/json" -H "Authorization: Bearer anon" -H "apikey: anon" -d "{}"
```

Up: HTTP 401 and a body containing `"status":"fail"`. Broken: HTTP 500 and `failed to create the graph`. Then confirm the file the tmpfs actually has:

```powershell
docker exec wanderers-guide-functions-1 ls /home/deno/functions/_wgui-export/caller-auth.ts
```

`No such file` means the container was started before that file existed, or the overlay copy failed. The source of truth on disk is:

`D:\repos\edmund-landgraf\WandersGuideUI\supabase\wgui-export\_wgui-export\caller-auth.ts`

Reload the launcher after a functions restart. The page probes once on load.

## How to fix

Do the password repair from `D:\repos\edmund-landgraf\wanderers-guide` so Compose loads that directory's `.env`. Do not point Compose at WandersGuideUI.

### 1. Align the roles with the database container

The database container already has the password auth is using. This reads it inside the container and does not print it. PowerShell here-string, so the SQL is not split by the host shell:

```powershell
docker exec wanderers-guide-db-1 bash -c @'
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pw="$POSTGRES_PASSWORD" <<EOF
ALTER ROLE authenticator WITH LOGIN PASSWORD :'pw';
ALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD :'pw';
ALTER ROLE supabase_storage_admin WITH LOGIN PASSWORD :'pw';
EOF
'@
```

`ALTER ROLE` is three lines of `ALTER ROLE` on success. This changes the live roles immediately. Any container still holding the old password will start failing until step 2.

### 2. Recreate the services that still have the old URI

```powershell
cd D:\repos\edmund-landgraf\wanderers-guide
docker compose up -d --force-recreate --no-deps rest storage
```

If the hash check shows auth on a different hash than `db`, recreate auth the same way (`--no-deps auth`) **after** the roles match `POSTGRES_PASSWORD` in `.env`. Recreate rest before testing the app. `docker restart` is not a substitute.

Wait a few seconds and re-check the rest log for `Successfully connected`.

### 3. Restart functions after any overlay edit

```powershell
docker restart wanderers-guide-functions-1
```

Wait until `caller-auth.ts` is listed inside the container, then run the curl probe. Reload the launcher.

If the graph error remains, read the functions log and the import at the top of `connect-raw.ts`. It must be `./caller-auth.ts`. A missing import that points at `../_shared/caller-auth.ts` will keep failing on a wanderers-guide `main` tree, because that file is not part of upstream.

### 4. Order when both are broken

Align roles, recreate rest and storage, then restart functions. The export worker also calls `http://kong:8000`. A green export row with rest still down will flip back to failures as soon as a real export runs, even if the boot probe is green (the probe only checks that the worker returns JSend).

## Making a local user an admin

Admin is `public.public_user.is_admin`. It is not an Auth role and not a key in `.env`. On 2026-10-29, `edmund.landgraf@gmail.com` was set with:

```sql
UPDATE public.public_user pu
SET is_admin = true
FROM auth.users u
WHERE pu.user_id = u.id
  AND lower(u.email) = lower('edmund.landgraf@gmail.com');
```

Run that with `psql` inside `wanderers-guide-db-1` as `POSTGRES_USER`. The row that came back was `public_user.id = 2`. A restored dump can clear the flag. The app may keep the old profile until the next sign-in.

There is no automated check that re-applies this. After a volume restore, run the update again and confirm one row.

## What not to do

- Do not `docker compose down -v` to "reset passwords". That deletes the database volume.
- Do not copy `POSTGRES_PASSWORD` onto the command line in a way that lands in shell history in clear text. The `docker exec` snippet above keeps it inside the container.
- Do not commit `wanderers-guide\.env` or `WandersGuideUI\.env.local`.
- Do not treat a yellow export row as a Kong or Postgres outage. Read the body. `failed to create the graph` is a missing module in the tmpfs.
