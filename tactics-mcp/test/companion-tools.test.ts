import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  companionChoicesFromPackage,
  companionTypeName,
  companionsRecord,
  creatureAddable,
  selectionsWithout,
  setCompanionChoiceRunner,
  sheetLevel,
  trimmedCompanionName,
  withAbilities,
  withSelections,
} from "../src/character-companions.js";
import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const bear = {
  id: 10,
  name: "Bear",
  level: -100,
  content_source_id: 1,
  operations: [
    { type: "giveTrait", data: { traitId: 5 } },
    { type: "giveTrait", data: { traitId: -1 } },
    { type: "giveTrait", data: { traitId: 9 } },
  ],
  operation_data: { notes: { keeper: "yes" }, selections: {} },
  abilities_base: [{ id: 1, name: "Support Benefit" }],
  abilities_added: [],
  hp_current: 8,
  hp_temp: 0,
  details: { description: "A bear." },
};

const CREATURES: Record<number, Record<string, unknown>> = {
  10: bear,
  11: {
    id: 11,
    name: "Cat",
    level: -100,
    content_source_id: 1,
    operations: [{ type: "giveTrait", data: { traitId: 9 } }],
    operation_data: null,
    abilities_base: [],
    abilities_added: [],
    hp_current: 6,
    hp_temp: 0,
    details: { description: "A cat." },
  },
  12: {
    id: 12,
    name: "Wolf",
    level: 2,
    content_source_id: 1,
    operations: [{ type: "giveTrait", data: { traitId: 5 } }],
    operation_data: null,
    abilities_added: [],
    hp_current: 20,
    hp_temp: 0,
    details: { description: "A wolf." },
  },
  13: {
    id: 13,
    name: "Hidden Template",
    level: -100,
    content_source_id: 1,
    operations: [],
    details: { description: "" },
  },
  14: {
    id: 14,
    name: "Other Book",
    level: 1,
    content_source_id: 900,
    operations: [],
    details: { description: "" },
  },
};

const TRAITS: Record<number, Record<string, unknown>> = {
  5: { id: 5, name: "Animal", content_source_id: 3, meta_data: {} },
  9: { id: 9, name: "Animal Companion", content_source_id: 3, meta_data: { companion_type_trait: true } },
};

const ABILITIES: Record<number, Record<string, unknown>> = {
  77: { id: 77, name: "Mature Animal Companion", content_source_id: 1 },
  88: { id: 88, name: "Foreign Feat", content_source_id: 900 },
};

test("companion type, addability, selections, and drawer choice keys", () => {
  const traits = new Map([
    [5, { id: 5, name: "Animal", companionType: false }],
    [9, { id: 9, name: "Familiar", companionType: true }],
    [4, { id: 4, name: "Eidolon", companionType: true }],
  ]);
  assert.equal(companionTypeName([5, 9], traits), "Familiar");
  assert.equal(companionTypeName([4, 9], traits), "Eidolon");
  assert.equal(companionTypeName([5], traits), "Creature");
  assert.equal(creatureAddable(-100, [9], traits, []), true);
  assert.equal(creatureAddable(-100, [], traits, []), false);
  assert.equal(creatureAddable(-100, [9], traits, [9]), false);
  assert.equal(creatureAddable(2, [], traits, []), true);
  assert.equal(sheetLevel(-100, 5), 5);
  assert.equal(sheetLevel(-100, undefined), 0);
  assert.equal(sheetLevel(2, 5), 2);
  assert.equal(trimmedCompanionName("  Scout  "), "Scout");
  assert.equal(trimmedCompanionName("   "), null);

  const noted = withSelections({ operation_data: { notes: { keeper: "yes" }, selections: { creature_spec: "nimble", creature_spec_nimble_extra: "stale" } } }, selectionsWithout({
    creature_spec: "nimble",
    creature_spec_nimble_extra: "stale",
    other: "keep",
  }, "creature_spec"));
  assert.deepEqual(noted.operation_data, { notes: { keeper: "yes" }, selections: { other: "keep" } });
  assert.deepEqual(withAbilities({ abilities_added: [1, 2] }, [2, 3], [1]).abilities_added, [2, 3]);
  assert.deepEqual(companionsRecord({ companions: { note: "keep", list: [] } }, [{ id: 1 }]), { note: "keep", list: [{ id: 1 }] });

  const choices = companionChoicesFromPackage({
    creatureResults: [
      { selection: { id: "spec", options: [{ _select_uuid: "nimble", _content_type: "ability-block", name: "Nimble", traits: [] }] } },
      {
        selection: { id: "parent" },
        result: {
          source: { name: "Picked", _select_uuid: "picked" },
          results: [{ selection: { id: "child", options: [{ _select_uuid: "leaf", name: "Leaf" }] } }],
        },
      },
    ],
    abilityResults: [{
      baseSource: { id: 77 },
      baseResults: [{ selection: { id: "adv", options: [{ _select_uuid: "mate", name: "Mature" }] } }],
    }],
    itemResults: [{
      baseSource: { id: 4 },
      baseResults: [{ selection: { id: "rune", options: [{ _select_uuid: "ghost", name: "Ghost" }] } }],
    }],
  });
  assert.deepEqual(choices.map((choice) => choice.id), ["creature_spec", "creature_parent_picked_child", "ability-77_adv", "item-4_rune"]);
  assert.equal(choices[0].options[0].id, "nimble");
});

test("companion tools add, update, and remove the sheet's companions list", async () => {
  type Stored = { id?: number; name?: string; operation_data?: { selections?: Record<string, string>; notes?: Record<string, string> } | null; abilities_added?: number[] };
  let character: Record<string, unknown> = {
    id: 95,
    user_id: "user-1",
    name: "Pip",
    level: 5,
    updated_at: "t0",
    content_sources: { enabled: [1, 256] },
    companions: { note: "keep", list: [] },
  };
  let saves = 0;
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const bearBefore = JSON.stringify(CREATURES[10]);
  setCompanionChoiceRunner(async (_row, creature) => {
    const selections = (creature.operation_data as Stored["operation_data"])?.selections ?? {};
    if (selections["creature_spec"]) return [];
    return [{
      id: "creature_spec",
      source: "creature",
      kind: "ability-block",
      remaining: 1,
      already: [],
      options: [
        { id: "nimble", name: "Nimble", traits: [] },
        { id: "brutal", name: "Brutal", traits: [] },
      ],
    }];
  });
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const name = url.split("/").pop() ?? "";
    calls.push({ name, body });
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/find-creature") || url.endsWith("/find-trait") || url.endsWith("/find-ability-block")) {
      assert.deepEqual(body.content_sources, [3, 1, 256]);
      const table = url.endsWith("/find-creature") ? CREATURES : url.endsWith("/find-trait") ? TRAITS : ABILITIES;
      const row = table[body.id as number];
      return jsonResponse({ status: "success", data: row ? [row] : [] });
    }
    if (url.endsWith("/update-character")) {
      saves += 1;
      assert.equal(body.expected_updated_at, character.updated_at);
      assert.deepEqual(Object.keys(body).sort(), ["companions", "expected_updated_at", "id"]);
      const companions = body.companions as { note?: string; list: Stored[] };
      assert.equal(companions.note, "keep");
      character = { ...character, companions, updated_at: `t${saves}` };
      return jsonResponse({ status: "success", data: character });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listOf = () => ((character.companions as { list: Stored[] }).list);
  const codeOf = (result: { structuredContent?: unknown }) => (result.structuredContent as { code?: string } | undefined)?.code;

  const empty = await client.callTool({ name: "list_companions", arguments: { characterId: 95 } });
  assert.equal(empty.isError, undefined);
  assert.equal((empty.structuredContent as { companions: unknown[] }).companions.length, 0);

  const hidden = await client.callTool({ name: "add_companion", arguments: { characterId: 95, creatureId: 13 } });
  assert.equal(hidden.isError, true);
  assert.equal(codeOf(hidden), "VALIDATION_ERROR");
  const foreign = await client.callTool({ name: "add_companion", arguments: { characterId: 95, creatureId: 14 } });
  assert.equal(codeOf(foreign), "NOT_IN_BOOKS");
  const missing = await client.callTool({ name: "add_companion", arguments: { characterId: 95, creatureId: 999 } });
  assert.equal(codeOf(missing), "NOT_FOUND");
  assert.equal(saves, 0);

  const added = await client.callTool({ name: "add_companion", arguments: { characterId: 95, creatureId: 10, name: "  Scout  " } });
  assert.equal(added.isError, undefined);
  assert.equal((added.structuredContent as { index: number; type: string }).index, 0);
  assert.equal((added.structuredContent as { type: string }).type, "Animal Companion");
  assert.equal(listOf()[0].name, "Scout");
  assert.equal(listOf()[0].operation_data?.notes?.keeper, "yes");
  assert.equal(JSON.stringify(CREATURES[10]), bearBefore);
  const listed = await client.callTool({ name: "list_companions", arguments: { characterId: 95 } });
  const first = (listed.structuredContent as { companions: { type: string; sheetLevel: number; storeId: string; abilitiesBase: { name: string }[]; options: { id: string }[]; hpCurrent: number }[] }).companions[0];
  assert.equal(first.type, "Animal Companion");
  assert.equal(first.sheetLevel, 5);
  assert.equal(first.storeId, "COMPANION_0");
  assert.equal(first.abilitiesBase[0].name, "Support Benefit");
  assert.equal(first.hpCurrent, 8);
  assert.equal(first.options[0].id, "creature_spec");

  const illegal = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, choiceId: "creature_spec", optionId: "aquan" } });
  assert.equal(illegal.isError, true);
  assert.equal(codeOf(illegal), "VALIDATION_ERROR");
  const chosen = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, choiceId: "creature_spec", optionId: "nimble" } });
  assert.equal(chosen.isError, undefined);
  assert.equal(listOf()[0].operation_data?.selections?.creature_spec, "nimble");
  listOf()[0].operation_data = { ...listOf()[0].operation_data, selections: { ...listOf()[0].operation_data?.selections, creature_spec_nimble_extra: "stale" } };
  const changed = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, choiceId: "creature_spec", optionId: "brutal" } });
  assert.equal(changed.isError, undefined);
  assert.deepEqual(listOf()[0].operation_data?.selections, { creature_spec: "brutal" });
  const cleared = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, choiceId: "creature_spec", optionId: "" } });
  assert.equal(cleared.isError, undefined);
  assert.deepEqual(listOf()[0].operation_data?.selections, {});

  const blank = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, name: "  " } });
  assert.equal(codeOf(blank), "VALIDATION_ERROR");
  const half = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, choiceId: "creature_spec" } });
  assert.equal(codeOf(half), "VALIDATION_ERROR");
  const none = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0 } });
  assert.equal(codeOf(none), "VALIDATION_ERROR");
  const outside = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, addAbilityIds: [88] } });
  assert.equal(codeOf(outside), "NOT_IN_BOOKS");
  const matured = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, addAbilityIds: [77, 77] } });
  assert.equal(matured.isError, undefined);
  assert.deepEqual(listOf()[0].abilities_added, [77]);
  const dropped = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, removeAbilityIds: [77] } });
  assert.equal(dropped.isError, undefined);
  assert.deepEqual(listOf()[0].abilities_added, []);
  const again = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, removeAbilityIds: [77] } });
  assert.equal(codeOf(again), "NOT_FOUND");

  await client.callTool({ name: "add_companion", arguments: { characterId: 95, creatureId: 12 } });
  const swapped = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, creatureId: 11 } });
  assert.equal(swapped.isError, undefined);
  assert.equal(listOf()[0].id, 11);
  assert.equal(listOf()[0].name, "Cat");
  assert.deepEqual(listOf()[0].operation_data?.selections ?? {}, {});
  assert.equal(listOf()[1].name, "Wolf");

  const removed = await client.callTool({ name: "remove_companion", arguments: { characterId: 95, index: 0 } });
  assert.equal(removed.isError, undefined);
  assert.equal(listOf().length, 1);
  assert.equal(listOf()[0].name, "Wolf");
  const gone = await client.callTool({ name: "remove_companion", arguments: { characterId: 95, index: 3 } });
  assert.equal(codeOf(gone), "NOT_FOUND");

  character = { ...character, user_id: "someone-else" };
  const savesBefore = saves;
  const denied = await client.callTool({ name: "add_companion", arguments: { characterId: 95, creatureId: 12 } });
  assert.equal(codeOf(denied), "CHARACTER_FORBIDDEN");
  assert.equal(saves, savesBefore);
  character = { ...character, user_id: "User-1" };
  const owned = await client.callTool({ name: "update_companion", arguments: { characterId: 95, index: 0, name: "Grey" } });
  assert.equal(owned.isError, undefined);
  assert.equal(listOf()[0].name, "Grey");

  assert.ok(calls.some((call) => call.name === "find-character" && call.body.id === 95));
  assert.ok(calls.some((call) => call.name === "find-creature" && call.body.id === 10 && Array.isArray(call.body.content_sources)));
  assert.ok(calls.some((call) => call.name === "find-trait" && call.body.id === 9));
  assert.ok(calls.some((call) => call.name === "find-ability-block" && call.body.id === 77));
  const saved = calls.filter((call) => call.name === "update-character");
  assert.ok(saved.length > 0);
  assert.deepEqual(Object.keys(saved[0].body).sort(), ["companions", "expected_updated_at", "id"]);

  await client.close();
  setCompanionChoiceRunner(null);
  setCharacterFetch(null);
});
