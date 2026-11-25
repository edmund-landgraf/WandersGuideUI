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
