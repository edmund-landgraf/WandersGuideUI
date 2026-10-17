# Do not hide new combatants behind the dice-tab filter

Incident: 2026-10-17. Introduced in `6e48f55` (2026-10-11). The creature-book half of that commit was reverted in `7f935b8`; the tab default was not.

## What went wrong

`defaultEncounterTab` opened the dice tab whenever the roster had no enemy (`!ally`). An empty encounter has no enemies, so it opened on dice.

The dice grid is filtered by side, and the side defaults to **Allies**. Its empty copy was "No matching combatants for this filter." **Add creature** still inserts an enemy. The row was saved, then excluded by the Allies filter, so the table stayed empty. Adding a party member only showed up if Allies or Both was selected, and an empty encounter never left that tab.

## Rules for this screen

- An empty encounter opens on the **combat** list, which is not side-filtered.
- Adding a creature, hazard, or party member switches to the **combat** list so the new row is visible.
- Party members (`type === 'CHARACTER'`) count as allies in the dice filter even when the stored `ally` flag is missing.
- The dice empty state must say the roster is empty, or that the side filter excluded everyone. Do not use one sentence for both.
- Do not default the dice side to a filter that hides the combatant you just added.
