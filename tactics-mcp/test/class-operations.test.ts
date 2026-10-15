import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createSupabaseReader } from "../src/supabase-reader.js";

type Json = Record<string, any>;
const fixture = JSON.parse(await readFile(new URL("./fixtures/class-operation-audit.json", import.meta.url), "utf8")) as {
  classes: Json[]; features: Json[]; blocks: Json[]; spells: Json[];
};

async function readClass(classId: number, options: { level?: number; active?: boolean; shaman?: boolean; operations?: Json[]; selections?: Record<string, string>; live?: boolean } = {}) {
  const baseClass = fixture.classes.find((row) => row.id === classId)!;
  const classRow: Json = { ...baseClass, operations: [...baseClass.operations, ...(options.operations ?? [])] };
  const level = options.level ?? 1;
  const selections: Record<string, string> = {};
  const select = (featureId: number, option: number) => {
    const feature = fixture.features.find((row) => row.id === featureId)!;
    selections[`class-feature-${featureId}_${feature.operations.find((op: Json) => op.type === "select").id}`] = String(option);
  };
  if (classId === 107) select(31299, 32985);
  if (classId === 148) {
    select(38684, 38708);
    if (options.shaman) selections["class-feature-38685_9b56c553-3fdd-41c2-b6ec-83a4ee612efa"] = "980af212-2059-4fd8-a088-d5b85ed5068d";
  }
  if (classId === 149) select(38661, 38667);
  if (classId === 336) select(57715, 39314);
  Object.assign(selections, options.selections);
  const character = {
    id: 1, name: `${classRow.name} audit`, level,
    details: { class: classRow }, operation_data: { selections },
    meta_data: { active_modes: options.active ? ["CUSTODIAN_OF_GROVES_AND_GARDENS___PRIMARY"] : [],
      calculated_stats: { profs: { SPELL_ATTACK: { total: 8 }, SPELL_DC: { total: 8 } } } },
    spells: { list: [], slots: [] },
    inventory: { items: [{ id: "formula", is_formula: true, item: { id: 123, name: "Saved formula" } }] },
  };
  const originalFetch = globalThis.fetch;
  const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const originalEnv = envKeys.map((key) => process.env[key]);
  if (!options.live) {
    process.env.SUPABASE_URL = "https://audit.invalid";
    process.env.SUPABASE_ANON_KEY = "fixture";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  }
  const lookedUpSpells = new Set<number>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split("/").pop();
    if (endpoint === "campaign") return Response.json([{ id: 1, user_id: "gm" }]);
    if (endpoint === "character") return Response.json([character]);
    if (endpoint === "encounter") return Response.json([{ id: 2, campaign_id: 1,
      combatants: { list: [{ _id: "audit", type: "CHARACTER", character: 1 }] } }]);
    if (options.live) {
      assert.ok(["ability_block", "find-class", "find-ability-block", "find-spell"].includes(String(endpoint)));
      return originalFetch(input, init);
    }
    if (endpoint === "ability_block") return Response.json(fixture.features.filter((row) =>
      row.traits.includes(classRow.trait_id) && (row.level === null || row.level <= level)));
    const ids: number[] = JSON.parse(String(init?.body)).id;
    if (endpoint === "find-class") return Response.json({ data: [classRow] });
    if (endpoint === "find-ability-block") return Response.json({ data: [...fixture.features, ...fixture.blocks].filter((row) => ids.includes(row.id)) });
    if (endpoint === "find-spell") {
      ids.forEach((id) => lookedUpSpells.add(id));
      return Response.json({ data: fixture.spells.filter((row) => ids.includes(row.id)) });
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };
  try {
    const result = await createSupabaseReader().loadEncounter("gm", 1, 2, "audit");
    assert.ok(result);
    return { sheet: result.sheets.audit, lookedUpSpells };
  } finally {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, i) => {
      if (originalEnv[i] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[i];
    });
  }
}

test("Animist includes granted apparition spells, respects level gates, and excludes inactive vessel spells", async () => {
  const { sheet, lookedUpSpells } = await readClass(148);
  assert.deepEqual(sheet.spells.map((spell) => spell.name).sort(), ["Protector Tree", "Tangle Vine"]);
  assert.ok(sheet.spells.every((spell) => spell.tradition === "ANIMIST_APPARITION"));
  assert.ok(!lookedUpSpells.has(5037), "level 3 apparition spell must not be fetched at level 1");
  assert.ok(!lookedUpSpells.has(7269), "inactive primary mode must not grant its vessel spell");
});

test("Animist primary mode enables its vessel spell without losing normal apparition spells", async () => {
  const { sheet } = await readClass(148, { active: true, level: 3 });
  assert.equal(sheet.spells.length, 4);
  assert.ok(sheet.spells.some((spell) => spell.name === "Gentle Breeze" && spell.rank === 2));
  const vessel = sheet.spells.find((spell) => spell.name === "Garden of Healing")!;
  assert.equal(vessel.tradition, "focus");
  assert.equal(vessel.attack, 8);
  assert.equal(vessel.dc, 18);
});

test("Animist Shaman grants follow level-dependent nested feat operations", async () => {
  const first = await readClass(148, { shaman: true });
  assert.ok(first.sheet.feats.some((feat) => feat.name === "Spirit Familiar"));
  assert.ok(!first.sheet.feats.some((feat) => feat.name === "Enhanced Familiar"));
  assert.ok(!first.sheet.feats.some((feat) => feat.name === "Incredible Familiar"));
  const ninth = await readClass(148, { shaman: true, level: 9 });
  assert.ok(ninth.sheet.feats.some((feat) => feat.name === "Enhanced Familiar"));
  assert.ok(ninth.sheet.feats.some((feat) => feat.name === "Incredible Familiar"));
});

test("Alchemist exposes nested Quick Alchemy and the selected research field without inventing spells", async () => {
  const { sheet } = await readClass(107);
  assert.equal(sheet.spells.length, 0);
  const quickAlchemy = sheet.groups.flatMap((group) => group.actions).find((ability) => ability.name === "Quick Alchemy")!;
  assert.equal(quickAlchemy.actions, 1);
  assert.ok(sheet.feats.some((feat) => feat.name === "Bomber Research Field"));
  assert.ok(sheet.groups.find((group) => group.id === "class-abilities")?.actions.some((ability) => ability.name === "Bomber Research Field" && ability.description));
  assert.equal((sheet.inventory as Json).items[0].is_formula, true);
});

test("Exemplar exposes its selected ikon, Shift Immanence, and variable-cost Spark Transcendence", async () => {
  const { sheet } = await readClass(149);
  assert.equal(sheet.spells.length, 0);
  assert.ok(sheet.feats.some((feat) => feat.name === "Gleaming Blade"));
  const abilities = sheet.groups.flatMap((group) => group.actions);
  assert.equal(abilities.find((ability) => ability.name === "Shift Immanence")?.actions, 1);
  assert.equal(abilities.find((ability) => ability.name === "Spark Transcendence")?.actionCost, "ONE-TO-THREE-ACTIONS");
  assert.ok(abilities.find((ability) => ability.name === "Gleaming Blade")?.description);
});

test("Runesmith exposes selected runes and nested Trace/Invoke actions, with their original action costs", async () => {
  const { sheet } = await readClass(336, { level: 2 });
  assert.equal(sheet.spells.length, 0);
  const abilities = sheet.groups.flatMap((group) => group.actions);
  assert.ok(sheet.feats.some((feat) => feat.name === "Atryl, Rune of Fire"));
  assert.equal(abilities.find((ability) => ability.name === "Trace Rune")?.actionCost, "ONE-TO-TWO-ACTIONS");
  assert.equal(abilities.find((ability) => ability.name === "Invoke Rune")?.actions, 1);
  assert.equal(abilities.find((ability) => ability.name === "Shield Block")?.actionCost, "REACTION");
  assert.ok(abilities.find((ability) => ability.name === "Atryl, Rune of Fire")?.description);
});

test("unknown conditional values are reported instead of granting both branches", async () => {
  const { sheet } = await readClass(107, { operations: [{ id: "unknown", type: "conditional", data: {
    conditions: [{ name: "UNCOMPUTED_FLAG", operator: "EQUALS", value: "yes" }],
    trueOperations: [{ type: "giveSpell", data: { type: "FOCUS", spellId: 7269 } }],
    falseOperations: [{ type: "giveSpell", data: { type: "NORMAL", spellId: 6759 } }],
  } }] });
  assert.equal(sheet.spells.length, 0);
  assert.deepEqual((sheet.details as Json).unresolvedConditions, ["UNCOMPUTED_FLAG"]);
});

test("predefined spell choices inherit the first option metadata exactly as the OG UI does", async () => {
  const { sheet } = await readClass(107, { selections: { class_spell_pick: "second" }, operations: [{
    id: "spell_pick", type: "select", data: {
      optionType: "SPELL", modeType: "PREDEFINED", title: "Focus is only a label here",
      optionsFilters: { spellData: { type: "FOCUS" } },
      optionsPredefined: [
        { id: "first", operation: { type: "giveSpell", data: { type: "INNATE", spellId: 7269, rank: 2, tradition: "OCCULT", casts: 3 } } },
        { id: "second", operation: { type: "giveSpell", data: { type: "NORMAL", spellId: 4888 } } },
      ],
    },
  }] });
  assert.equal(sheet.spells.length, 1);
  assert.equal(sheet.spells[0].name, "Tangle Vine");
  assert.equal(sheet.spells[0].tradition, "OCCULT");
  assert.equal(sheet.spells[0].rank, 2);
  assert.equal(sheet.spells[0].max, 3);
});

test("a later pass resolves conditions depending on nested granted feats", async () => {
  const { sheet } = await readClass(107, { operations: [{ type: "conditional", data: {
    conditions: [{ name: "FEAT_NAMES", operator: "INCLUDES", value: "Quick Alchemy" }],
    trueOperations: [{ type: "giveSpell", data: { type: "FOCUS", spellId: 7269 } }], falseOperations: [],
  } }] });
  assert.equal(sheet.spells[0]?.name, "Garden of Healing");
  assert.ok((sheet.details as Json).scanPasses >= 2);
});

test("stale selections cannot enable a class feature above the character's level", async () => {
  const { sheet } = await readClass(148, { selections: {
    "class-feature-38686_fa2326db-f5f4-489d-953c-625176704fda": "38708",
  } });
  assert.ok(!sheet.classFeatures.some((feature) => feature.name === "Third Apparition"));
  assert.equal(sheet.spells.length, 2);
});

test("local WG stack: all four classes resolve through the actual REST and edge-function endpoints", {
  skip: process.env.WGUI_LOCAL_STACK !== "1",
}, async () => {
  const animist = await readClass(148, { active: true, live: true });
  assert.ok(animist.sheet.spells.some((spell) => spell.name === "Tangle Vine"));
  assert.ok(animist.sheet.spells.some((spell) => spell.name === "Garden of Healing" && spell.tradition === "focus"));
  for (const [classId, names] of [
    [107, ["Quick Alchemy", "Bomber Research Field"]],
    [149, ["Shift Immanence", "Spark Transcendence", "Gleaming Blade"]],
    [336, ["Trace Rune", "Invoke Rune", "Atryl, Rune of Fire"]],
  ] as const) {
    const { sheet } = await readClass(classId, { live: true });
    const abilities = sheet.groups.flatMap((group) => group.actions);
    for (const name of names) assert.ok(abilities.some((ability) => ability.name === name), `${classId}: ${name}`);
    assert.equal(sheet.spells.length, 0);
  }
});
