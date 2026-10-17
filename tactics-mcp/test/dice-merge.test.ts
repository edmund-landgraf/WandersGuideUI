import assert from "node:assert/strict";
import test from "node:test";

import { mergePlayerDiceRollLog, mergePlayerDiceRollState } from "../src/dice-merge.js";

test("a player keeps other people's dice rows and can drop their own", () => {
  const merged = mergePlayerDiceRollLog(
    [
      { id: "gm", title: "GM check" },
      { id: "mine", initiated_by_user_id: "player", title: "old" },
    ],
    [{ id: "fresh", initiated_by_user_id: "player", title: "new" }],
    "player",
  );
  assert.deepEqual(merged.map((row) => row.id), ["gm", "fresh"]);
});

test("a player cannot replace the GM side or challenge on the dice tray", () => {
  const merged = mergePlayerDiceRollState(
    { title: "Fortitude", side: "enemy", challenge: "severe", dc: 15 },
    { title: "Reflex", side: "ally", challenge: "trivial", dc: 18, results: { a: 1 } },
  );
  assert.equal(merged?.title, "Reflex");
  assert.equal(merged?.dc, 18);
  assert.equal(merged?.side, "enemy");
  assert.equal(merged?.challenge, "severe");
});
