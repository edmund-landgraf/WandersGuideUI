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

test("note page tools add, edit, rename, and delete one page", async () => {
  const kept = { id: "kept", name: "Journal", icon: "book", color: "#111111", shared: true, contents: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Stay" }] }] }, extra: "leave-me" };
  const gm = { name: "GM Notes", icon: "notebook", color: "#359fdf", contents: "secret" };
  let character: Record<string, unknown> = {
    id: 95,
    name: "Pip",
    user_id: "user-1",
    updated_at: "t0",
    notes: { pages: [gm, kept], marker: "bag" },
  };
  const updates: Record<string, unknown>[] = [];
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/update-character")) {
      updates.push(body);
      assert.equal(body.expected_updated_at, character.updated_at);
      assert.deepEqual(Object.keys(body).sort(), ["expected_updated_at", "id", "notes"]);
      character = { ...character, notes: body.notes, updated_at: `t${updates.length}` };
      return jsonResponse({ status: "success", data: character });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const pages = () => (character.notes as { pages: Record<string, unknown>[]; marker?: string }).pages;
  const bag = () => character.notes as { marker?: string };

  const added = await client.callTool({ name: "add_character_note", arguments: { characterId: 95, title: " Session ", contents: "Hello", position: 1 } });
  assert.equal(added.isError, undefined);
  assert.equal(pages()[1].name, "Session");
  assert.equal(pages()[1].icon, "notebook");
  assert.equal(pages()[1].color, "#359fdf");
  assert.equal(pages()[1].contents, "Hello");
  assert.equal(pages()[1].id, undefined);
  assert.deepEqual(pages()[0], gm);
  assert.deepEqual(pages()[2], kept);
  assert.equal(bag().marker, "bag");

  const edited = await client.callTool({ name: "edit_character_note", arguments: { characterId: 95, pageIndex: 1, contents: "Updated" } });
  assert.equal(edited.isError, undefined);
  assert.equal(pages()[1].contents, "Updated");
  assert.equal(pages()[1].name, "Session");
  assert.deepEqual(pages()[2], kept);

  const byId = await client.callTool({ name: "edit_character_note", arguments: { characterId: 95, pageId: "kept", contents: "Still here" } });
  assert.equal(byId.isError, undefined);
  assert.equal(pages()[2].contents, "Still here");
  assert.equal(pages()[2].name, "Journal");
  assert.equal(pages()[2].extra, "leave-me");
  assert.equal(pages()[2].shared, true);

  const renamed = await client.callTool({ name: "rename_character_note", arguments: { characterId: 95, pageId: "kept", title: " Field notes " } });
  assert.equal(renamed.isError, undefined);
  assert.equal(pages()[2].name, "Field notes");
  assert.equal(pages()[2].contents, "Still here");
  assert.equal(pages()[2].icon, "book");
  assert.equal(pages()[2].color, "#111111");

  const missing = await client.callTool({ name: "delete_character_note", arguments: { characterId: 95, pageIndex: 9 } });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent?.code, "NOTE_NOT_FOUND");
  const missingId = await client.callTool({ name: "edit_character_note", arguments: { characterId: 95, pageId: "nope", contents: "x" } });
  assert.equal(missingId.structuredContent?.code, "NOTE_NOT_FOUND");
  assert.equal(updates.length, 4);

  const gmName = await client.callTool({ name: "add_character_note", arguments: { characterId: 95, title: "gm notes", contents: "no" } });
  assert.equal(gmName.structuredContent?.code, "VALIDATION_ERROR");
  const empty = await client.callTool({ name: "rename_character_note", arguments: { characterId: 95, pageIndex: 1, title: "  " } });
  assert.equal(empty.structuredContent?.code, "VALIDATION_ERROR");
  assert.equal(pages()[1].name, "Session");

  const removed = await client.callTool({ name: "delete_character_note", arguments: { characterId: 95, pageIndex: 1 } });
  assert.equal(removed.isError, undefined);
  assert.equal(pages().length, 2);
  assert.deepEqual(pages()[0], gm);
  assert.equal(pages()[1].id, "kept");
  assert.equal(pages()[1].name, "Field notes");
  assert.equal(bag().marker, "bag");

  character = { ...character, user_id: "someone-else" };
  const writes = updates.length;
  const stolen = await client.callTool({ name: "delete_character_note", arguments: { characterId: 95, pageIndex: 0 } });
  assert.equal(stolen.structuredContent?.code, "CHARACTER_FORBIDDEN");
  assert.equal(updates.length, writes);

  await client.close();
  setCharacterFetch(null);
});
