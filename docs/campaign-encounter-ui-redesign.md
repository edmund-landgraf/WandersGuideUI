# Campaign and Encounter UI Replacement

## Purpose

Replace the current campaign and encounter interface with a parallel Tailwind CSS and shadcn/ui frontend while preserving the existing backend calls wherever they are safe and adequate.

The replacement uses one campaign and encounter workspace for both GMs and players. Layout, navigation, grid columns, and detail structure remain identical; role and combatant ownership control which data is returned and which actions are enabled.

- A GM sees every campaign participant and encounter and may edit any PC or creature in that campaign.
- A player sees only encounters containing one of their joined characters and may edit only characters they own. Other combatants remain read-only, and unrevealed details are redacted by the backend.

The existing character builder and full PC character sheet remain authoritative. This project may link to them, but does not replace or change their persistence and rest behavior.

## Product Constraints

- Free accounts may own one campaign and six characters.
- Joining campaigns does not consume an owned-campaign slot and is unlimited.
- A character joins a campaign through the existing join-key flow in the character builder.
- The GM owns the campaign and its encounters.
- AMBA remains the source for adding creatures and custom creatures. The replacement UI does not need Add Creature or Add Custom.
- The replacement UI does need Add PC, using characters already joined to the campaign.
- A player edits only their own PC state.
- A GM can see and edit every campaign participant and encounter combatant. Existing character RLS permits a campaign owner to update characters joined to that campaign; UI commands must still enforce intended field boundaries.
- Players cannot edit enemies.
- Phase 0 remains read-only and runs beside the old UI on port 5194.

The backend currently enforces a one-campaign slot cap in `create-campaign`. The API authentication documentation still says free users receive zero campaign/encounter creates, so that documentation is stale and must be corrected before release.

## Current System Findings

### Reusable behavior

The following existing calls and data flows should remain in use:

- `find-campaign({ user_id })` for campaigns owned by the GM.
- `find-campaign({ id })` for a known campaign. Non-owners do not receive the join key.
- `find-campaign({ join_key })` in the existing character-builder join flow. This also creates the short-lived membership grant needed to attach the character.
- `reset-campaign-key` for GM-only key rotation.
- `find-character({ campaign_id })` for campaign participants.
- `find-character({ id })` and existing `/sheet/:characterId` URLs for PC sheets.
- `find-encounter` for GM-owned encounter reads.
- `create-encounter` for GM-owned encounter creation and full updates during the early migration stages.
- Existing creature/content reads and the current calculation engine for creature statistics, skills, inventory, abilities, and spells.
- The existing initiative skill-option calculation. It already defaults empty initiative entries to Perception and offers Perception plus available skills.

### Current data model

An encounter stores its combatants as one JSON object:

```text
encounter
  id
  user_id                 GM/owner
  campaign_id
  combatants.list[]
    _id                   encounter-instance identity
    type                  CREATURE or CHARACTER
    ally
    initiative?
    creature?             embedded creature instance
    character?            character id
    data?                 optional embedded entity data
  meta_data
```

The combatant `_id`, rather than the creature content id, must remain the identity for encounter state. Two copies of the same creature require independent HP, conditions, initiative, reveal state, and spell resources.

### Current authorization limitation

Encounter row-level security currently permits only the encounter owner to select or modify an encounter. That is correct for the current GM-only interface, but it means a player cannot safely read a GM-owned encounter through the existing generic `find-encounter` path.

Returning the full encounter row to a player would also expose hidden enemies and unrevealed creature details. Player encounter access therefore needs a membership-aware, redacted read path. This is a required backend addition, not a frontend-only change.

The current `create-encounter` call replaces broad encounter state. It should not become a player write endpoint: a player could otherwise alter enemies or another PC, and two clients could overwrite each other's changes.

## Information Architecture and URLs

Use canonical, directly addressable routes:

```text
/campaigns/:campaignId
/campaigns/:campaignId/encounters/:encounterId
```

`/encounters/:encounterId` may be retained as a redirect or alias, but the nested route is preferred because campaign role, participant data, notes, and navigation are always required.

The campaign page is the collection view. The encounter route is the actual play surface and must work after refresh, in a copied link, and in a second browser window. Encounter selection must no longer exist only as transient state embedded inside the campaign screen.

### Shared campaign page

- Campaign name, description, image, and join-key controls.
- Joined-player roster populated from `find-character({ campaign_id })`.
- Encounter list with links to canonical encounter routes.
- Add PC workflow for assigning a joined character to an encounter.
- No Add Creature or Add Custom controls.
- Campaign notes remain editable at campaign level.

### Player data and permissions

- Joined campaign summary.
- The player's joined characters for that campaign.
- Only encounters whose combatant list contains one of those character ids.
- The same controls occupy the same locations, but GM-only commands are disabled or hidden according to authorization. Players cannot mutate enemies or other players' PCs.
- Future stub: support more than one player-owned character in the same campaign. Authorization and filtering must use a set of character ids, not a single current-character field.

## Encounter Workspace

Use a resizable master/detail layout.

### Left/master pane

- Campaign and encounter navigation.
- Joined players available to add to the encounter.
- The encounter combatant grid.
- GM encounter tools: initiative, group checks, and encounter settings.

The grid initially preserves the current columns and ordering exactly:

1. Initiative, including the current up/down numeric control when editing is enabled.
2. Combatant.
3. Defenses.
4. Current/max HP.
5. Actions.

The pane must have a practical minimum width and horizontal overflow as a fallback. Resizing the right pane must not clip core columns. Persist the pane width per browser.

### Right/detail pane

Selecting a creature loads a persistent tabbed detail area instead of the current one-panel-at-a-time drawer. Reuse the existing seven content panels and calculation logic:

1. Health, Conditions, Saves
2. Abilities
3. Skills
4. Inventory
5. Spells
6. Notes
7. Details

Add an eighth Encounter Note tab only when a campaign note matches the encounter as described below.

The pane should preserve the selected combatant and active tab while the user adjusts initiative, HP, or pane width. A detachable/floating creature window can be considered later, but the split pane is the primary implementation because it works predictably across desktop sizes.

### PC click behavior

Resolved: selecting a PC, NPC, or creature loads the same read-only detail tabs in the right pane. A clearly visible external-link icon in a PC header opens `http://localhost:5193/sheet/:characterId` in a new window for the authoritative full character sheet.

The inspector respects the existing access boundary: GMs receive full joined-PC data, players receive their own full PC data, and other party members expose combat-facing summaries without private notes, inventory, spells, or build data.

No Phase 0 or encounter implementation may change PC rest, spell, or global character-sheet behavior.

## Joining and Adding PCs

The existing join sequence remains authoritative:

1. The GM creates the campaign and shares its join key.
2. In the existing character builder, a player enters the key.
3. `find-campaign({ join_key })` validates the key and creates the membership grant.
4. The existing character update sets `character.campaign_id`.
5. The character appears in the GM's campaign roster through `find-character({ campaign_id })`.
6. The GM adds that character to one or more encounters.
7. The player's campaign UI lists each encounter containing that character.

Adding a PC must be idempotent by character id. The UI should prevent accidental duplicate assignment but permit a deliberate future design for multiple distinct characters owned by the same user.

Dragging a roster PC into the combatant grid is a convenience over the same Add PC command. It must also have a keyboard-accessible Add action and a mobile menu alternative.

## Initiative

Retain the current initiative workflow and improve its presentation:

- Show one selector per combatant.
- For a combatant without initiative, default the selector to Perception.
- Offer Perception and all calculated skills available to that combatant.
- Skip means roll `d20 + the normal initiative modifier`, including any individual initiative modifiers, without an added skill selection.
- Display the selected source and modifier before confirmation.
- Roll independently for every included combatant.
- Preserve manual initiative editing with the existing numeric stepper.

Before implementation, confirm these rule details:

- Whether Skip is truly a separate base initiative modifier or is equivalent to Perception in the underlying rules engine.
- Whether Roll Initiative replaces existing values or rolls only empty values by default.
- How ties are ordered and whether the GM may reorder tied combatants.
- Whether hidden enemies' initiative results are visible to players.
- Whether initiative rolls and manual changes are retained in encounter history.

## GM Group Rolls

Add a dedicated encounter tool for checks affecting many combatants, such as a rock slide.

The GM selects:

- Roll type: saving throw, Perception, skill, flat check, attack/DC comparison, or custom modifier.
- Specific defense or skill, such as Reflex or Athletics.
- DC/target value.
- Included combatants, defaulting to all current PCs and creatures.
- Public or GM-only result visibility.
- Optional label and note, such as `Rock slide`.

The result table displays one row per combatant:

```text
Marion       12 on die + 9 Reflex = 21       Success
Lookout       4 on die + 10 Reflex = 14      Failure
```

Show the natural die, every applied modifier, total, DC, and outcome. Use green/red as supporting status colors, not the sole indicator. Include explicit Success/Failure text and support PF2e degrees of success: critical success, success, failure, and critical failure, including natural 20/1 degree adjustments.

Decide before implementation whether rolls are server-authoritative. The recommended design is a narrow server endpoint that validates the encounter role, calculates each modifier from authoritative state, produces the rolls, and appends an immutable result record. Client-only random rolls are simpler but make multi-user synchronization and audit history unreliable.

## Reveal and Recall Knowledge

Reveal state belongs to the encounter combatant instance, not the reusable creature definition.

For the first implementation, add a boolean `revealed` value to each creature combatant. The GM can right-click or open the row menu and choose Reveal details or Hide details.

- GM: always receives and can inspect full creature details.
- Player, hidden creature: receives only the minimum token/grid information needed by the encounter. Clicking it shows no detail content.
- Player, revealed creature: receives the allowed detail tabs.

Enforcement must occur in the backend response. Hiding tabs in React while sending full creature JSON to the browser is not secure.

Leave a schema migration path from `revealed: boolean` to a visibility enum such as `hidden`, `identified`, and `revealed`, because Recall Knowledge commonly reveals information in degrees rather than all at once.

## Creature Spells and Resources

Reuse the current spell calculation and display code, but store expenditure on the encounter creature instance.

Required casting models:

- Prepared/memorized: casting expends that prepared entry and disables its Cast action.
- Spontaneous/rank pool: show remaining slots beside each rank; any spell of that rank consumes one slot; disable eligible Cast actions at zero.
- Innate: track uses per spell or per innate grouping as defined by the imported creature.
- Focus: track focus points separately.
- Cantrips and at-will spells: do not consume slots.

Do not reuse a catalog creature's mutable resource object across duplicate combatants. Each encounter instance needs independent resources.

The reset rule for creatures must be explicit. PC resources remain global and reset only through the existing PC sheet Rest action. For monsters, define whether resources reset on encounter reset, a GM Rest action, or never automatically.

## Campaign Notes on Encounters

Campaign notes remain stored at campaign level.

Initial matching rule:

- Normalize surrounding whitespace.
- Compare titles case-insensitively.
- If exactly one campaign note title matches the encounter title, show it in an Encounter Note tab.
- If more than one note matches, show an ambiguity state rather than choosing silently.
- Respect the existing note sharing flag for players. GMs can see the campaign's full note according to existing permissions; players receive only shared note content.

Title matching is intentionally a compatibility bridge. It breaks when an encounter is renamed and cannot distinguish duplicate titles. Add a future `encounter_id` link on note pages and prefer it whenever present.

## Authorization Matrix

| Capability | GM | Player owning PC | Other campaign player |
| --- | --- | --- | --- |
| View campaign summary | Yes | Yes | Yes |
| View/reveal join key | Yes | No | No |
| View all joined PCs | Yes | Yes, with combat-facing data; private sheet fields remain restricted | Yes, with combat-facing data |
| View encounter | Yes | Only when own PC is included | Only when own PC is included |
| Add/remove PC from encounter | Yes | No | No |
| View hidden creature details | Yes | No | No |
| Reveal/hide creature | Yes | No | No |
| Edit creature encounter state | Yes | No | No |
| Edit own PC | Yes | Yes | No |
| Edit another PC | Yes, when that PC is joined to the GM's campaign | No | No |
| Roll initiative/group checks | Yes | No initially | No initially |

GM and player screens use the same components. Authorization is evaluated per command: campaign ownership permits GM edits across encounter combatants and joined PCs; character ownership permits player edits only to their own PC. Prefer narrow commands and audit history over broad client-submitted row replacement.

## Required Backend Additions

Keep existing calls where possible, but add narrow commands rather than exposing broad row writes.

### 1. Membership-aware encounter read

Extend `find-encounter` or add a dedicated read function that:

- Confirms the caller owns the campaign, or owns a character included in the encounter.
- Returns all matching encounters for a GM.
- Returns only encounters containing one of the player's campaign characters.
- Redacts hidden creature fields and unshared notes for players before serialization.
- Omits the campaign join key for non-owners.

This endpoint is necessary for the player encounter tab.

### 2. Encounter command endpoint

Add operation-based writes such as:

- Add/remove encounter character.
- Set initiative.
- Set HP/temp HP/conditions for an authorized entity.
- Reveal/hide creature details.
- Spend/reset a creature spell resource.
- Roll initiative.
- Run a group check.

Each command validates campaign role and target ownership. Include an encounter revision number or equivalent optimistic-concurrency check so one browser cannot silently overwrite another browser's changes.

The full-row `create-encounter` update can remain for GM-only compatibility and AMBA workflows, but it should not be the long-term collaborative write path.

### 3. Change propagation

Choose Supabase Realtime or a short polling/refetch strategy so GM and player views converge after:

- A character joins/leaves the campaign.
- A GM adds/removes a PC from an encounter.
- Initiative, HP, condition, reveal, or spell state changes.
- A group roll completes.

Realtime is preferred for active encounter state. Every event should include encounter id, revision, command type, actor id, and timestamp.

## State Ownership and Reset Boundaries

The redesign must explicitly separate:

- Global PC state: authoritative on the character row and existing sheet; persists across encounters; reset only by the existing Rest behavior.
- Encounter PC state: initiative and encounter-specific presentation state. Avoid duplicating global HP/spell values unless the current system already treats them as encounter snapshots.
- Encounter creature state: HP, temp HP, conditions, initiative, reveal state, and spell expenditure stored per combatant instance.
- Catalog creature data: immutable source definition imported by AMBA/content tools.

Define what happens when AMBA re-imports a creature used by a live encounter. Recommended behavior: preserve mutable encounter state and update only immutable/source fields after an explicit GM refresh.

## Implementation Phases

### Phase 0: read-only parity

- Parallel frontend on port 5194.
- Tailwind CSS and shadcn/ui foundation.
- Read-only campaign list, roster, encounter list, grid, PC links, creature details, and resizable master/detail layout.
- No mutations.

### Phase 1: canonical routes and secure read model

- Introduce canonical campaign and encounter URLs.
- Add role resolution and membership-aware/redacted encounter reads.
- Implement GM and player campaign shells.
- Add loading, empty, access-denied, stale-session, and retry states.
- Add note-title matching with sharing enforcement.

### Phase 2: encounter composition and reveal

- Add PC from the joined roster through button/menu and drag-and-drop.
- Remove PC from an encounter.
- Add per-combatant reveal state and GM row menu.
- Add live/refetched change propagation.
- Keep Add Creature and Add Custom absent.

### Phase 3: encounter tracking

- Preserve the current grid columns.
- Enable initiative steppers and HP/condition controls according to role.
- Implement initiative skill selection and rolls.
- Add optimistic concurrency, command history, and undo for reversible GM actions.

### Phase 4: seven-tab details and creature spells

- Port the existing seven creature panels into the persistent right pane.
- Use the shared seven-tab read-only inspector for PCs, NPCs, and creatures; retain an explicit external-sheet action for PCs.
- Implement creature spell expenditure for prepared, spontaneous, innate, focus, and at-will models.
- Define and implement creature reset behavior.

### Phase 5: GM group rolls

- Add check builder, target selection, server-authoritative independent rolls, degrees of success, result visibility, and history.
- Test mixed PC/creature groups and hidden creatures.

### Later: PC sheet redesign

Plan but do not implement in this project phase:

- Increase usable scale and information density without shrinking controls.
- Promote Spells from the overflow menu to a primary tab.
- Preserve existing Cast and Rest semantics.
- Keep PC spell/resource changes global to the campaign character.
- Reuse the same seven-panel information architecture where practical.

## Missing Decisions and Risks

The original request also needs decisions in these areas:

1. Resolved: PC row selection opens the shared read-only detail pane; a separate external-link action opens the authoritative PC sheet.
2. Player roster privacy: whether players can see every joined character or only characters sharing an encounter.
3. GM character editing: which global PC fields a GM may change, whether player consent is required, and how changes are audited.
4. Encounter lifecycle: draft, active, paused, completed, archived, and reset behavior.
5. Multiple active encounters: whether one PC may be active in several and how conflicting HP/spell state is handled.
6. Initiative semantics: Skip modifier, reroll scope, ties, hidden results, and history.
7. Group-check semantics: PF2e degrees, secret checks, natural 20/1, custom modifiers, visibility, rerolls, and undo.
8. Reveal granularity: all-or-nothing now versus Recall Knowledge tiers later.
9. Conditions and death: which encounter changes write back to global PC state.
10. Creature reset: when HP, conditions, and spell resources reset.
11. Notes: duplicate titles, encounter renames, player sharing, and eventual explicit note-to-encounter links.
12. AMBA reconciliation: stable creature identity and preserving live encounter state after re-import.
13. Collaboration: stale writes, reconnects, multiple GM windows, conflict feedback, and an audit trail.
14. Accessibility: keyboard alternatives for drag-and-drop and context menus, status text in addition to color, focus management, and responsive grid behavior.
15. Destructive actions: confirmations and undo for removing combatants, resetting encounters, hiding details, and overwriting initiative.

## Test Strategy

Run old UI on 5193 and replacement UI on 5194 against the same local backend.

Test by role and operation, not only by screen:

- GM parity: campaign, roster, encounters, row order, initiative, HP, creature calculations, and notes match the old UI.
- Player filtering: a player sees only encounters containing one of their character ids.
- Redaction: hidden creature data is absent from player network responses, not merely hidden visually.
- Join propagation: joining through the unchanged builder makes the PC available to the GM without a manual database change.
- Assignment propagation: adding the PC makes the encounter appear in the player's UI.
- Authorization: players cannot mutate enemies, other PCs, reveal state, or encounter membership.
- Duplicate creatures: each copy tracks independent HP, initiative, conditions, reveal, and spell resources.
- Concurrent clients: GM and player views converge without full-row data loss.
- Existing sheet link: the PC detail header opens the 5193 sheet URL separately and does not change its Rest/Cast semantics.
- Resizing and responsive behavior: core grid columns remain usable at desktop and supported mobile widths.
- Cross-UI comparison: while an operation remains supported by both UIs, execute it in one and verify the same resulting state in the other.

## Definition of Done

The replacement is ready to supersede the old campaign/encounter UI when:

- Every supported route is directly addressable and reload-safe.
- GM and player role tests pass, including server-side redaction.
- Encounter writes are command-scoped and concurrency-safe.
- The grid and seven detail tabs provide parity with the current calculations.
- Initiative, creature spell expenditure, reveal controls, and group checks are explainable and auditable.
- The unchanged join-key, character-builder, PC sheet, AMBA, Cast, and Rest workflows continue to work.
- The old and new UIs can run against the same backend during rollout without conflicting state semantics.






