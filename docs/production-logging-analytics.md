# Production logging and page analytics (amba only)

Dev stays as it is. Kong file logs, nginx access logs, and a page-analytics container run only on the Linux production host (`amba`). Windows `npm run stack:up` does not load them.

## Why not the shared compose file

`stack:up` merges the wanderers-guide `docker-compose.yml` on both the Windows dev box and amba. A service or Kong plugin added there turns on for both. Production-only pieces live in an override that only amba’s start command passes, for example `docker-compose.logging.yml` next to the stack on the VPS.

## What to add

Two separate jobs. The official Supabase analytics service (Logflare + Vector) does neither of these well enough to be worth the extra database, and it does not record frontend page views.

### API and access logs

- Kong `file-log` on the `/auth`, `/rest`, `/storage`, and `/functions` routes.
- nginx access logs for the old Docker frontend (`amba.wandersguide.site`, `127.0.0.1:5193`) and for WandersGuideUI (`wgui.wandersguide.site`).

That is enough to see route, status, and auth failures with `docker logs` or the log files. Skip Logflare unless Studio’s log viewer becomes a daily tool.

### Page analytics

One self-hosted Umami or Plausible container on amba, bound to localhost, reached through Apache like the rest of the stack. The same script tag goes on:

- the old frontend (wanderers-guide Docker image; that source is not this repo — patch it on the VPS, see `docs/local-upstream-patches.md`)
- this UI (WandersGuideUI), behind a production build check so `vite` dev never loads the script

One site in the analytics app per hostname, so the two frontends stay separate.

## What stays off

| Piece | Where |
|---|---|
| Logging override, analytics container, Kong `file-log` | Dev / `stack:up` |
| Realtime, imgproxy, inbucket | Both |
| Logflare / Supabase analytics | Both, until Studio logs are actually wanted |
| TLS inside the compose stack | Both — Apache already terminates TLS |
| Postgres backups | Separate scheduled dump of the `db` volume, not this override |

Signup and password reset still need GoTrue pointed at real SMTP. That is auth config, not a logging container.

## Rollout

1. On amba only, add `docker-compose.logging.yml` and include it in the command that starts the stack. Do not commit it into the compose file that `stack:up` always loads.
2. Confirm Kong is writing request lines and both nginx frontends are writing access lines.
3. Add the analytics script to the old frontend and to a production-only build of this UI.
4. Hit each site once and confirm the hit shows under the matching hostname.
5. Leave a Windows `stack:up` running and confirm it did not start the analytics container and did not gain the Kong plugin.
