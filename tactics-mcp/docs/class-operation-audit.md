# Class operation audit

Audited October 15, 2026. The reference is the local WGUI operation engine and
the running OG WG Docker stack, not a separate interpretation of class rules.

## Pass 1: source and content

Compared the MCP reader against:

- `src/process/operations/operation-controller.ts`: class features, selected
  abilities, and execution of toggled `meta_data.active_modes`.
- `src/process/operations/operation-runner.ts`: conditional branches, spell grants,
  and nested ability blocks.
- `src/process/operations/operation-utils.ts`: filtered/predefined spell metadata.
- `src/process/content/collect-content.ts`: normal, focus, and innate spell lists.
- OG `supabase/functions/find-ability-block/index.ts` and
  `find-spell/index.ts`: ID-array lookup and content filter contracts. These files
  are in the sibling `wanderers-guide` checkout mounted into the functions container.

Inspected 234 current class-feature definitions across Alchemist 107, Animist 148,
Exemplar 149, and Runesmith 336. Also identified the legacy/playtest class rows;
their distinct rules have not been certified by this audit.

## Pass 2: fixes and regression scenarios

| Class | Confirmed reader gap | Verified behavior |
| --- | --- | --- |
| Animist | Normal apparition grants were discarded; both conditional branches were walked; inactive modes granted vessel spells. | Custodian grants Tangle Vine and Protector Tree at level 1, adds Gentle Breeze at level 3, and grants Garden of Healing only with its primary mode active. Shaman familiar feats respect level gates. |
| Alchemist | Nested granted feats were loaded but excluded from returned abilities. | Quick Alchemy and the chosen Bomber Research Field are returned. Saved formula inventory is preserved. No class spells are invented. |
| Exemplar | Nested actions and selected ikons with no structured action cost were omitted from ability groups. | Shift Immanence, Spark Transcendence, and selected Gleaming Blade descriptions are accessible. Variable action costs remain explicit. |
| Runesmith | Nested Trace/Invoke actions were omitted; null numeric action cost concealed reactions and variable costs. | Selected Atryl, Trace Rune, Invoke Rune, and Shield Block are accessible with their original action-cost strings. |

The reader scans the reachable block graph until its known grants stabilize,
allowing conditions to depend on nested granted feats. It no longer fetches an
ability block for every numeric selection, including unrelated language/spell IDs.
Stale selection paths cannot reactivate a feature above the character's level.

Non-action feat and custom-choice descriptions are exposed in the
`class-abilities` group. Existing `get_abilities` and `list_ability_groups` return
this group without adding a new tool. `actionCost` preserves `REACTION`,
`FREE-ACTION`, and variable action-cost values alongside numeric `actions` where
available.

Predefined spell metadata follows the OG first-option behavior. Filtered picks
use the filter metadata. Focus classification does not depend on words in a title.

## Pass 3: verification

`test/fixtures/class-operation-audit.json` contains public class/content rows read
from the local WG PostgreSQL database, with constructed selections rather than
private character records. `test/class-operations.test.ts` covers the four classes,
unknown conditions, predefined metadata, later-pass dependencies, and stale paths.
The existing Kota SDK tool regression remains in `test/focus-spells.test.ts`.

Run `npm test` and `npm run smoke` in `tactics-mcp`.

The optional local integration test runs with `WGUI_LOCAL_STACK=1`,
`SUPABASE_URL=http://127.0.0.1:8000`, and the stack's existing
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. It constructs encounter and
character inputs, then calls the actual class/ability/spell endpoints. It performs
no character writes. The four-class integration check passed against the running
stack. It is skipped in ordinary test runs.

## Limits and deployment check

This is a bounded reader, not a replacement for the character operation engine.
Resource quantities, dynamic damage, item text injections, complete variable
arithmetic, and every archetype/legacy/playtest combination are not certified.
Alchemist formulas remain inventory data; they are not turned into spells.

Conditions using unavailable variables are skipped and named in
`liveCasting.unresolvedConditions`, rather than granting both branches.
`scanPasses` and `scanStable` report convergence. Deployment is identifiable by
`liveCasting.revision: "class-operation-grants-v3"`.
