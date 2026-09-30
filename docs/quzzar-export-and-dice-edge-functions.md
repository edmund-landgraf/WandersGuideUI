# Character export and encounter dice: two edge functions (for Quzzar)

This is an implementation brief for [wanderers-guide](https://github.com/wanderers-guide/wanderers-guide). It sits next to [`quzzar-player-combat-edge-functions.md`](./quzzar-player-combat-edge-functions.md). Wanders Guide UI (WGUI) already calls both routes. They currently live as overlays in the WGUI repo so your checkout stays clean. The request is to land them as first-class functions in **your** `supabase/functions/` tree so WGUI can drop the overlays.

**Do not change** `find-character`, `update-character`, `create-encounter`, `find-encounter`, or any RLS policy. Original WG stays owner-only encounter writes. These are **new** named endpoints.

| Function | Overlay in WGUI |
| --- | --- |
| `wgui-export-character` | [`supabase/wgui-export/`](../supabase/wgui-export/) |
| `wgui-ext-patch-encounter-dice` | [`supabase/wgui-ext/wgui-ext-patch-encounter-dice/`](../supabase/wgui-ext/wgui-ext-patch-encounter-dice/index.ts) |

Dice tests live in `supabase/wgui-ext/_tests/wgui-ext.test.ts`. Export tests live in `supabase/wgui-export/_tests/wgui-export.test.ts`.

Dispatch, Kong, `VERIFY_JWT=false`, and the `config.toml` `enabled` rule are the same as the combat brief. Do not edit `main/index.ts`, `docker-compose.yml`, or `kong.yml`. Every handler must 401 anonymous callers itself.

Slugs are `^[a-z0-9-]+$`. WGUI’s `RequestTypeSchema` already lists both names.

---

## 1. `wgui-export-character`

Rebuilds the stock character export (JSON v4 and PDF v2) inside the edge runtime. The original export runs in the wanderers-guide **browser** (`frontend` `@export/json/json-v4` and `@export/pdf/pdf-v2`). This function is for callers that cannot run that bundle: WGUI, and API-key clients that already have a character grant.

**Body:** `{ id: number, format: 'json' | 'pdf' }`.

**Auth:** same path as `find-character`.

- JWT: the request client reads `character` under RLS. Missing row → **403** `CHARACTER_FORBIDDEN` (do not distinguish “no such id” from “not yours”).
- 36-character API key: `public_user.api.clients` must contain that key, and the character’s `details.api_clients.client_access` must grant that client. Otherwise **403**. The handler then mints a one-hour user JWT for the character owner and continues as that user. Set `supportsCharacterAPI: true` so the key is scoped to the body `id`.
- Missing or malformed token → **401**.

**Errors:**

| Condition | Status | Code |
| --- | --- | --- |
| `id` is not a finite number | 400 | `INVALID_ID` |
| `format` is not `json` or `pdf` | 400 | `INVALID_FORMAT` |
| Character not visible to the caller | 403 | `CHARACTER_FORBIDDEN` |
| PDF template fetch fails | 503 | `TEMPLATE_UNAVAILABLE` |
| API key has no client grant on that character | 403 | (message: you do not have access to this character) |

**Success is not JSend.** Stock `connect()` always JSON-wraps `{ status, data }`. Export must return the file itself:

- `format: 'json'` → `Content-Type: application/json`, body `{ version: 4, character, content }` from `getJsonV4Content`.
- `format: 'pdf'` → `Content-Type: application/pdf`, raw PDF bytes from `pdfV2`.

Failures stay JSON (`{ status: 'fail', data: { message, code } }`). Use a connect wrapper that passes a `Response` through (`supabase/wgui-export/_wgui-export/connect-raw.ts`). Do not put that wrapper in `_shared/`.

**Content package.** The browser export reads a content store. The isolate has no IndexedDB. Before compile, service-visible reads (the caller’s client) load ancestries, backgrounds, classes, ability blocks, items, languages, spells, traits, creatures, archetypes, versatile heritages, class archetypes, and content sources for `character.content_sources.enabled` plus common-core source id **3**. Cache that package in memory by sorted source-id key. Inject it with `setExportContentPackage` so the bundled store stubs (`getCachedContent`, `fetchContentById`, …) return those rows.

**Bundle.** `scripts/bundle-wgui-export.mjs` esbuilds wanderers-guide `frontend` into `wgui-export-character/compile.bundle.js`. It does not modify the wanderers-guide checkout. Set `WG_DIR` if that repo is not a sibling of WGUI. PDF compile fetches `https://wanderersguide.app/files/character-sheet-v2.pdf` once and caches the bytes. Run compiles one at a time (`compileQueue`); the export modules keep process-global content state.

**Files to add:**

```text
supabase/functions/
  _wgui-export/connect-raw.ts                  # new; raw Response connect, not _shared/
  wgui-export-character/index.ts               # new
  wgui-export-character/compile.bundle.js      # generated; ship the bundle
  _tests/wgui-export.test.ts                   # new
```

`config.toml`: `[functions.wgui-export-character]` with `verify_jwt = false` and an explicit `enabled` boolean. Do not set `enabled = false`.

**Tests (minimum):**

- Missing `format` → **400**.
- API key with no character grant → **403**.
- Owner JWT + `format: 'json'` → 200 and a v4 object (`version`, `character`, `content`).
- Owner JWT + someone else’s id → **403**.

---

## 2. `wgui-ext-patch-encounter-dice`

Campaign members write **only** `encounter.meta_data.dice_roll_state` and `dice_roll_log`. Roster, initiative, creatures, and every other meta key stay off this path. Stock `create-encounter` remains GM-only.

**Body:**

```json
{
  "campaign_id": 1,
  "encounter_id": 2,
  "dice_roll_state": {},
  "dice_roll_log": []
}
```

`campaign_id` and `encounter_id` are required. At least one of `dice_roll_state` or `dice_roll_log` must be present (key present, including `null` / `[]`). Never resolve the campaign from the encounter row.

**Errors:**

| Condition | Status | Code |
| --- | --- | --- |
| Missing `campaign_id` | 400 | `CAMPAIGN_ID_REQUIRED` |
| Missing `encounter_id` | 400 | `ENCOUNTER_ID_REQUIRED` |
| Neither dice field sent | 400 | `DICE_PATCH_REQUIRED` |
| Not a campaign member, or encounter not in that campaign, or player’s PC is not on the fight | 403 | `ENCOUNTER_FORBIDDEN` or `CAMPAIGN_FORBIDDEN` |

Unknown encounter and “not on this fight” use the same 403 so the endpoint cannot probe ids.

**Authorization** (reuse `_wgui-ext/shared.ts` from the combat brief; do not copy a second helper tree):

1. `authorizeCampaign(campaign_id)` — GM if `campaign.user_id === caller`, else a player who owns a character with that `campaign_id`.
2. Admin-read the encounter by id. Reject unless `encounter.campaign_id` matches the body.
3. GM: any encounter in the campaign. Player: only if `encounterIncludesCharacter` (a `CHARACTER` combatant whose `character` or `data.id` is one of the caller’s character ids).

**Write.** Copy `meta_data`, replace only the dice keys that were sent, `update` by encounter id with the service client. Return `{ status: 'success', data: { dice_roll_state, dice_roll_log } }`. Do not return the rest of the encounter.

**GM vs player merge:**

- **GM** replaces `dice_roll_state` and/or `dice_roll_log` with the incoming value (`null` state becomes `{}`; a non-array log becomes `[]`).
- **Player state** (`mergePlayerDiceRollState`): may set `title`, `dc`, `stat`, and `results`. May set `results_audience` only to `'public'`. `side` and any other existing keys stay as the GM left them. A non-object incoming state is ignored.
- **Player log** (`mergePlayerDiceRollLog`): may add, edit, or omit rows whose `initiated_by_user_id` is the caller. Rows the caller did not start (including untagged GM/legacy rows) are kept even if the incoming array drops them. New rows that are not tagged with the caller are dropped. Edited rows keep the caller’s user id.

**Files to add** (on top of the four combat functions and `_wgui-ext/shared.ts`):

```text
supabase/functions/
  wgui-ext-patch-encounter-dice/index.ts       # new
```

Extend `supabase/functions/_tests/wgui-ext.test.ts` rather than starting a second dice file. `config.toml`: `[functions.wgui-ext-patch-encounter-dice]` with `verify_jwt = false` and explicit `enabled`.

**Tests (minimum):**

- Player on the fight can change title, DC, and stat; `side` stays.
- Player can append a log row tagged with their user id.
- Player sending `dice_roll_log: []` removes only their rows; a GM row remains.
- Campaign member whose PC is not on the fight → **403**.
- Anonymous POST → **401**.

---

## After you ship

Recreate the `functions` container so the edge runtime picks up the new directories. `npm run release:check` should list both slugs. Cloud `release:verify` fails until they are deployed.

WGUI calls `wgui-ext-patch-encounter-dice` from the Phase 1 dice tray (about a 4s poll otherwise). Export is invoked as `wgui-export-character` with `id` and `format`. Names must stay as written or WGUI needs a coordinated rename.
