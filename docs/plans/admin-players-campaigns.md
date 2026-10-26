# Admin: Players screen (v1) — design plan

Status: design only. Revised 2026-10-26 with Edmund's constraints. Target app: **WanderersGuideUI** (existing admin panel at `/admin` → `src/pages/admin_panel/AdminPage.tsx`, route `src/main.tsx:229`). Backend: **wanderers-guide** (`data\schema.sql`, `supabase\functions`).

## 0. Hard constraints (Edmund, 2026-10-26)
- **Player-facing views are not touched**: no edits or refactors to `src/pages/CharactersPage.tsx`, `src/pages/CampaignsPage.tsx`, sheet/builder pages (`src/pages/phase1/*`, `src/pages/character_sheet/*`, `src/pages/character_builder/*`) or helpers they use. No helper extraction, no readOnly flag added to existing pages.
- Admin Players tab **inherits the player characters view's styling and organization**: it is the player view repeated for every player, one layer up (player row with +/- expanding to that player's PCs, laid out like `CharactersPage`). Achieved by **copying** the look into new admin components (same Mantine components, spacing, colors from `@constants/data` such as `IMPRINT_BG_COLOR`, `IMPRINT_BORDER_COLOR`), not by changing or wrapping player code.
- All new code lives in **new admin files**, plus minimal wiring in `AdminPage.tsx` and `main.tsx`, plus **new admin-only backend functions**.
- **v1 = Players tab only.** Campaigns tab deferred (see §7).

## 1. Verified facts
| Thing | Where |
|---|---|
| Player characters view (style reference only) | `src/pages/CharactersPage.tsx` (`/characters`) |
| Admin panel | `src/pages/admin_panel/AdminPage.tsx`: `<Stack>` of tools; no in-page admin check, only nav link hidden via `user?.is_admin` (`src/nav/Layout.tsx:273,408`) |
| Admin flag | `public_user.is_admin` (schema.sql:646), also `is_mod` |
| Server admin check | `requireWorkUser(client, token, true)` in `supabase/functions/_shared/costly-requests.ts` |
| PC limit | `CHARACTER_SLOT_CAP = 6` (`src/constants/data.ts:32`); applies when `!hasPatreonAccess(user, 2)` (`src/utils/patreon.ts`) |
| Patreon tier | `public_user.patreon` jsonb → `tier` ('LEGEND', 'GAME-MASTER', ...) |
| Login method | `auth.identities.provider` (email/google/discord...), email in `auth.users.email`; service role only |
| Character fields | `character(id, user_id, name, level, campaign_id, details, updated_at)`; class/ancestry at `details.class.name`, `details.class_2.name`, `details.ancestry.name` |
| RLS | admins may SELECT and UPDATE all `character` rows (schema.sql:2346, 2364); `public_user` readable by all |

`hasPatreonAccess` is imported (read-only use, unmodified) or its rule is mirrored server-side; the server computes `is_capped` so the UI needs no player helper.

## 2. Players tab mockup (styled like CharactersPage, one layer up)
```
Admin Panel   [ Tools ] [ Players ]
[Search name / masked email / user id ____]  Tier:[All v]  Login:[All v]      1-50 of 1,284  < >
-----------------------------------------------------------------------------------------------
[-] (avatar) Edmund   ed***@gmail.com (eye)   Google, Email   GAME-MASTER   PCs 9
      +-----------+ +-----------+ +-----------+        <- same card grid/look as /characters
      | Valeros   | | Ezren     | | Unbuilt   |
      | L5 Human  | | L3 Human  | | L1        |
      | Fighter   | | Wizard    | |           |
      +-----------+ +-----------+ +-----------+        each card -> /admin/view/:characterId
[+] (avatar) Kyra     k***@proton.me (eye)    Discord         —             PCs 3/6
[-] (avatar) Merisiel m***@yahoo.com (eye)    Email           —             PCs 0/6
      (no PCs)
-----------------------------------------------------------------------------------------------
```
- Non-patrons show `n/6` (red if over cap); patrons show `n`.
- Expanded content is indented under the player row; 0 PCs → single `(no PCs)` row.
- Only PCs the player owns (`character.user_id`).

## 3. Files (v1)
**Create (frontend, WanderersGuideUI):**
- `src/pages/admin_panel/players/AdminPlayersTab.tsx` — search, filters, pagination, list of player rows.
- `src/pages/admin_panel/players/AdminPlayerRow.tsx` — +/- header row (name, masked email + reveal, providers, tier, PC count) and indented expansion.
- `src/pages/admin_panel/players/AdminCharacterCard.tsx` — card copying CharactersPage card styling; links to `/admin/view/:id`.
- `src/pages/admin_panel/players/AdminCharacterViewPage.tsx` — new **read-only** PC view (route `/admin/view/:characterId`).
- `src/pages/admin_panel/players/admin-api.ts` — react-query hooks calling the new functions.
- `src/pages/admin_panel/players/admin-config.ts` — `ADMIN_SCREENS_ALLOW_MODS = false` (UI visibility mirror).

**Modify (minimal wiring):**
- `src/pages/admin_panel/AdminPage.tsx` — wrap existing tools in `Tabs` (`Tools` | `Players`); admin/mod guard for the Players tab.
- `src/main.tsx` — add one child route `admin/view/:characterId` under `AuthRouteWrapper` next to `admin`.

**Create (backend, wanderers-guide):**
- `supabase/functions/admin-list-players/index.ts`
- `supabase/functions/admin-get-player-characters/index.ts`
- `supabase/functions/admin-get-character/index.ts`
- `supabase/functions/admin-reveal-email/index.ts`
- `supabase/functions/_shared/admin-access.ts` — `requireAdminScreenUser()` (wraps `requireWorkUser`; `is_admin || (ADMIN_SCREENS_ALLOW_MODS && is_mod)`; `ADMIN_SCREENS_ALLOW_MODS = false`).
- `supabase/migrations/<timestamp>_admin_players.sql` — `admin_player_overview(...)` SECURITY DEFINER function and `admin_audit_log` table. (Migration folder/naming **to verify** in wanderers-guide.)

No player-facing files are modified.

## 4. Backend / data
- `admin-list-players { page, page_size<=100, query?, tier?, provider? }` → rows: `user_id, display_name, image_url, masked_email, providers[], patreon_tier, is_capped, pc_count, last_sign_in_at`. Backed by `admin_player_overview` joining `public_user`, `auth.users`, `auth.identities`, count of `character`. Email masked in SQL; full email never returned here.
- `admin-get-player-characters { user_id }` → `id, name, level, ancestry, class, class_2, image_url, updated_at` for `character.user_id = user_id` (lazy on expand).
- `admin-get-character { character_id }` → read-only snapshot for the view page (name, level, ancestry/class, attributes/HP/inventory/spells fields as stored; exact projection decided at build time).
- `admin-reveal-email { user_id }` → full email, admin-only (not mods), inserts `admin_audit_log(actor_user_id, action='reveal_email', target_user_id, created_at)`.
- Security: every function checks access first (403); service-role key server-side only; SQL function `REVOKE ALL FROM anon, authenticated`, `GRANT EXECUTE TO service_role`; `admin_audit_log` RLS enabled with no policies. Never return `public_user.api`, raw `patreon`, `campaign.join_key`, or `auth.identities.identity_data`.
- Pagination: server-side limit/offset ordered by `created_at desc, user_id`; `ILIKE` on display_name/email, exact match on uuid. Indexes on `character(user_id)` **to verify**.

## 5. Read-only PC view (new, admin-only)
- Route `/admin/view/:characterId` → `AdminCharacterViewPage.tsx`. Does **not** reuse or modify `Phase1SheetPage` or the builder.
- Data only from `admin-get-character` (GET-style read). The component contains **no mutation code, no inputs, no save calls**; it imports nothing from sheet/builder modules that writes. Displays header ("Admin view · Read only"), owner, level/ancestry/class, and static sections of stored data.
- Accidental writes are structurally impossible from this page. RLS still allows admin UPDATE on `character` (schema.sql:2364); unchanged in v1 (see §7).

## 6. Decisions (2026-10-26)
- **D1** Players tab lists only PCs the player owns.
- **D2** Emails masked server-side by default; click-to-reveal via `admin-reveal-email`, audited in `admin_audit_log`; revealed value kept in component state only.
- **D3** PC links open the new admin-only read-only view `/admin/view/:characterId`.
- **D4** Moderators: single flag `ADMIN_SCREENS_ALLOW_MODS`, default `false` (admin-only); server copy authoritative, frontend copy only hides UI. Email reveal admin-only regardless.
- **D5** Player-facing views untouched; admin copies their styling/organization in new files.
- **D6** v1 scope = Players tab only.

## 7. Deferred / open
- **Deferred:** Campaigns tab (campaign → GM → players → PCs, flipped), same style approach, new files only.
- Open: remove admin UPDATE from `character` RLS?
- Open: is the 6-PC cap enforced server-side in `create-character`?
- Open: audit-log retention; also log admin character views?
- Open: should `/admin` get a route-level guard for all tools?

## 8. Testing (local stack: functions 127.0.0.1:8000, DB port 54322 unchanged)
- Seed users with 0, 3, 7 PCs; Google, Discord, email identities; one patron.
- Non-admin → 403 from all functions and no Players tab; mod with flag false → 403.
- Expand/collapse, `(no PCs)` row, `n/6` display, reveal writes one audit row, `/admin/view/:id` makes zero write requests (assert in Playwright network log).