import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterChoiceRunner, setCharacterWriteApplier } from "../src/character-choices.js";
import { setCharacterFetch } from "../src/character-client.js";
import { applyResourcePools } from "../src/character-resources.js";
import { setResourceCalculator } from "../src/character-resources.js";
import { registerCatalog } from "../src/catalog.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Level 4 Human druid, class HP 8, ancestry HP 8, Constitution modifier +1, one focus spell. */
const DRUID_POOLS = { maxHp: 8 + (8 + 1) * 4, maxFocus: 1 };

function leafDruid(resources: { hp: number; focus: number; fresh?: boolean }) {
  return {
    id: 151,
    name: "Leaf",
    level: 4,
    user_id: "user-1",
    updated_at: "t0",
    hp_current: resources.hp,
    meta_data: { reset_hp: resources.fresh !== false },
    content_sources: { enabled: [1] },
    details: { ancestry: { name: "Human" }, class: { name: "Druid" }, class_archetype: { name: "Leaf Order" } },
    operation_data: { selections: {} },
    spells: { slots: [{ rank: 1, source: "Primal", exhausted: true }], list: [], focus_point_current: resources.focus, innate_casts: [] },
  };
}

test("a fresh level 4 druid fills calculated HP and focus, and a later edit keeps damage", () => {
  const fresh = leafDruid({ hp: 1, focus: 0 });
  const filled = applyResourcePools(fresh, DRUID_POOLS, false);
  assert.equal(filled.reason, "initialized");
  assert.equal(filled.character.hp_current, 44);
  assert.equal((filled.character.meta_data as { reset_hp: boolean }).reset_hp, false);
  assert.equal((filled.character.spells as { focus_point_current: number }).focus_point_current, 1);
  assert.equal((filled.character.spells as { slots: { exhausted: boolean }[] }).slots[0].exhausted, true);

  const wounded = leafDruid({ hp: 1, focus: 0, fresh: false });
  const kept = applyResourcePools(wounded, DRUID_POOLS, false);
  assert.equal(kept.reason, "kept");
  assert.equal(kept.character.hp_current, 1);
  assert.equal((kept.character.spells as { focus_point_current: number }).focus_point_current, 0);

  const rested = applyResourcePools({ ...wounded, hp_current: 31 }, DRUID_POOLS, true);
  assert.equal(rested.reason, "rest");
  assert.equal(rested.character.hp_current, 44);
  assert.equal((rested.character.spells as { focus_point_current: number }).focus_point_current, 1);
});

test("initialize_character writes a fresh druid and choose keeps spent resources", async () => {
  let character: Record<string, unknown> = leafDruid({ hp: 1, focus: 0 });
  const updates: Record<string, unknown>[] = [];
  setResourceCalculator(async () => DRUID_POOLS);
  setCharacterWriteApplier(async (row) => row);
  setCharacterChoiceRunner(async () => [{
    id: "lang-1",
    source: "class",
    kind: "language",
    remaining: 1,
    already: [],
    options: [{ id: "common", name: "Common", traits: [] }],
  }]);
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/update-character")) {
      updates.push(body);
      character = { ...character, ...body, updated_at: `t${updates.length}` };
      return jsonResponse({ status: "success", data: character });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const initialized = await client.callTool({ name: "initialize_character", arguments: { characterId: 151 } });
  assert.equal(initialized.isError, undefined);
  assert.equal(updates[0].hp_current, 44);
  assert.equal((updates[0].spells as { focus_point_current: number }).focus_point_current, 1);
  assert.equal((updates[0].meta_data as { reset_hp: boolean }).reset_hp, false);

  character = { ...character, hp_current: 31, spells: { ...(character.spells as object), focus_point_current: 0 } };
  const chosen = await client.callTool({ name: "choose", arguments: { characterId: 151, choiceId: "lang-1", optionId: "common" } });
  assert.equal(chosen.isError, undefined);
  assert.equal(updates[1].hp_current, 31);
  assert.equal((updates[1].spells as { focus_point_current: number }).focus_point_current, 0);

  const refused = await client.callTool({ name: "initialize_character", arguments: { characterId: 151 } });
  assert.equal(refused.isError, undefined);
  assert.equal(updates.length, 2);
  assert.match(JSON.stringify(refused.structuredContent), /kept/);

  setResourceCalculator(undefined);
  setCharacterWriteApplier(undefined);
  setCharacterChoiceRunner(null);
});
