# WandersGuideUI integration priorities

WandersGuideUI work only, ranked 1–7. Do them in this order. Each item depends on the ones above it where noted.

| Priority | Repository | Change |
| --- | --- | --- |
| 1 | WandersGuideUI | Secure the Owlbear authentication handoff |
| 2 | WandersGuideUI | Security tests fail when infrastructure is missing |
| 3 | WandersGuideUI | Field-specific campaign, character, and encounter DTOs |
| 4 | WandersGuideUI | Strict validation at every integration boundary |
| 5 | WandersGuideUI | Optimistic concurrency on dice updates |
| 6 | WandersGuideUI | Contract tests for export, queue, retry, and placement |
| 7 | WandersGuideUI | Maintainability after the contracts are fixed |

Priority 1 is the live credential leak. Priority 2 is small and makes every later security check fail closed. Priorities 3 and 4 define the payloads and the parser. Priority 5 is data loss on one write path. Priority 6 locks 3–5. Priority 7 deletes the old paths only after those contracts exist.

## 1. WandersGuideUI — Secure the Owlbear authentication handoff

`src/pages/OwlbearAuthPage.tsx` posts the live session to `window.opener`. It checks that `targetOrigin` is an `http` or `https` URL, then sends both `accessToken` and `refreshToken` with `postMessage`.

Replace that handoff:

- Allowlist known Owlbear extension origins. Reject every other origin, including arbitrary `https` origins.
- Require a nonce issued for this handoff and check it on the message.
- Validate the sender (`event.source` / opener) before accepting or sending credentials.
- Exchange a short-lived, single-use code for a session. Do not put the refresh token in `postMessage`.

A refresh token in a cross-window message is a long-lived credential. Anyone who can open this page with a chosen `targetOrigin` can receive it.

### Code plan

- Add `supabase/wgui-ext/wgui-ext-owlbear-exchange/index.ts`. `POST` with the caller JWT inserts a single-use code (random, hashed at rest), `user_id`, expiry (~60s), and a consumed-at column. `POST` with `{ code }` and no session returns a new session via the GoTrue admin API, then marks the row consumed. A second redeem is 410.
- Migration: `owlbear_auth_code (id, code_hash, user_id, expires_at, consumed_at)`. Service role only. No grant to `authenticated`.
- Rewrite `allowedTarget` in `src/pages/OwlbearAuthPage.tsx` to an explicit origin list (Owlbear extension origins used in dev and production). Drop the “any http(s) origin” check.
- The page reads `nonce` from the query string. It calls the exchange function, then `postMessage`s `{ type: 'wgui-owlbear-auth', nonce, code }` to `window.opener` only when `window.opener` is non-null. Delete `accessToken` and `refreshToken` from the payload.
- The extension redeems `code` on its own origin. This repo does not accept a message back from the opener.

## 2. WandersGuideUI — Security tests must fail when infrastructure is missing

Required security tests currently depend on environment and can be ignored when Supabase, keys, or the edge runtime are absent. That turns a missing check into a green run. Fix this before the DTO, validation, and auth tests, or those new tests can be skipped the same way.

If the infrastructure those tests need is not configured:

- Fail the job.
- Name the missing dependency in the failure.

Do not skip the suite because an env var is unset.

### Code plan

- `supabase/wgui-ext/_tests/wgui-ext.test.ts` sets `const skip = !SERVICE_ROLE_KEY || !ANON_KEY` and passes `ignore: skip` on every `Deno.test`. `supabase/wgui-export/_tests/wgui-export.test.ts` does the same via `stackUnavailable()`.
- Delete `ignore: skip`. At the start of each file, if `SERVICE_ROLE_KEY` or `ANON_KEY` is empty, `throw new Error('wgui security tests require SERVICE_ROLE_KEY and SUPABASE_ANON_KEY')`.
- `stackUnavailable()` in `supabase/functions/_tests/seed.ts`: throw with the missing variable name instead of returning `true`.
- CI workflow that runs `deno test` on `supabase/wgui-ext/_tests` and `supabase/wgui-export/_tests` must provide those env vars. A job without them is a failed check, not an empty pass.

## 3. WandersGuideUI — Field-specific campaign, character, and encounter DTOs

`wgui-ext` handlers authorize membership, then read with the service role and return rows that still carry fields the caller should not see. Encounter reads are unredacted. A full character sheet should not be part of the default payload for every party member.

Return explicit DTOs:

- Campaign: fields the caller’s role needs (roster, join state, owner email only on the owner path).
- Character: a party-visible summary by default; the full sheet only for the owner or a GM.
- Encounter: GM fields and player-visible fields as separate shapes.

Stop returning the service-role row as the response body.

### Code plan

- Add `supabase/wgui-ext/_wgui-ext/dto.ts` with three mappers, called after `authorizeCampaign` and before `return`:
  - `toCampaignDto(campaign, access)` — id, name, membership. `join_key` and owner email stay on `wgui-ext-campaign-owner-email` only, and only when `access.isGm`.
  - `toCharacterSummary(character)` — id, name, level, ancestry, class, hp. `toCharacterSheet(character)` — the current full row, only when `access.isGm` or `character.user_id` is the caller.
  - `toEncounterPlayerDto` / `toEncounterGmDto` — player shape omits hidden notes, unrevealed combatants, and other players’ dice secrets. GM shape keeps them.
- `wgui-ext-find-campaign-characters/index.ts`: stop `return { data: results }`. Map each row with the summary unless the caller owns it or is GM. Update the file comment that currently says party members see full sheets.
- `wgui-ext-find-encounter/index.ts`: replace `data: visible.map(withResolvedHitPoints)` with the role DTO after `withResolvedHitPoints`. Delete the comment that the player and GM payloads are identical.
- `src/schemas/content.ts` and `src/pages/phase1/phase1-player-combat.ts`: consume the player DTO. GM combat keeps the GM DTO. Do not fall back to reading missing sheet fields off the encounter snapshot.

## 4. WandersGuideUI — Validate every integration boundary

At each edge that accepts export, import, image, SVG, or queue payloads:

- Parse with a strict schema. Unknown fields fail.
- Check URL schemes and hosts before fetching or rendering.
- Cap payload size.
- Reject SVG and image input that fails the allowlist, instead of passing it through.

Validation belongs on the function that receives the body, before any service-role read or write. Priority 6 asserts this schema; write the schema first.

### Code plan

- Add `supabase/wgui-ext/_wgui-ext/validate.ts` and use it at the top of each `connect` callback, before `createServiceClient`:
  - Bodies parsed with `.strict()` so unknown keys are 400 `UNKNOWN_FIELD`.
  - `https` image URLs only, host on an allowlist, length cap. `javascript:`, `data:` (except an explicit image MIME if one is ever required), and bare hosts fail.
  - SVG: reject `<script`, event handlers, and external entity declarations. Size cap (for example 256 KB) checked on `Content-Length` and on the parsed body.
- Apply the same helper in `supabase/wgui-export/wgui-export-character/index.ts` to `id` and `format` before `fetchData`.
- Mirror the schemas in `src/schemas/requests.ts` for the client, and keep the server copies as the authority. Client schema failure does not replace the server check.

## 5. WandersGuideUI — Optimistic concurrency on dice updates

Dice log updates can replace client state with the server copy (`phase1-dice-check.ts`). Simultaneous player writes still need a revision check so one update cannot overwrite another.

On each dice write:

- Require the revision the client last read.
- Reject the write when that revision is stale.
- Return the current log and the new revision so the client can reconcile.

Do not last-write-wins on the shared dice log. Use the strict body parser from priority 4 for `dice_roll_revision`.

### Code plan

- Store `dice_roll_revision` as an integer on `encounter.meta_data` (no new column). `wgui-ext-find-encounter` returns it inside the dice fields of the DTO from priority 3.
- `PatchEncounterDiceBody` in `wgui-ext-patch-encounter-dice/index.ts` gains required `dice_roll_revision: number`.
- Before `admin.from('encounter').update`, compare `body.dice_roll_revision` to `currentMeta.dice_roll_revision ?? 0`. On mismatch throw `HttpError(409, ..., 'DICE_REVISION_CONFLICT')` and return the current `dice_roll_state`, `dice_roll_log`, and revision. On match write `revision + 1` in the same `meta_data` update.
- `src/pages/phase1/phase1-dice-check.ts`: send the revision from the encounter the client last applied. On 409, replace local dice state with the server body (the existing overlay path) and surface a conflict instead of retrying the stale write.
- Extend `phase1-dice-check.test.ts` with two overlapping patches: the second returns 409 and leaves the first log row intact.

## 6. WandersGuideUI — Contract tests for the integration

Add tests in this repo that lock the WandersGuideUI half of the Owlbear flow, against the DTOs from priority 3 and the schema from priority 4:

- Export payload matches the versioned schema this app publishes.
- Queue acceptance, retry, and idempotent replay behave the same on a second call.
- Import after reload does not duplicate or drop placements.
- Placement sync uses the agreed token keys.

Run these against the shared contract, not only against local mocks of the extension. Priority 2 already removed `ignore: skip`, so these tests fail when the stack is down.

### Code plan

- Add `supabase/wgui-export/_wgui-export/contract.ts`: Zod (or a checked JSON schema) for export version, token key, image URL, and placement. `wgui-export-character` validates `buildJsonV4Object` output against it before the response is sent.
- Add `supabase/functions/_tests/owlbear-contract.test.ts` next to the existing Deno tests (`wgui-export.test.ts`, `wgui-ext.test.ts`):
  - Export JSON fails the test if a required token key is missing or an unknown top-level field appears.
  - Post the same export twice. The second response is the same job id and does not insert a second queue row.
  - A failed job retried with the same idempotency key stays one row and moves to the retry state.
  - Reload fixture: placements keyed by the AMBA token still match after a second import; Owlbear item ids are not the identity.
- These tests call `callFunction` the same way `wgui-export.test.ts` does. They do not mock the handler.

## 7. WandersGuideUI — Maintainability after the contracts are fixed

Do this only after priorities 1, 3, and 4 are in place:

- Remove legacy fallback field names and payload shapes.
- Split orchestration (auth, queue, persistence) from parsing.
- Add structured error logs on the export and `wgui-ext` paths, with request id and failure stage and without tokens or sheet bodies.

TypeScript migration of critical modules follows the same cut: the contract is the source of truth, and the handlers only implement it.

### Code plan

- After priorities 1, 3, and 4: delete alternate field-name branches in the export builder and in `shared.ts` merge helpers. One name per field, matching `contract.ts`.
- Split `wgui-ext-patch-encounter-dice/index.ts` and `wgui-export-character/index.ts` so parsing lives in `validate.ts` / `contract.ts` and the handler only authorizes, reads, and writes.
- Replace `// @ts-ignore` on `import { serve }` and `compile.bundle.js` with a small `serve` type and a typed export of `buildJsonV4Object`. New modules under `supabase/wgui-ext` and `supabase/wgui-export` stay `.ts` with no new ignore comments.
- Add a `logStage(requestId, stage, code)` helper in `_wgui-ext/shared.ts`. Call it on 4xx/5xx in each handler. Log `requestId`, function name, stage (`auth`, `validate`, `read`, `write`), and error code. Do not log `Authorization`, refresh tokens, exchange codes, or character JSON.
