import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ITEMS: Record<number, Record<string, unknown>> = {
  1: { id: 1, name: "Backpack", group: "GENERAL", meta_data: { bulk: { capacity: 4, held_or_stowed: 0.1 }, hp_max: 0 } },
  2: { id: 2, name: "Alchemist's Fire (Minor)", group: "WEAPON", traits: [], meta_data: { quantity: 1, hp_max: 1 } },
  3: { id: 3, name: "Adventurer's Pack", group: "GENERAL", meta_data: { container_default_items: [{ id: 1, quantity: 1 }, { id: 4, quantity: 10 }], hp_max: 0 } },
  4: { id: 4, name: "Torch", group: "GENERAL", meta_data: { quantity: 1, hp_max: 1 } },
};

test("add_inventory_item writes formulas, containers, default contents and removes", async () => {
  type Inv = { items: { id: string; is_formula: boolean; item: { name: string; meta_data?: Record<string, unknown> }; container_contents: { id: string; item: { name: string; meta_data?: Record<string, unknown> } }[] }[] };
  let character: Record<string, unknown> = {
    id: 95, name: "Pip", level: 1, updated_at: "t0",
    content_sources: { enabled: [1, 256] }, details: {}, operation_data: { selections: {} },
    inventory: { coins: { cp: 0, sp: 150, gp: 0, pp: 0 }, items: [] },
  };
  let saves = 0;
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/find-item")) {
      assert.deepEqual(body.content_sources, [1, 256]);
      const item = ITEMS[body.id as number];
      return jsonResponse({ status: "success", data: item ? [item] : [] });
    }
    if (url.endsWith("/update-character")) {
      saves += 1;
      assert.equal(body.expected_updated_at, character.updated_at);
      assert.deepEqual(Object.keys(body).sort(), ["expected_updated_at", "id", "inventory"]);
      character = { ...character, inventory: body.inventory, updated_at: `t${saves}` };
      return jsonResponse({ status: "success", data: character });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const inv = () => character.inventory as Inv;

  const formula = await client.callTool({ name: "add_inventory_item", arguments: { characterId: 95, itemId: 2, isFormula: true } });
  assert.equal(formula.isError, undefined);
  assert.equal(inv().items[0].is_formula, true);

  const pack = await client.callTool({ name: "add_inventory_item", arguments: { characterId: 95, itemId: 1 } });
  const packId = (pack.structuredContent as { inventoryItemId: string }).inventoryItemId;
  const fire = await client.callTool({ name: "add_inventory_item", arguments: { characterId: 95, itemId: 2, quantity: 2, containerId: packId } });
  assert.equal(fire.isError, undefined);
  const backpack = inv().items.find((x) => x.id === packId)!;
  assert.equal(backpack.container_contents[0].item.name, "Alchemist's Fire (Minor)");
  assert.equal(backpack.container_contents[0].item.meta_data?.quantity, 2);
  assert.equal(inv().items.length, 2);

  const badContainer = await client.callTool({ name: "add_inventory_item", arguments: { characterId: 95, itemId: 2, containerId: inv().items.find((x) => x.is_formula)!.id } });
  assert.equal(badContainer.isError, true);
  const formulaInBag = await client.callTool({ name: "add_inventory_item", arguments: { characterId: 95, itemId: 2, isFormula: true, containerId: packId } });
  assert.equal(formulaInBag.isError, true);
  const missing = await client.callTool({ name: "add_inventory_item", arguments: { characterId: 95, itemId: 999 } });
  assert.equal(missing.isError, true);

  await client.callTool({ name: "add_inventory_item", arguments: { characterId: 95, itemId: 3 } });
  const kit = inv().items.find((x) => x.item.name === "Adventurer's Pack")!;
  assert.deepEqual(kit.container_contents.map((c) => [c.item.name, c.item.meta_data?.quantity]), [["Backpack", 1], ["Torch", 10]]);
  assert.deepEqual(inv().items.map((x) => x.item.name), ["Adventurer's Pack", "Alchemist's Fire (Minor)", "Backpack"]);

  const fireId = backpack.container_contents[0].id;
  const removed = await client.callTool({ name: "remove_inventory_item", arguments: { characterId: 95, inventoryItemId: fireId } });
  assert.equal(removed.isError, undefined);
  assert.equal(inv().items.find((x) => x.id === packId)!.container_contents.length, 0);
  const again = await client.callTool({ name: "remove_inventory_item", arguments: { characterId: 95, inventoryItemId: fireId } });
  assert.equal(again.isError, true);
  assert.equal(saves, 5);
  await client.close();
  setCharacterFetch(null);
});
