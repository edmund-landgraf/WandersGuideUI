import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerCharacterCatalog } from "../src/character-catalog.js";
import { selectionsOf } from "../src/character-choose.js";
import { setCharacterFetch } from "../src/character-client.js";
import { setCharacterChoiceRunner, setCharacterWriteApplier, type OpenChoice } from "../src/character-choices.js";

type Json = Record<string, any>;
type Pick = { choiceId: string; optionId: string };

// Deterministic level-4 custom-operation fixture, not a copy of a production PC.
// The actual rules engine discovers the options and the nested selection.
function option(id: string, operations: Json[] = []) {
  return { id, type: "CUSTOM", title: id, description: "", operations };
}
function select(id: string, options: Json[]) {
  return { id, type: "select", data: { title: id, modeType: "PREDEFINED", optionType: "CUSTOM", optionsPredefined: options } };
}
function character(id: number): Json {
  return {
    id, user_id: "fixture-owner", name: "Level 4 builder fixture", level: 4,
    updated_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z",
    hp_current: 24, hp_temp: 0, details: {}, inventory: { items: [] },
    options: { custom_operations: true }, operation_data: { selections: {} },
    content_sources: { enabled: [] }, meta_data: {},
    custom_operations: [
      select("gate", [option("open", [select("nested", [option("nested-choice")])]), option("closed")]),
      select("independent-a", [option("shared"), option("alternative-a")]),
      select("independent-b", [option("shared"), option("alternative-b")]),
      ...Array.from({ length: 20 }, (_, i) => select("pick-" + i, [option("option-" + i)])),
    ],
  };
}

const gate: Pick = { choiceId: "character_gate", optionId: "open" };
const nested: Pick = { choiceId: "character_gate_open_nested", optionId: "nested-choice" };
const sharedA: Pick = { choiceId: "character_independent-a", optionId: "shared" };
const sharedB: Pick = { choiceId: "character_independent-b", optionId: "shared" };
const pick = (i: number): Pick => ({ choiceId: "character_pick-" + i, optionId: "option-" + i });
const five = [gate, nested, sharedA, sharedB, pick(0)];
const twentyTwo = [...five, ...Array.from({ length: 17 }, (_, i) => pick(i + 1))];

async function body(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function send(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

test("actual builder and HTTP transport: five and 22 picks, parity, CAS and lost response recovery (#50)", { timeout: 120_000 }, async () => {
  const rows = new Map([1, 2, 3, 4, 5, 6, 7].map(id => [id, character(id)]));
  const saves: { id: number; requestId: string; expected: string; selections: Record<string, string> }[] = [];
  const serverErrors: unknown[] = [];
  let catalogRequests = 0;
  let version = 0;
  let failure: "none" | "before" | "after" | "conflict" = "none";
  const http = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const input = await body(req);
      if (path === "/functions/v1/find-character") {
        const row = rows.get(input.id);
        assert.equal(req.headers.authorization, "Bearer fixture-token");
        return send(res, row ? { status: "success", data: row } : { status: "error", message: "Not found" }, row ? 200 : 404);
      }
      if (path === "/functions/v1/update-character") {
        const row = rows.get(input.id)!;
        assert.ok(row);
        assert.equal(req.headers.authorization, "Bearer fixture-token");
        assert.equal(req.headers.apikey, "fixture-anon");
        const requestId = String(req.headers["x-request-id"] ?? "");
        assert.match(requestId, /^[0-9a-f-]{36}$/);
        saves.push({ id: input.id, requestId, expected: input.expected_updated_at, selections: selectionsOf(input) });
        const mode = failure;
        failure = "none";
        if (mode === "before") { req.socket.destroy(); return; }
        if (mode === "conflict") {
          rows.set(row.id, { ...row, name: "Concurrent edit", updated_at: new Date(Date.UTC(2026, 0, 2, 0, 0, ++version)).toISOString() });
          return send(res, { status: "success", data: { __conflict: true } });
        }
        assert.equal(input.expected_updated_at, row.updated_at);
        const { expected_updated_at: _expected, ...patch } = input;
        const next = { ...row, ...patch, updated_at: new Date(Date.UTC(2026, 0, 2, 0, 0, ++version)).toISOString() };
        rows.set(row.id, next);
        if (mode === "after") {
          // Headers and partial body arrive, then the TCP connection dies.
          res.writeHead(200, { "content-type": "application/json", "content-length": 10000 });
          res.write('{"status":"success","data":');
          setTimeout(() => res.destroy(), 20);
          return;
        }
        return send(res, { status: "success", data: next });
      }
      if (/^\/functions\/v1\/find-(?:content-source|ancestry|background|class|ability-block|item|language|spell|trait|creature|archetype|versatile-heritage|class-archetype)$/.test(path)) {
        catalogRequests++;
        return send(res, { status: "success", data: [] });
      }
      throw new Error("Unexpected fixture request " + path);
    })().catch(error => {
      serverErrors.push(error);
      if (!res.headersSent) send(res, { status: "error", message: "fixture failed" }, 500);
      else res.destroy();
    });
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "WG_ACCESS_TOKEN"] as const;
  const previous = envKeys.map(key => process.env[key]);
  process.env.SUPABASE_URL = "http://127.0.0.1:" + (http.address() as AddressInfo).port;
  process.env.SUPABASE_ANON_KEY = "fixture-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-anon";
  process.env.WG_ACCESS_TOKEN = "fixture-token";
  // No injected builder or fetch implementation: exercise liveCharacterChoices,
  // liveCharacterWrite, the original operation engine, and Node's native fetch.
  setCharacterChoiceRunner(null);
  setCharacterWriteApplier(undefined);
  setCharacterFetch(null);
  const server = new McpServer({ name: "builder-http-fixture", version: "1.0.0" });
  registerCharacterCatalog(server, () => "fixture-owner");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "builder-http-test", version: "1.0.0" });
  const call = async (name: string, args: Json) => client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  const list = async (id: number): Promise<OpenChoice[]> => {
    const result = await call("list_open_choices", { characterId: id });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return (result.structuredContent as Json).choices;
  };
  const batch = (id: number, picks: Pick[], atomic = false) => call("choose_many", { characterId: id, picks, atomic });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const initial = await list(1);
    assert.ok(initial.some(choice => choice.id === gate.choiceId && choice.options.some(o => o.id === gate.optionId)));
    assert.ok(!initial.some(choice => choice.id === nested.choiceId));
    assert.ok(catalogRequests > 0, "the actual catalog request path must run");

    for (const [batchId, singleId, picks] of [[1, 2, five], [3, 4, twentyTwo]] as const) {
      const result = await batch(batchId, picks);
      const out = result.structuredContent as Json;
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.equal(out.saved, true);
      assert.equal(out.applied, picks.length, JSON.stringify(out.results));
      assert.equal(out.failed, 0);
      assert.equal(saves.filter(save => save.id === batchId).length, 1);
      const expected = Object.fromEntries(picks.map(p => [p.choiceId, p.optionId]));
      assert.deepEqual(selectionsOf(rows.get(batchId)!), expected);
      assert.deepEqual(out.openChoices, await list(batchId));
      for (const p of picks) {
        const one = await call("choose", { characterId: singleId, ...p });
        assert.notEqual(one.isError, true, JSON.stringify(one));
      }
      assert.deepEqual(selectionsOf(rows.get(singleId)!), expected);
      assert.deepEqual(await list(batchId), await list(singleId));
      assert.equal(saves.filter(save => save.id === singleId).length, picks.length);
    }

    const invalid = { choiceId: pick(1).choiceId, optionId: "invalid" };
    const atomic = await batch(5, [pick(0), invalid], true);
    assert.equal(atomic.isError, true);
    assert.equal((atomic.structuredContent as Json).saved, false);
    assert.equal(saves.filter(save => save.id === 5).length, 0);
    const partial = await batch(5, [pick(0), invalid, pick(2)]);
    const out = partial.structuredContent as Json;
    assert.notEqual(partial.isError, true, JSON.stringify(partial));
    assert.equal(out.applied, 2);
    assert.equal(out.failed, 1);
    assert.deepEqual(selectionsOf(rows.get(5)!), { [pick(0).choiceId]: pick(0).optionId, [pick(2).choiceId]: pick(2).optionId });
    assert.deepEqual(out.openChoices, await list(5));

    for (const mode of ["before", "after"] as const) {
      const id = mode === "before" ? 6 : 7;
      failure = mode;
      const result = await batch(id, five);
      const err = result.structuredContent as Json;
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.equal(err.saveOutcome, "unknown");
      assert.equal(err.requiresReload, true);
      assert.equal(err.retryable, true);
      assert.equal(saves.filter(save => save.id === id).length, 1, "never replay an ambiguous write");
      assert.equal(err.requestId, saves.find(save => save.id === id)?.requestId);
      const open = await list(id);
      assert.equal(open.some(c => c.id === gate.choiceId), mode === "before");
      assert.equal(selectionsOf(rows.get(id)!)[gate.choiceId], mode === "after" ? gate.optionId : undefined);
    }

    failure = "conflict";
    const conflict = await batch(6, [pick(0)]);
    assert.equal(conflict.isError, true);
    assert.equal((conflict.structuredContent as Json).code, "CONFLICT");
    assert.equal(rows.get(6)?.name, "Concurrent edit");
    assert.deepEqual(selectionsOf(rows.get(6)!), {});
    assert.equal(saves.filter(save => save.id === 6).length, 2);
    assert.equal(new Set(saves.map(save => save.requestId)).size, saves.length);
    assert.deepEqual(serverErrors, []);
  } finally {
    await client.close();
    await server.close();
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    envKeys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
