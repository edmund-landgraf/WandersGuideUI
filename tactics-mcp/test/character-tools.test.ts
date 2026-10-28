import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { openChoicesFromPackage, setCharacterChoiceRunner, setCharacterWriteApplier } from "../src/character-choices.js";
import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("open choices keep unfilled language options and skip filled selects", () => {
  const choices = openChoicesFromPackage({
    classResults: [
      {
        selection: {
          id: "lang-1",
          options: [
            { _select_uuid: "thalassic", _content_type: "language", name: "Thalassic", traits: ["aquatic"] },
            { _select_uuid: "elven", _content_type: "language", name: "Elven", traits: [] },
          ],
        },
      },
      { selection: { id: "filled", options: [] }, result: { source: { name: "Dwarven" }, results: [] } },
    ],
  });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].id, "class_lang-1");
  assert.equal(choices[0].kind, "language");
  assert.equal(choices[0].remaining, 1);
  assert.deepEqual(choices[0].options[0], { id: "thalassic", name: "Thalassic", traits: ["aquatic"] });
  assert.deepEqual(choices[0].already, ["Dwarven"]);
});

test("builder tools create, read, set books, reject an illegal choice, and delete", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let character: Record<string, unknown> = {
    id: 102,
    name: "mcp-smoke-test",
    level: 1,
    updated_at: "2026-10-22T00:00:00.000Z",
    content_sources: { enabled: [1, 2, 3] },
    details: {},
    operation_data: { selections: {} },
  };
  setCharacterWriteApplier(null);
  setCharacterChoiceRunner(async () => [{
    id: "lang-1",
    source: "class",
    kind: "language",
    remaining: 1,
    already: ["Dwarven"],
    options: [{ id: "thalassic", name: "Thalassic", traits: ["aquatic"] }],
  }]);
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/create-character")) {
      character = { ...character, name: body.name };
      return jsonResponse({ status: "success", data: character });
    }
    if (url.endsWith("/find-character")) return jsonResponse({ status: "success", data: character });
    if (url.endsWith("/find-ancestry")) {
      return jsonResponse({ status: "success", data: [{ id: body.id === 8 ? 8 : 7, name: body.id === 8 ? "Kholo" : "Human", content_source_id: body.id === 8 ? 900 : 1 }] });
    }
    if (url.endsWith("/find-class")) {
      assert.deepEqual(body.content_sources, [1, 2, 3, 9]);
      return jsonResponse({ status: "success", data: [{ id: 44, name: "Thaumaturge" }] });
    }
    if (url.endsWith("/update-character")) {
      assert.equal(body.expected_updated_at, character.updated_at);
      character = { ...character, ...body, updated_at: "2026-10-22T00:01:00.000Z" };
      return jsonResponse({ status: "success", data: character });
    }
    if (url.endsWith("/delete-content")) {
      assert.deepEqual(body, { id: 102, type: "character" });
      return jsonResponse({ status: "success", data: null });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const created = await client.callTool({ name: "create_character", arguments: { name: "mcp-smoke-test" } });
  assert.match(JSON.stringify(created.structuredContent), /mcp-smoke-test/);

  const row = await client.callTool({ name: "get_character_row", arguments: { id: 102 } });
  assert.match(JSON.stringify(row.structuredContent), /mcp-smoke-test/);

  const identity = await client.callTool({ name: "set_identity", arguments: { characterId: 102, slot: "ancestry", optionId: 7 } });
  assert.equal(identity.isError, undefined);
  assert.equal((character.details as { ancestry?: { name?: string } }).ancestry?.name, "Human");
  const updatesBeforeRejectedIdentity = calls.filter((x) => x.url.endsWith("/update-character")).length;
  const rejectedIdentity = await client.callTool({ name: "set_identity", arguments: { characterId: 102, slot: "ancestry", optionId: 8 } });
  assert.equal(rejectedIdentity.isError, true);
  assert.equal(rejectedIdentity.structuredContent?.code, "NOT_IN_BOOKS");
  assert.equal(calls.filter((x) => x.url.endsWith("/update-character")).length, updatesBeforeRejectedIdentity);
  assert.equal((character.details as { ancestry?: { name?: string } }).ancestry?.name, "Human");

  const open = await client.callTool({ name: "list_open_choices", arguments: { characterId: 102 } });
  assert.match(JSON.stringify(open.structuredContent), /lang-1/);

  const books = await client.callTool({ name: "set_books", arguments: { characterId: 102, add: [9] } });
  assert.match(JSON.stringify(books.structuredContent), /9/);

  const classes = await client.callTool({ name: "list_options", arguments: { kind: "class", characterId: 102, name: "Thaumaturge" } });
  assert.match(JSON.stringify(classes.structuredContent), /Thaumaturge/);

  const illegal = await client.callTool({ name: "choose", arguments: { characterId: 102, choiceId: "lang-1", optionId: "aquan" } });
  assert.equal(illegal.isError, true);

  const legal = await client.callTool({ name: "choose", arguments: { characterId: 102, choiceId: "lang-1", optionId: "thalassic" } });
  assert.equal(legal.isError, undefined);
  assert.equal((character.operation_data as { selections: Record<string, string> }).selections["lang-1"], "thalassic");

  const deleted = await client.callTool({ name: "delete_character", arguments: { characterId: 102 } });
  assert.match(JSON.stringify(deleted.structuredContent), /102/);

  setCharacterFetch(null);
  setCharacterChoiceRunner(null);
  setCharacterWriteApplier(undefined);
});
