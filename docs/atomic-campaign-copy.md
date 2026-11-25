# Atomic campaign duplication (#73)

Apply `supabase/wgui-campaign-copy.sql` to the existing Wanderers Guide Postgres database **before** deploying the frontend and restarting the functions overlay. It is additive and rerunnable. For a Docker stack, from the WGUI checkout (adjust the DB container name if necessary):

```sh
docker exec -i wanderers-guide-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/wgui-campaign-copy.sql
npm run stack:restart
npm run test:wgui-ext
```

The frontend must not fall back to the old non-atomic writes when the worker or RPC is missing. Deploy frontend using the normal build procedure after the SQL and edge worker are available.

Database rows and the idempotency receipt commit together. Retry with the same caller and operation UUID returns the same target; a new UUID intentionally makes a new copy. The frontend retains the UUID and staged banner URL until a confirmed response (including same-tab reloads, where session storage is available). Storage is not part of a Postgres transaction: a failed copy can leave a staged banner upload; the retry reuses it. Do not automatically delete URLs because the existing uploader can return a source/public URL on failure. Abandoned uploads need a separately verified ownership-aware cleanup; #74 and #75 cover artwork migration and failure handling. Closing the tab or disabling session storage limits retry recovery.

The current copy authorization policy is unchanged (#71); dry-run enumeration remains separate (#72). Run the SQL failure-injection test only on an isolated test database with an existing auth user, passing that user's UUID as `test_user_id`. It rolls back its fixtures and trigger.

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -v test_user_id=YOUR_TEST_USER_UUID -f supabase/tests/wgui-campaign-copy.sql
```

## Encounter and combatant artwork (#75)

After the original #73 SQL, apply `supabase/wgui-campaign-copy-art.sql` before deploying the #75 worker and frontend. For subsequent deployments, apply both SQL files in order, then restart the stack. Do not deploy an older frontend against the new RPC contract.

The prepare call returns a deduplicated manifest from the source campaign metadata and sanitized encounter/combatant JSON. Supported explicit URL fields include image, background, portrait, map, token and art URL variants (snake_case and camelCase), including `creature.details` and `data.details`. The final transaction rewrites only these fields and refuses an incomplete map. It does not migrate URLs embedded in free-form descriptions, notes, rich text or unknown attachment formats. Inline image data stays embedded; external links and shared PF2 catalog routes stay referenced. PF2 catalog availability remains governed by that service. Public WG storage and site-hosted images are re-uploaded through the signed-in user's existing public-file upload endpoint. Private/signed objects, unsupported image formats, unknown storage hosts and images exceeding the current 2 MB upload cap cause explicit failure rather than source URL fallback. No source objects are deleted. Repeated exact URLs upload once per pending operation, and a committed receipt is returned before staging on retries. Abandoned staged uploads still need ownership-aware cleanup.

Regression coverage: `npx vitest run src/pages/phase1/phase1-campaign-copy-art.test.ts` and, on an isolated test database after both migrations:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -v test_user_id=YOUR_TEST_USER_UUID -f supabase/tests/wgui-campaign-copy-art.sql
```

## Copy authorization (#71)

Apply `supabase/wgui-campaign-copy-permission.sql` **after** the #73 and #75 migrations and before the new edge worker and frontend. Existing campaigns are private by default. The campaign owner can opt in from Phase 1 Campaign Settings → Game Config → Campaign copying. This explicitly grants full copy access (including hidden encounters and GM-only notes) to authenticated users who can already read the campaign. Normal player encounter visibility is unchanged. Grant records are separate from player-editable campaign metadata and are not inherited by duplicated campaigns. Revocation prevents future copies, not copies already created. The edge checks readability and copy permission; the transaction also checks current ownership/consent and locks the source/permission rows against revocation during commit. Direct browser calls cannot write the grant table or invoke its service-only RPCs. Reapply #71 last if reapplying earlier migrations.

```sh
docker exec -i wanderers-guide-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/wgui-campaign-copy-permission.sql
npm run stack:restart
npm run test:wgui-ext
```

## Strict artwork verification (#74)

The copy path no longer has a best-effort source-URL fallback. It uses the copy caller's access token for uploads and verifies the returned object is a distinct path in configured public storage, anonymously readable, with matching supported image bytes. An HTTP, CORS, format, upload, or destination verification failure stops the copy before the commit call and surfaces a retryable error. Shared external/catalog links and embedded image data are intentionally retained and reported separately from a confirmed banner re-host. A recovered receipt without a matching locally staged URL is reported as unverified, not re-hosted. Ordinary portrait/banner picker fallback behavior is unchanged. Configure VITE_PUBLIC_STORAGE_ORIGIN to match the destination stack. No additional database migration is needed. The actual storage owner metadata and source-deletion independence should still be checked on a disposable test campaign in the deployed stack.

## Read-only campaign copy CLI (#76)

Run from the WGUI checkout with Node 20+ and installed project dependencies (`npm ci`). Supply the stack API origin, its **public anon/publishable key**, and a currently valid signed-in user access token via your shell environment. Do not use a service-role key or paste secrets into command arguments, logs, or source control. The CLI does not automatically load Vite's .env.local. The older CAMPAIGN_COPY_USER_ID variable is optional; when set, it must match the user verified by GoTrue. Never decode an unverified JWT to decide identity.

PowerShell (environment variable values should be populated privately before running):

```powershell
# Set SUPABASE_URL, SUPABASE_ANON_KEY and CAMPAIGN_COPY_TOKEN in the environment first.
npm run dry-run:campaign-copy -- 41
```

Bash (same required environment):

```sh
npm run dry-run:campaign-copy -- 41
```

Use `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` as equivalent environment aliases. Use HTTPS for remote stacks (HTTP is accepted for loopback development). Optional `VITE_PUBLIC_ASSET_ORIGIN` and `VITE_PUBLIC_STORAGE_ORIGIN` match the deployment artwork settings. `npm run dry-run:campaign-copy -- --help` prints the full usage without contacting the API. Exit codes: 0 = successful plan/help, 2 = invalid argument/configuration or optional identity mismatch, 1 = authentication/read/authorization failure. The plan reports counts, encounter names and planned banner action (none, keep, rehost, blocked); artwork query strings, credentials and embedded image bytes are omitted. It does not fetch or upload artwork or create a copy. The full-copy read endpoint requires the owner or a readable, explicitly copy-enabled campaign. No fallback to play-filtered reads. Run `npm run test:campaign-copy-cli` for isolated subprocess tests using a local HTTP fixture server.

Both CLI npm scripts build through `node scripts/build-campaign-copy-cli.mjs`. This helper resolves esbuild from the installed dependencies (including Vite's nested dependency) and calls its JavaScript API. It does not require a globally installed executable, npm's `.bin` shim, `npx`, or a separate registry download. If the installed dependency is missing, run `npm ci --include=dev`.

## Complete encounter enumeration (#72)

Apply `supabase/wgui-campaign-copy-completeness.sql` **after #71** before restarting the edge overlay and deploying the frontend/CLI. Full-copy reads use a scalar database JSON aggregate (not a paginated REST row query); the explicit count and sorted unique IDs prove completeness, including zero encounters. Ordinary play reads are unchanged. Prepare returns a counted encounter-ID manifest alongside artwork. Commit takes the prepared IDs, reads a fresh database snapshot, and refuses stale sets before creating a target. The transaction also verifies the inserted row count and rolls back on a short insert. A recovered receipt includes its encounter count. Old array-only responses or uncounted prepares fail closed in new clients; deploy server first. Legacy full-copy list callers still receive a complete array. Do not automatically retry writes; failed reads can be retried manually. Reapply this migration last if reapplying earlier copy migrations.

```sh
docker exec -i wanderers-guide-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/wgui-campaign-copy-completeness.sql
npm run stack:restart
npm run test:wgui-ext
npm run test:campaign-copy-cli
npx vitest run src/pages/phase1/phase1-campaign-copy-manifest.test.ts
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -v test_user_id=YOUR_TEST_USER_UUID -f supabase/tests/wgui-campaign-copy-completeness.sql
```

The isolated SQL test covers 1001+ encounters, stale manifests, suppressed inserts, rollback and successful full copies. Large aggregate responses may hit transport/memory limits; such failures must abort rather than return partial success.
