# Cantrip and focus-point cross-check

Checked against the original character sheet (`SpellsPanel`, `SpellListEntrySection`, `getFocusPoints`) and the phase 1 sheet (`phase1-spells.ts`, `phase1-item-spells.ts`). “Original” means the trait check in `isCantrip` (`spell-utils.ts`): a spell is a cantrip only when it has the cantrip trait. Phase 1 also treats rank 0 as a cantrip.

PF2e play: cantrips are at-will and are not counted. A focus spell spends 1 Focus Point unless it is a focus cantrip. The pool is one point per non-cantrip focus spell, maximum 3. A wand is once per day. A staff cantrip costs no charges.

## 1. Focus pool uses the cantrip trait, not the saved rank

**Suggestion.** Count a focus spell toward the pool unless it has the cantrip trait. A cast spends 1 point unless it is a focus cantrip. Keep the cap at 3.

**Original.** The pool counts focus grants whose saved rank is not 0 (`getFocusPoints`). It does not look at the trait. Spending does look at the trait: `castSpell` returns before it changes `focus_point_current` when `isCantrip` is true.

**Phase 1.** `focusSpellCastState` treats rank 0, or a cantrip trait, as at-will. `getFocusPoints` still ignores every rank 0 grant. A focus spell saved at rank 0 neither grows the pool nor spends a point, even with no cantrip trait. A focus cantrip saved at rank 1 or higher is not spent, but it still increases the pool.

**PF2e.** Matches the suggestion. Lay on Hands is a focus cantrip and should not add or spend a point. Healer's Blessing is not a cantrip; saved at rank 0 it currently adds nothing and costs nothing. It should add 1 point, and casting it should spend 1.

**Verdict.** Adopt the suggestion. It matches play. It changes the original rank-0 pool rule on purpose: a rank 0 grant with no cantrip trait starts counting.

## 2. Innate cantrips and a maximum of 0

**Suggestion.** An innate spell is at-will when it has the cantrip trait, or when its maximum casts are 0. Otherwise keep the per-day count. Rank 0 alone does not make it free.

**Original.** The row is not exhausted when `casts_max` is 0 (`InnateSpellsList`). The cantrip trait also forces “not exhausted” in `SpellListEntrySection`, and `castSpell` does not increment `casts_current`.

**Phase 1.** The cantrip trait already skips the counter. A rank 0 innate spell with no trait is still limited by its remaining uses. A non-cantrip with `casts_max` 0 is marked exhausted, because remaining uses are 0. The original leaves that spell available.

**PF2e.** Innate cantrips are at-will. Limited innate spells are tracked. An unlimited innate spell (no daily maximum) is not spent.

**Verdict.** Adopt the suggestion. The trait half already matches. The missing half is `casts_max === 0`: that spell should stay available, as on the original sheet.

## 3. Class cantrip slots stay rank 0

**Suggestion.** Leave prepared and spontaneous rank 0 slots as at-will cantrips. That covers wizard, cleric, druid, witch, magus, sorcerer, bard, oracle, psychic, summoner, and animist.

**Original.** Those classes are not special-cased. Prepared and spontaneous lists come from the casting source. Rank 0 is labeled “Cantrips”. Spending is skipped only when the spell has the cantrip trait, not merely because the slot rank is 0.

**Phase 1.** `buildCastingSourceEntries` marks rank 0 as a cantrip for both prepared and spontaneous sources, and a cast returns without changing slots. Summoner uses the spontaneous path. Animist uses the prepared path, and apparition spells use the focus path in section 1. Neither class has its own branch.

**PF2e.** Rank 0 on a class list is a cantrip slot. Casting it spends nothing.

**Verdict.** Leave this as phase 1 has it. Tests already cover the nine named classes except summoner and animist; those two hit the same functions. No behavior change.

## 4. Wands spend a daily use; staff cantrips cost nothing

**Suggestion.** A wand always spends its once-per-day cast, including when the spell is a cantrip. Overcharge stays. A staff cantrip costs 0 charges.

**Original.** A wand cast spends the daily charge and can overcharge whether or not the spell is a cantrip (`WandSpellsList`). A staff row is exhausted only when `spell.rank > 0` and there are not enough charges. The charge change is the spell rank, so a rank 0 cantrip adds 0 (`StaffSpellsList`).

**Phase 1.** `castAndLog` returns before `castWand` or `castStaff` when `entry.cantrip` is set. A rank 0 wand therefore does not spend its daily use. A staff cantrip also skips the charge update; the rank is 0, so the original would have added 0 anyway. A staff spell with the cantrip trait and a rank above 0 would still cost charges on the original sheet and would cost none here.

**PF2e.** Activating a wand is once per day, then overcharge. A staff cantrip does not spend charges. Ranked staff spells spend charges equal to their rank.

**Verdict.** Adopt the wand half: do not take the cantrip shortcut for wands. Leave staff cantrips free. Only diverge from the original if a staff spell is both a cantrip and rank 1 or higher; those should still spend charges equal to their rank.

## 5. Tests against the original rule

**Suggestion.** One test each for a focus cantrip (no spend, no pool), a rank 0 focus spell with no cantrip trait (pool +1, cast spends 1), an innate cantrip (not counted), an innate spell with maximum 0 (still available), and a cantrip wand (daily charge is spent).

**Original.** `isCantrip` is the trait check those tests should follow. Today’s phase 1 tests in `phase1-spells-witch.test.ts` use rank 0 and never call `isCantrip`.

**Phase 1.** Covered: rank 0 class cantrips for nine casters, and `focusSpellCastState(0)` treated as at-will. Not covered: innate, wand, staff, summoner, animist, and a ranked focus spell saved at rank 0.

**Verdict.** Add the five tests with the behavior in sections 1–4. They should fail on the current focus and wand shortcuts, then pass once those shortcuts are limited to class cantrip slots and the cantrip trait.
