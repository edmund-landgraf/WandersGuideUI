import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createSupabaseReader } from "../src/supabase-reader.js";
import { getEncounterReader, setEncounterReader } from "../src/reader.js";
import { registerCatalog } from "../src/catalog.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

type Json = Record<string, unknown>;
const focusPick = (id: string) => ({
  id, type: "select", data: {
    optionType: "SPELL", modeType: "FILTERED",
    optionsFilters: { spellData: { type: "FOCUS", rank: 1 } },
  },
});
const blockPick = (id: string) => ({
  id, type: "select", data: { optionType: "ABILITY_BLOCK", modeType: "FILTERED" },
});

async function loadFixture(options: { missingSpell?: boolean; missingClass?: boolean; extraGrants?: boolean; realKota?: boolean; automaticOnly?: boolean } = {}) {
  const actual = options.realKota ? JSON.parse(await readFile(new URL("./fixtures/kota-focus.json", import.meta.url), "utf8")) as {
    character: Json; classFeatures: Json[]; blocks: Json[]; spells: Json[];
  } : undefined;
  if (actual && options.automaticOnly) {
    actual.character.operation_data = { selections: {} };
    actual.classFeatures = actual.classFeatures.filter((row) => row.id === 57685);
    actual.blocks = [];
  }
  const character = actual?.character ?? {
    id: 7, name: "Kota", level: 10,
    details: { class: { id: 337, operations: [focusPick("old-pick")] } },
    spells: { list: Array.from({ length: 21 }, (_, i) => ({ spell_id: i + 1, rank: 1 })) },
    operation_data: { selections: {
      "class_class-pick": "101",
      "class-feature-500_feat-pick": "501",
      "class-feature-500_feat-pick_501_feat-focus": "102",
      "class-feature-500_feat-pick_501_deep-pick": "502",
      "class-feature-500_deep-focus": "103",
      "class-feature-600_another-focus": "104",
      "class-feature-600_last-focus": "105",
      "class_predefined": "chosen",
      "class_spell-option": "selected-spell",
      "class_unrelated": "unchosen",
    } },
  };
  const blocks = actual?.blocks ?? [
    { id: 500, name: "Class feature", operations: [blockPick("feat-pick")] },
    { id: 501, name: "Selected feat", operations: [focusPick("feat-focus"), blockPick("deep-pick")] },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: 502 + i, name: `Nested feature ${i}`, operations: i === 5
        ? [focusPick("deep-focus")]
        : [{ type: "giveAbilityBlock", data: { abilityBlockId: 503 + i } }],
    })),
    { id: 600, name: "Other feature", operations: [focusPick("another-focus"), focusPick("last-focus")] },
  ];
  const requests: { endpoint: string; ids: number[] }[] = [];
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map((key) => [key, process.env[key]]));
  process.env.SUPABASE_URL = "https://fixture.invalid";
  process.env.SUPABASE_ANON_KEY = "fixture";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/campaign")) return Response.json([{ id: 1, user_id: "gm" }]);
    if (url.pathname.endsWith("/character")) return Response.json([character]);
    if (url.pathname.endsWith("/ability_block")) {
      assert.equal(url.searchParams.get("type"), "eq.class-feature");
      assert.equal(url.searchParams.get("traits"), "cs.{5135}");
      assert.equal(url.searchParams.get("or"), "(level.lte.2,level.is.null)");
      return Response.json(actual?.classFeatures ?? []);
    }
    if (url.pathname.endsWith("/encounter")) return Response.json([{
      id: 2, campaign_id: 1,
      combatants: { list: [{ _id: "kota", type: "CHARACTER", character: character.id }] },
    }]);
    const endpoint = url.pathname.split("/").pop()!;
    const ids = JSON.parse(String(init?.body)).id as number[];
    requests.push({ endpoint, ids });
    let data: Json[];
    if (endpoint === "find-class" && actual) data = [(actual.character.details as Json).class as Json];
    else if (endpoint === "find-class") data = options.missingClass ? [] : [{
      id: 337, name: "Necromancer", operations: [focusPick("class-pick"), {
        id: "predefined", type: "select", data: { optionType: "CUSTOM", modeType: "PREDEFINED", optionsPredefined: [
          { id: "chosen", type: "CUSTOM", operations: [] },
          { id: "unchosen", type: "CUSTOM", operations: [{ type: "giveSpell", data: { spellId: 999, type: "FOCUS" } }] },
        ] },
      }, ...(options.extraGrants ? [
        { type: "giveSpell", data: { spellId: 106, type: "FOCUS", castingSource: "Necromancer" } },
        { id: "spell-option", type: "select", data: { optionType: "SPELL", modeType: "PREDEFINED", optionsPredefined: [
          { id: "selected-spell", type: "SPELL", operation: { type: "giveSpell", data: { spellId: 107, type: "FOCUS", castingSource: "Necromancer" } } },
          { id: "other-spell", type: "SPELL", operation: { type: "giveSpell", data: { spellId: 108, type: "FOCUS" } } },
        ] } },
      ] : [])],
    }];
    else if (endpoint === "find-ability-block") data = blocks.filter((block) => typeof block.id === "number" && ids.includes(block.id));
    else if (endpoint === "find-spell") data = ids.filter((id) => !options.missingSpell || id !== 101).map((id) => actual?.spells.find((row) => row.id === id) ?? ({ id, name: id === 101 ? "Create Thrall" : `Named spell ${id}`, rank: 1 }));
    else throw new Error(`Unexpected endpoint: ${endpoint}`);
    return Response.json({ data });
  };
  try {
    const record = await createSupabaseReader().loadEncounter("gm", 1, 2, "kota");
    assert.ok(record);
    let toolResult: Record<string, unknown> | undefined;
    if (actual) {
      const previousReader = getEncounterReader();
      const server = new McpServer({ name: "focus-regression", version: "1" });
      const client = new Client({ name: "focus-regression", version: "1" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      setEncounterReader(createSupabaseReader());
      registerCatalog(server, () => "gm");
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const response = await client.callTool({ name: "get_spells", arguments: {
          campaignId: 1, encounterId: 2, combatantId: "kota", view: "gm",
        } });
        assert.ok(!response.isError);
        toolResult = response.structuredContent as Record<string, unknown>;
      } finally {
        await client.close();
        await server.close();
        setEncounterReader(previousReader);
      }
    }
    return { sheet: record.sheets.kota, requests, toolResult };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("resolves five filtered focus picks through fresh class operations and selected feature trees", async () => {
  const { sheet, requests } = await loadFixture();
  assert.equal(sheet.spells.length, 26);
  assert.equal(sheet.spells.filter((spell) => spell.tradition === "focus").length, 5);
  assert.ok(sheet.spells.some((spell) => spell.name === "Create Thrall" && spell.tradition === "focus"));
  assert.deepEqual((sheet.details as Json).focusSpellIds, [101, 104, 105, 102, 103]);
  assert.equal((sheet.details as Json).reader, "focus-scan");
  const spellIds = requests.find((request) => request.endpoint === "find-spell")!.ids;
  assert.ok([101, 102, 103, 104, 105].every((id) => spellIds.includes(id)));
  assert.ok(!spellIds.includes(999), "unselected grants must not be fetched or appended");
  assert.ok(requests.every((request) => request.endpoint.startsWith("find-")));
});

test("automatic Grave Spells are loaded even with no saved selections or selected feats", async () => {
  const { sheet } = await loadFixture({ realKota: true, automaticOnly: true });
  assert.deepEqual(sheet.spells.filter((spell) => spell.tradition === "focus").map((spell) => spell.name).sort(), [
    "Create Thrall", "Necrotic Bomb", "Thrall Charge",
  ]);
  assert.equal(sheet.spells.length, 24);
});

test("keeps a focus row when its spell lookup is missing", async () => {
  const { sheet } = await loadFixture({ missingSpell: true });
  assert.ok(sheet.spells.some((spell) => spell.name === "Spell 101" && spell.tradition === "focus"));
  assert.equal(sheet.spells.length, 26);
});

test("retains saved operations when the source lookup returns no row", async () => {
  const { sheet } = await loadFixture({ missingClass: true });
  assert.equal((sheet.details as Json).classOperations, 1);
  assert.equal(sheet.spells.filter((spell) => spell.tradition === "focus").length, 4);
});

test("marks direct and selected predefined grants as focus with a named casting source", async () => {
  const { sheet, requests } = await loadFixture({ extraGrants: true });
  assert.equal(sheet.spells.filter((spell) => spell.tradition === "focus").length, 7);
  assert.ok(sheet.spells.some((spell) => spell.name === "Named spell 106" && spell.tradition === "focus"));
  assert.ok(sheet.spells.some((spell) => spell.name === "Named spell 107" && spell.tradition === "focus"));
  assert.ok(!requests.find((request) => request.endpoint === "find-spell")!.ids.includes(108));
});

test("Kota's actual Grave Spells and Widespread Fascination operations return all five focus spells", async () => {
  const { sheet, requests, toolResult } = await loadFixture({ realKota: true });
  const focus = sheet.spells.filter((spell) => spell.tradition === "focus");
  assert.equal(sheet.spells.length, 26);
  assert.deepEqual(focus.map((spell) => spell.name).sort(), [
    "Bone Spear", "Create Thrall", "Life Tap", "Necrotic Bomb", "Thrall Charge",
  ]);
  assert.equal(focus.find((spell) => spell.name === "Create Thrall")?.rank, 0);
  assert.equal(focus.find((spell) => spell.name === "Thrall Charge")?.rank, 0);
  assert.deepEqual(((sheet.details as Json).focusSpellIds as number[]).sort(), [8754, 8763, 8765, 8770, 8775]);
  const queried = requests.find((request) => request.endpoint === "find-spell")!.ids;
  assert.ok([8754, 8763, 8765, 8770, 8775].every((id) => queried.includes(id)));
  assert.ok(!queried.includes(8778), "unselected Blood fascination must not be granted");
  assert.deepEqual(toolResult?.spells, sheet.spells);
  assert.equal((toolResult?.liveCasting as Json).revision, "class-operation-grants-v3");
});
