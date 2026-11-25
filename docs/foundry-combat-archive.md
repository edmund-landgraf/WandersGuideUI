# Foundry combat archive endpoint (#78)

Deploy `supabase/wgui-foundry-combat-archive.sql` to the WGUI database, then deploy `wgui-ext-append-foundry-combat-archive` using the existing WGUI extension deployment process. The API uses the existing key-scoped authorization wrapper (GM account API key or session JWT). The database RPC rechecks the campaign owner and encounter membership, and is restricted to service_role. No production migration is performed by this PR.

POST /functions/v1/wgui-ext-append-foundry-combat-archive
Authorization: Bearer <GM API key or session JWT>
JSON: { campaign_id, encounter_id, archive: { worldId, exportId, foundryCombatId, foundrySceneId, startedAt, endedAt, rounds, transcript } }

Each transcript row is a structured public participant roll with messageId, at, round, speaker {alias,actor,token}, rolls [{total,formula}]. No arbitrary chat HTML, combatants, credentials or flags. Max 100 events, 10 rolls/event, 60 KiB normalized payload, 100 canonical archives or 1 MiB cumulative canonical payload per encounter (whichever comes first). Retry the identical payload and mapping after timeout/503; receipt is stable for the same world/export and conflicting content is 409. Response data: receipt, worldId, exportId, campaignId, encounterId, idempotent.

Canonical receipts persist in a service-only table; the encounter metadata mirror is maintained by a trigger so legacy whole-meta writes cannot erase or inject archives. New encounter copies do not inherit archives. Test database only: validate player/foreign campaign denial, concurrent append/dice update and identical retry, conflicting duplicate, deletion and copy behavior before rollout. Existing historical logs are preserved. Rollback requires a reviewed migration; do not drop the archive table if it contains live receipts.

CI runs the migration twice on a disposable PostgreSQL 16 schema and exercises distinct and identical concurrent appends alongside a stale metadata write. The real WGUI schema/edge function still needs staging verification before production rollout.
