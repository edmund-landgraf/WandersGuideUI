# Keep character export booting without upstream `caller-auth`

Incident date: 2026-10-27. Host: `amba.wandersguide.site` functions container `wanderers-guide-functions-1`. Launcher row: `wgui-export-character` / export / character file.

This is the follow-up. Export is answering again because `_shared/caller-auth.ts` was copied onto the VPS `wanderers-guide` checkout. That file is not part of upstream `main`, and this repo cannot push it there. The next functions update that replaces `_shared` will drop it and the worker will fail to boot again.

## What went wrong

`supabase/wgui-export/_wgui-export/connect-raw.ts` has imported `../_shared/caller-auth.ts` since `79526fc`. The helper is not in this repository. It lives on the `wanderers-guide` branch `security/function-auth`. Upstream `main` does not have it.

`docker/wgui-functions.compose.yml` fills `/home/deno/functions` from two read-only mounts:

- Base: `wanderers-guide/supabase/functions` (`WG_FUNCTIONS_DIR`, production `main`)
- Overlay: this repo’s `supabase/wgui-ext` and `supabase/wgui-export`

The entrypoint copies the whole base, then only these overlay directories:

- `/wgui-fn/ext/_wgui-ext`
- `/wgui-fn/ext/wgui-ext-*`
- `/wgui-fn/export/_wgui-export`
- `/wgui-fn/export/wgui-export-*`

`../_shared/caller-auth.ts` resolves in the base tree. Until the container is recreated, the running worker is the previous copy, so export can keep answering after the import lands in git.

On 2026-10-27 the functions container was restarted while the VPS checkout stayed on `wanderers-guide` `main` (`959d39fc`). `security/function-auth` had been fetched and its SQL applied. `FETCH_HEAD` is not what the container copies. The new worker was `main` plus the current overlay. The import was missing, and every call returned:

`InvalidWorkerCreation: worker boot error: failed to create the graph`

The launcher probe treats a body without JSend `status` of `success`, `fail`, or `error` as unconfirmed, which is the amber mark. The other rows do not import that file, so they stayed green.

A no-auth POST now returns `401` with `"status":"fail"` and `AUTH_REQUIRED`, which the probe counts as up. The file on disk is untracked:

`/home/administrator/wanderers-guide/supabase/functions/_shared/caller-auth.ts`

## Durable fix

Ship the helper inside the export overlay, then delete the stray file on the upstream checkout.

1. Add `supabase/wgui-export/_wgui-export/caller-auth.ts` with the three helpers `connect-raw.ts` already calls: `authenticateBearer`, `grantedCharacterIds`, and `scopeBodyToGrants`. They depend on `http-errors`, `content`, and `jose`, which the base image already has.
2. Point `connect-raw.ts` at `./caller-auth.ts`. The entrypoint already copies `_wgui-export`, so the compose file stays as it is.
3. Restart `wanderers-guide-functions-1`. A no-auth POST to `/functions/v1/wgui-export-character` should still return `401` with `"status":"fail"`.
4. Remove `/home/administrator/wanderers-guide/supabase/functions/_shared/caller-auth.ts`.
5. Replace the boot warning in `docs/wgui-ext-key-scoped.md` (deploy note 4). Export should no longer depend on `security/function-auth`.

An upstream pull cannot take export down after that. If `security/function-auth` later adds its own `_shared/caller-auth.ts`, the two files do not share a path, so export keeps using the overlay copy.

Do not wait on merging `security/function-auth` into `wanderers-guide` `main`. This account gets `403` pushing to `wanderers-guide/wanderers-guide`.
