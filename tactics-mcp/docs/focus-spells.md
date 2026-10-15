# Reading focus spells

`get_spells` reads the saved spellbook and reconstructs focus grants from the
character's class features and selected feats. It does not run the full character
operation engine or download the spell catalog.

Class operations alone are insufficient. The sheet runs class features separately,
matching `type = class-feature`, the class's `trait_id`, and the character's level.
An automatic feature can have no entry in `operation_data.selections`. Load these
features even when no selection paths refer to them, then follow selected ability
blocks and look up the resulting spell IDs.

For a predefined spell choice, the saved value is an option UUID. Resolve the
option's `operation.data.spellId`. The OG UI's `getSpellPredefinedList` uses the
first option's casting metadata for every option in the list. The reader preserves
that behavior, including when a selected option's nested grant says `NORMAL`.
Filtered spell picks use `optionsFilters.spellData`.

## Kota regression

Verified against the public sheet `/sheet/66`, campaign 31, encounter 150,
combatant `0caaa623-456f-4ddc-af3a-3c1786dd9a99`:

| Source | Spell |
| --- | --- |
| Grave Spells, feature 57685 | Create Thrall (8770), Thrall Charge (8754), Necrotic Bomb (8763) |
| Grim Fascination, feature 57683, selected Spirit option | Life Tap (8765) |
| Widespread Fascination, feat 58014, selected UUID option | Bone Spear (8775) |

The regression fixture preserves these operation shapes and omits personal details.
The test calls the registered MCP `get_spells` tool through the SDK and expects 21
spellbook entries plus five rows with `tradition: "focus"`.

Run `npm test` and `npm run smoke` from `tactics-mcp`.

After deploying this source and restarting `wgui-mcp`, a fresh `get_spells` response
must contain `liveCasting.revision: "class-operation-grants-v3"` and all five IDs in
`liveCasting.focusSpellIds`. A response without that revision comes from older
reader code.

The subsequent [class audit](class-operation-audit.md) covers normal apparition
spells, active modes, conditional grants, and nested non-spell class abilities.
