# amba / vps-ahhh: host reboot, PostgREST exit, functions overlay

**Incident date:** 2026-11-28  
**Host:** Linux VPS (`vps-ahhh`, production `amba.wandersguide.site` / `wgui.wandersguide.site`)  
**GitHub:** [#108](https://github.com/edmund-landgraf/WandersGuideUI/issues/108) (documented, `wontfix` — manual recovery only)

**Status:** Known operational hazard. Not on the engineering fix backlog unless reboot or compose behavior changes.

## What users saw

- **Phase 1 / Campaigns:** `find-campaign: An unexpected error occurred` on the campaign workspace while signed in.
- **Saved shops:** red error **“An unexpected error occurred”** on folder create / library load (syndication hits PostgREST).
- **Broader API:** Same generic message on many stock edge functions (`find-character`, `get-user`, `wgui-ext-ensure-public-user`, `find-content-source`, `find-trait`, `find-item`, …).

Auth and the SPA shell could still load; failures were **data** calls that reach Postgres through Kong → **PostgREST** (`rest`).

## Root cause (what we know)

Two independent problems appeared after a **host reboot** following `apt-get upgrade` on the VPS (reboot window ~**2026-11-28 03:06 UTC**).

### 1. PostgREST container exited and did not come back

`docker ps -a` showed **`wanderers-guide-rest-1` → Exited (255)** for ~11 hours while `db`, `kong`, `auth`, `functions`, and most other stack containers were **Up**.

`docker inspect wanderers-guide-rest-1` reported **`RestartPolicy=unless-stopped`**, but rest **stayed exited** until manual intervention (`docker start` / compose up).

**PostgREST log at shutdown / reboot** (`docker logs wanderers-guide-rest-1`):

```text
FATAL:  terminating connection due to administrator command
28/Nov/2026:03:06:24 +0000: Attempting to connect to the database...
28/Nov/2026:03:06:24 +0000: {"code":"PGRST000","details":"connection to server at \"db\" (172.18.0.11), port 5432 failed: FATAL:  the database system is shutting down\n","hint":null,"message":"Database connection error. Retrying the connection."}
28/Nov/2026:03:06:24 +0000: Attempting to reconnect to the database in 0 seconds...
28/Nov/2026:03:06:24 +0000: Failed listening for notifications on the "pgrst" channel. server closed the connection unexpectedly
     This probably means the server terminated abnormally before or while processing the request.
28/Nov/2026:03:06:24 +0000: Retrying listening for notifications in 1 seconds...
```

**Database** came back normally a few seconds later (`docker logs wanderers-guide-db-1`):

```text
2026-11-28 03:07:01.194 UTC [1] LOG:  database system is ready to accept connections
```

**GoTrue** briefly failed DB connect during the same window, then restarted successfully once `db` was up (`docker logs wanderers-guide-auth-1`):

```text
{"level":"fatal","msg":"running db migrations: ... failed to connect to `host=db user=supabase_auth_admin database=postgres`: dial error (dial tcp 172.18.0.9:5432: connect: connection refused)","time":"2026-11-28T03:06:58Z"}
...
{"level":"info","msg":"GoTrue API started on: 0.0.0.0:9999","time":"2026-11-28T03:07:02Z"}
```

We did **not** capture the exact final line that made the rest **process** exit with code 255; the last retained logs are the `PGRST000` shutdown/reconnect loop. Hypothesis: rest died during the db shutdown race and Docker did not leave the container running/restarting as expected on this host (second time observed after reboot — see issue #108).

**With rest down**, Kong still routes `/rest/v1` to the `rest` service name. Edge functions use PostgREST via Kong; when `rest` is unreachable they surface a generic failure.

**Edge runtime log** while rest was down (`docker logs wanderers-guide-functions-1`):

```text
[Error] {"evt":"unhandled_error","fn":"find-campaign","message":"An unexpected error occurred"}
[Error] { message: "An unexpected error occurred" }

[Error] {"evt":"unhandled_error","fn":"find-character","message":"An unexpected error occurred"}
[Error] {"evt":"unhandled_error","fn":"get-user","message":"An unexpected error occurred"}
[Error] {"evt":"unhandled_error","fn":"wgui-ext-ensure-public-user","message":"An unexpected error occurred"}
[Error] {"evt":"unhandled_error","fn":"find-content-source","message":"An unexpected error occurred"}
[Error] {"evt":"unhandled_error","fn":"find-trait","message":"An unexpected error occurred"}
[Error] {"evt":"unhandled_error","fn":"find-item","message":"An unexpected error occurred"}
```

**After `docker start wanderers-guide-rest-1`**:

```text
28/Nov/2026:13:50:35 +0000: Starting PostgREST 12.2.0...
28/Nov/2026:13:50:35 +0000: Successfully connected to PostgreSQL 15.6 ...
28/Nov/2026:13:50:36 +0000: Schema cache loaded 28 Relations, 32 Relationships, 40 Functions, ...
```

**Connectivity check** (from Kong container after rest was up):

```text
docker exec wanderers-guide-kong-1 wget -qO- http://rest:3000/
# → PostgREST swagger JSON ({"swagger":"2.0",...})
```

### 2. Incorrect recovery stripped the functions overlay

First recovery attempt used **only** `docker compose up -d` in `/home/administrator/wanderers-guide` (stock compose files, no WGUI launcher).

That **recreated `wanderers-guide-functions-1`** without `scripts/wgui-ext.mjs` + `docker/wgui-functions.compose.yml`.

**Wrong bind mount** (`docker inspect wanderers-guide-functions-1 --format '{{json .HostConfig.Binds}}'`):

```json
["/home/administrator/wanderers-guide/supabase/functions:/home/deno/functions:ro"]
```

**Correct binds after `npm run stack:restart`** from WandersGuideUI with `WG_DIR=/home/administrator/wanderers-guide`:

```json
[
  "/home/administrator/wanderers-guide/supabase/functions:/wgui-fn/base:ro",
  "/home/administrator/node-sites/WandersGuideUI/supabase/wgui-ext:/wgui-fn/ext:ro",
  "/home/administrator/node-sites/WandersGuideUI/supabase/wgui-export:/wgui-fn/export:ro"
]
```

The overlay entrypoint copies `wgui-ext-*` and `wgui-export-*` from those mounts into the tmpfs at `/home/deno/functions` (see `docker/wgui-functions.compose.yml`).

**Overlay guard** when `compile.bundle.js` was stale (`npm run stack:restart`):

```text
wgui-ext: refusing to recreate functions; the running container was left in place.
- .../wgui-export-character/compile.bundle.js: compile.bundle.js predates the slim compiler/state cleanup contract. Run npm run export:bundle before recreating functions.
```

Fix on VPS: `npm run export:bundle`, then `npm run stack:restart`.

### 3. Separate export worker error (same log window, not the campaign outage)

The functions log also contained a **worker boot** failure for `wgui-export-character` (stale bundle / missing export), which is a different class of failure from PostgREST being down:

```text
Uncaught SyntaxError: The requested module './compile.bundle.js' does not provide an export named 'clearExportState'
    at file:///home/deno/functions/wgui-export-character/index.ts:9:35
InvalidWorkerCreation: worker boot error: ...
```

Export is covered in `docs/local-stack-rest-and-export-boot.md`; the 2026-11-28 user-facing campaign/shop breakage tracked **rest** first.

## Timeline (UTC, 2026-11-28)

| Time (approx) | Event |
|---------------|--------|
| 03:06 | Host reboot / db shutdown; rest logs `PGRST000`, notification listener failures |
| 03:07 | `db` ready; GoTrue starts after brief connection refused |
| ~03:07–13:50 | `rest` **Exited (255)**; edge functions log `unhandled_error` / “An unexpected error occurred” |
| 13:50 | Manual `docker start wanderers-guide-rest-1` → Postgres connect OK |
| 13:51 | Bare `docker compose up -d` in wanderers-guide (recreated functions **without** overlay) |
| 13:53 | `npm run export:bundle` + `WG_DIR=... npm run stack:restart` from WandersGuideUI; overlay + Kong restart |

## Correct manual recovery

From `/home/administrator/node-sites/WandersGuideUI`:

```bash
export WG_DIR=/home/administrator/wanderers-guide

# 1) Ensure PostgREST is Up
docker ps -a --filter name=wanderers-guide-rest
# If not Up: docker start wanderers-guide-rest-1
# or: npm run stack:up

# 2) Overlay-aware functions + Kong
npm run export:bundle    # only if stack:restart / stack:up refuses (bundle guard)
npm run stack:restart    # or stack:up for full stack
```

See also `.cursor/rules/amba-stack-reboot.mdc` and `docs/local-stack-rest-and-export-boot.md` (production host section).

## What we are not doing (yet)

- Compose `depends_on` / healthcheck-driven auto-heal for `rest` on amba
- Host-level systemd or cron to assert `rest` is Up after reboot
- Changing wanderers-guide upstream compose in this repo

Those would live in wanderers-guide or VPS automation if prioritized later.