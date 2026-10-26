# Homebrew MCP tools: test plan (`wgui_ext_hb_*`)

Scope: the 30 tools registered by `tactics-mcp/src/homebrew-catalog.ts` and wired into `READ_TOOLS` / `WRITE_TOOLS` in `tactics-mcp/src/server.ts`. Every tool posts the caller's JWT to `/functions/v1/<slug>` via `invokeFunction` (`tactics-mcp/src/character-client.ts`). Handler fields below were read from `D:\repos\wanderers-guide\supabase\functions\<slug>\index.ts`.

Layers:
- **U** = unit test, mocked fetch (`setCharacterFetch`), in-memory MCP client (style of `test/homebrew-tools.test.ts`).
- **L** = local stack (DAEDALUS docker: kong `127.0.0.1:8000`, db `54322`), JWT minted with local `JWT_SECRET` for a local e2e user. Never prod.

## 1. Cross-cutting cases (apply to every tool)
| ID | Case | Layer | Expect |
|---|---|---|---|
| X1 | Tool listed | U | `listTools` contains all 30 names; server total 61 (38 read, 23 write) — `test/scopes.test.ts` |
| X2 | Scope mapping | U | 15 finds/stats → `read`; 13 creates + `create_content_update` + `delete_content` → `write` |
| X3 | Missing scope | U | read-only token calling a write tool → `isError`, text `MCP token missing scope write for <name>.`, **no fetch made** |
| X4 | Write-only token calling a find | U | `missing scope read` |
| X5 | No credentials | U | unset `WG_ACCESS_TOKEN`/`JWT_SECRET` → `AUTH_REQUIRED` from `invokeFunction` |
| X6 | Function error passthrough | U | `{status:"error", message}` or non-2xx → `isError`, `structuredContent.code = "FUNCTION_ERROR"`, message verbatim |
| X7 | `status:"fail"` passthrough | U | e.g. find-creature invalid type → `FUNCTION_ERROR`, `data` preserved |
| X8 | Non-JSON response | U | `INTERNAL_ERROR` "returned non-JSON" |
| X9 | Network throw | U | `INTERNAL_ERROR` |
| X10 | Output shape | U | `content[0].text` = summary line + JSON; `structuredContent.data` = raw rows |
| X11 | URL/slug | U | `wgui_ext_hb_find_spell` → `/functions/v1/find-spell` (hyphens), body exactly the given filters |

## 2. Find tools (read)
Each: happy path (L), each filter alone (U asserts body; L asserts result), unknown filter rejected by `.strict()` schema (U), empty query `{}` allowed (U).

| Tool | Function | Filters (as handler reads) | Specific cases |
|---|---|---|---|
| `wgui_ext_hb_find_content_source` | find-content-source | `id`, `foundry_id`, `group`, `homebrew`, `published` | without `id` and `homebrew` false/absent → only `user_id null` rows; `homebrew:true` → official **plus** homebrew (not homebrew-only — see §8 E1); `id` bypasses the homebrew filter |
| `wgui_ext_hb_find_trait` | find-trait | `id`, `name`, `content_sources` | `id` array returns many |
| `wgui_ext_hb_find_ability_block` | find-ability-block | `id`, `type`, `name`, `content_sources`, `traits` (arrayContains), `prerequisites` (arrayContains) | type `feat` vs `action`; traits subset match |
| `wgui_ext_hb_find_ancestry` | find-ancestry | `id`, `content_sources` | `name` rejected by schema |
| `wgui_ext_hb_find_background` | find-background | `id`, `content_sources` | as above |
| `wgui_ext_hb_find_class` | find-class | `id`, `content_sources` | as above |
| `wgui_ext_hb_find_archetype` | find-archetype | `id`, `content_sources`, `dedication_feat_id` | |
| `wgui_ext_hb_find_versatile_heritage` | find-versatile-heritage | `id`, `content_sources`, `heritage_id` | |
| `wgui_ext_hb_find_class_archetype` | find-class-archetype | `id`, `content_sources`, `class_id` | |
| `wgui_ext_hb_find_item` | find-item | `id`, `name`, `content_sources` | single `id` returns an **object**, not array (§8 E2) |
| `wgui_ext_hb_find_language` | find-language | `id`, `name`, `content_sources` | |
| `wgui_ext_hb_find_creature` | find-creature | `id`, `name`, `content_sources`, `type` | default `creature`; `hazard` returns hazards; any other type rejected by schema enum |
| `wgui_ext_hb_find_spell` | find-spell | `id`, `name`, `content_sources`, `traits` | |
| `wgui_ext_hb_find_content_update` | find-content-update | `id`, `user_id`, `state` (PENDING/APPROVED/REJECTED), `created {from,to}` | date range filter |
| `wgui_ext_hb_get_content_source_stats` | get-content-source-stats | body **exactly** `{content_source_id}` | 0, negative, float, string → schema rejection (no call); valid id → `{source, count}`; unknown id → `source:null` |

Source filter is always `content_sources: number[]`; `content_source_id` must be rejected by the find schemas (U).

## 3. Create tools (write, upsert)
Thirteen: `wgui_ext_hb_create_{content_source,trait,ability_block,ancestry,background,class,archetype,versatile_heritage,class_archetype,item,language,creature,spell}`. Input `{ record: Record<string, unknown> }`, passed through unchanged.

| ID | Case | Layer | Expect |
|---|---|---|---|
| C1 | Insert (`id` absent or `-1`) | U+L | returns new row with positive id, `uuid` set |
| C2 | Update (`id` = existing) | L | same id; changed field persisted; `procedure:update` |
| C3 | Pass-through | U | body deep-equals `record` (meta_data, operations, traits, version) |
| C4 | Duplicate uuid (same name+level+source on insert) | L | function error surfaced verbatim (overwrite path disabled in `_shared/helpers.ts insertData`) |
| C5 | Write to a source the user doesn't own | L | RLS/function error passthrough; nothing written |
| C6 | Forbidden keys (`created_at`, `version`, `updated_at`, `search_tsv`) | L | stripped by insertData, no error |
| C7 | `create_content_source` without Patreon tier 2 | L/U | `User does not have access` returned as-is (`FUNCTION_ERROR`). U: mocked; L: needs a user that fails `checkAccessLevel` (§8 E3) |
| C8 | `create_content_source` drops unknown/non-upserted fields | L | e.g. `group` is not in the upsert list → stored null (§8 E4) |
| C9 | Per-type minimal valid record | L | one insert per type into the test source; read back via matching find |

## 4. `wgui_ext_hb_create_content_update` (proposal)
| ID | Case | Expect |
|---|---|---|
| P1 | Valid `{type, action, data, content_source_id, ref_id?}` | row in `content_update` with `status.state = PENDING`, `user_id` = caller (set by function), `upvotes/downvotes = []` |
| P2 | Content row unchanged | the referenced item/spell is **not** modified; source counters/version unchanged |
| P3 | Schema | `action` ∉ UPDATE/CREATE/DELETE rejected; extra top-level fields rejected; `user_id`/`status` cannot be supplied |
| P4 | Anonymous/deactivated user | `fail` "Account is unavailable" passthrough |
| P5 | Visible via `wgui_ext_hb_find_content_update {state:"PENDING"}` | |
| P6 | Discord side effects | none required locally; tolerate missing webhook |

## 5. `wgui_ext_hb_delete_content`
| ID | Case | Expect |
|---|---|---|
| D1 | Each allowed type: ability-block, content-source, ancestry, trait, class, background, item, spell, creature, language, archetype, versatile-heritage, class-archetype | U: forwarded `{id, type}` unchanged; L: row gone (re-find returns empty) |
| D2 | `character`, `campaign`, `encounter` | `INVALID_TYPE`, **no fetch** |
| D3 | Unknown (`foo`, `ability_block` underscore form) | `INVALID_TYPE`, no fetch |
| D4 | Row not owned by caller | function error passthrough, row intact |
| D5 | Read-only token | missing-scope error, no fetch |

## 6. End-to-end flow (L, one user, one fresh source)
1. `find_content_source {homebrew:true}` → note whether test source exists.
2. `create_content_source` (or reuse) → source id S.
3. `create_trait {record:{name:"Tidebound", content_source_id:S, …}}` → trait T.
4. `create_item` ×2 using T and official traits → I1, I2.
5. `find_item {content_sources:[S]}` → both; `find_item {id:I1}` → one row.
6. `create_item {record:{id:I1, …, price:{gp:700}}}` → update; re-find shows new price, same id/uuid.
7. `create_content_update {type:"item", action:"UPDATE", ref_id:I1, data:{…}, content_source_id:S}` → PENDING; I1 unchanged.
8. `get_content_source_stats {content_source_id:S}` → `{source, count}`.
9. `delete_content {id:I2, type:"item"}` → gone; `delete_content {id:1, type:"character"}` → rejected pre-call.
10. Cleanup: delete I1, T, then source S (`content-source`).

## 7. Initial evidence (2026-10-26, local stack, user `72df8e0b-…` e2e GM)
Driver: `D:\tmp\hb-local\run.mts` (in-memory MCP client → real `createTacticsMcpServer`, scopes read+write, `SUPABASE_URL=http://127.0.0.1:8000`).

| Step | Tool | Result |
|---|---|---|
| 1 | `find_content_source {homebrew:true}` | OK, 104 rows (official + homebrew) |
| 2 | `create_content_source` "MCP Homebrew Test (local)" | OK → **id 906**, `user_id` = test user, `is_published:false` |
| 3 | `find_content_source {homebrew:true}` | OK, 105 rows, 906 present |
| 4 | `find_trait {id:[1504,1527,1542,1576,1475,1569]}` | OK, 6 rows |
| 5 | `find_item {name, content_sources:[906]}` ×2 | OK, 0 rows (no dupes) |
| 6 | `create_item` Stormforge Covenant Blade | OK → **id 23471** |
| 7 | `create_item` Mantle of the Ninefold Tide | OK → **id 23472** |
| 8 | `find_item {id}` ×2 | OK, fields round-tripped (see report) |

## 8. Findings / surprises to cover
- **E1** `homebrew:true` on find-content-source returns official + homebrew, not homebrew-only. Callers must filter on `user_id`.
- **E2** find-item with a scalar `id` returns a single object; with filters, an array. Tests and clients must handle both.
- **E3** Patreon tier-2 denial not reproduced locally: the e2e GM user (no Patreon token) created a source. `checkAccessLevel` presumably grants access by another route (e.g. GM group or role) — the denial case needs a mocked U test plus a local user that is known to fail.
- **E4** create-content-source does not upsert `group`/`meta_data`; sent `group:"homebrew"` stored as null.
- **E5** Description link refs (`link_condition_7` in the mantle) are not validated by create-item; add a lint step if needed.

## 9. Evidence — one entry per category (local stack, 2026-10-26 ~06:47 PDT)

Runner: `D:\tmp\hb-local\run-all.mts` (log `D:\tmp\hb-local\run-all.log`). User: e2e.gm `72df8e0b-…`, source 906. Every entry was created with `wgui_ext_hb_create_*`, then read back by `id` with the matching `find_*` tool. A row passes when the name matches and `content_source_id` = 906.

| Category | id | Name | Links | Result |
|---|---|---|---|---|
| trait | 5241 | Stormforged | — | PASS |
| language | 1176 | Tempestine | — | PASS |
| ability-block (heritage) | 58875 | Stormtouched | traits [5241] | PASS |
| ability-block (feat) | 58876 | Stormwarden Dedication | traits [5241], giveLanguage 1176 | PASS |
| ability-block (action) | 58877 | Call the Covenant | traits [5241, 1432] | PASS |
| ancestry | 580 | Galecaller | giveLanguage 1176, giveTrait 5241; auto trait 5242 | PASS |
| versatile-heritage | 109 | Stormborn | heritage_id 58875; auto trait 5243 | PASS |
| background | 1759 | Lightning-Scarred Acolyte | 2 ops | PASS |
| class | 350 | Tempest Knight | auto trait 5244 | PASS |
| class-archetype | 155 | Thunder Oath Knight | class_id 350 | PASS |
| archetype | 524 | Stormwarden | dedication_feat_id 58876; auto trait 5245 | PASS |
| creature | 12836 | Storm Covenant Sentinel (L4) | trait 5241, language 1176, abilities_added [58877] | PASS |
| spell | 9191 | Covenant Thunderclap (rank 2) | traits [5241, 1576, 1432, 1433] | PASS |
| content update | 1 | UPDATE spell 9191 | PENDING; find_content_update returns it | PARTIAL (see F1) |
| content source stats | 906 | — | `count: 0`; meta_data.counts: item 2, trait 5, language 1, heritage 1, feat 1, action 1, ancestry 1, versatile_heritage 1, background 1, class 1, class_archetype 1, archetype 1, creature 1, spell 1 | PASS |

Findings:
- **F1:** `create-content-update` inserts the row and then POSTs it to the external `content-updates-bot.onrender.com`. This happens even on the local stack. If no Discord `message_id` comes back, the function returns `Failed to insert data` (isError=true) even though the row is committed. That makes it a false failure with an outbound side effect. Tests should stub this call or expect the error locally.
- **F2:** `get-content-source-stats` `count` is the subscriber count (a HEAD count), not the number of content rows. Per-type content counts are in `source.meta_data.counts`.
- **F3:** ancestry, class, archetype and versatile-heritage each auto-create their own trait (5242–5245) when `trait_id` is omitted. These count toward `trait`.
- **F4:** a versatile heritage's `heritage_id` points at an `ability_block` with type `heritage`, not at an ancestry. You have to create a heritage block first.
- **F5:** create handlers for language, ancestry, background, class, archetype, versatile-heritage and class-archetype don't accept `meta_data` (it reads back null). `creature.type` isn't accepted either; it defaults to `creature`.
- **F6:** none of the ability-block creates set `version` (null). The other creates default to "1.0".
