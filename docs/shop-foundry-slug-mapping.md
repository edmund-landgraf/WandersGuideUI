# Shop lines should use the wgi_rules Foundry slug

**Status: recommended, not implemented.**

A shop send to Foundry (`amba:wgui-shop:koll`, 2026-11-23) created Vine of Roses and rejected two lines:

- `Plate of Yled (Graveknight Plate)` — slug `plate-of-yled-graveknight-plate` is not in `pf2e.equipment-srd`. The compendium item is `plate-of-yled`.
- `Energized Shield` — slug `energized-shield` is not in the pack. Foundry has `energized-shield-lesser`, `energized-shield-moderate`, `energized-shield-greater`, and `energized-shield-major`.

## What already works

Character import in `foundry-wanderersguide-import` does not connect to Postgres. It loads `data/match-catalog.json`, built by `db/tools/export-match-catalog.mjs` from `wgi_rules`:

- active rows in `compendium_match_aliases`
- active rows in `wg_pf2e_catalog_matches` whose Wanderer's Guide name and Foundry name differ after sluggify
- active rows in `compendium_match_rules`

`pf2e_catalog_entries` holds the Foundry document id, pack, and slug. `wg_keyword_snapshot.wg_id` is the Wanderer's Guide id. `wg_pf2e_catalog_matches` is one row per snapshot entity (`active`, `ambiguous`, or `unresolved`).

That database now lives in three places, with the same row counts after the 2026-11-23 copy from DAEDALUS:

| Host | Database |
|---|---|
| This machine, `my-postgres` | `wgi_rules` |
| `vps-unwh`, `my-postgres` | `wgi_rules` |
| DAEDALUS, `my-postgres` | `wgi_rules` (source of the dump) |

`vps-ahhh` does not have `wgi_rules`. The shop module and the character importer both stay off that host's Postgres.

Copying the database does not change a running import. The module only sees a newly exported `data/match-catalog.json` copied into the module folder. The exporter's default connection (`docker exec -i my-postgres psql -U appuser -d wgi_rules`) is the local database.

## What the shop does instead

`shopStockFoundryManifest` in `src/pages/launcher/shops-export.ts` sets every line's slug with `foundryItemSlug(item.name)` and always sends pack `pf2e.equipment-srd`. Parentheses stay in the slug, so a base-armor note becomes part of the lookup key.

`foundry-pf2-import` `scripts/manifest/importManifest.mjs` calls `lookupPackSlug(pack, slug)` and reports `not in <pack>` when the live compendium index has no such key. It does not read `match-catalog.json`.

## Change the shop manifest

Resolve each stock line by Wanderer's Guide item id before building the manifest:

1. `wg_keyword_snapshot` where `source_table = 'item'` and `wg_id` is the item id.
2. `wg_pf2e_catalog_matches` for that snapshot row.
3. `pf2e_catalog_entries` for pack, `pf2e_slug`, and Foundry document id.

Send that slug and pack. Keep `foundryItemSlug` only when the match is an exact name (Vine of Roses) or when no catalog row exists and the display name already is the compendium name.

Use an `active` match only. Leave `ambiguous` and `unresolved` off the Foundry payload and say so in the shop result, the same way the character importer reports "match catalog not loaded" rather than guessing.

A Wanderer's Guide family name with no grade has no single Foundry row. Energized Shield stays unresolved until the shop line names one grade. The catalog export drops aliases whose slugs are identical, so it will not invent `energized-shield-lesser` from `energized-shield`.

The browser should not open Postgres. Export a shop lookup file from `wgi_rules` (Wanderer's Guide item id, Foundry pack, Foundry slug, status), the same pattern as `match-catalog.json`, and have the shop manifest read that file. Regenerating the character catalog is a separate step and does not fix the shop.

## Leave alone

- Do not point the Foundry module at `vps-unwh` or at local Postgres.
- Do not put `wgi_rules` on `vps-ahhh`.
- Do not change character-import matching. After a rules change, regenerate `data/match-catalog.json` and ship that file.
