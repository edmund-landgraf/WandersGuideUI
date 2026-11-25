import assert from "node:assert/strict";
import { test } from "node:test";
import { isEncounterStrike } from "../src/encounter-actions.js";

test("only basic Strikes are weapon attacks, not special actions mentioning Strike", () => {
  assert.equal(isEncounterStrike({ name: "Jaws", type: "action", actions: "ONE-ACTION", description: "**Melee** jaws +10; **Damage** 1d4+3 piercing" }), true);
  assert.equal(isEncounterStrike({ name: "Tail", type: "action", source: "Weapon" }), true);
  assert.equal(isEncounterStrike({ name: "Cloak in Embers", type: "action", actions: "REACTION", description: "Trigger: A creature hits with a Strike." }), false);
  assert.equal(isEncounterStrike({ name: "Scattering Magma", type: "action", actions: "ONE-ACTION", description: "Make a Strike, then move." }), false);
  assert.equal(isEncounterStrike({ name: "Bramble Jump", type: "action", actions: "THREE-ACTIONS", description: "Melee Strike +8; Damage 1d6" }), false);
});
