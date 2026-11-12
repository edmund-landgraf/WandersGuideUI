import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { setCharacterChoiceRunner, setCharacterWriteApplier, type OpenChoice } from "../src/character-choices.js";
import { planPicks } from "../src/character-choose.js";
import { setCharacterFetch } from "../src/character-client.js";
import { registerCatalog } from "../src/catalog.js";

process.env.WG_ACCESS_TOKEN = "test-token";
process.env.SUPABASE_URL = "http://127.0.0.1:8000";
process.env.SUPABASE_ANON_KEY = "anon";

type Json = Record<string, unknown>;
type Selections = Record<string, string>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function option(id: string) {
  return { id, name: id, traits: [] };
}

function choice(id: string, options: string[]): OpenChoice {
  return { id, source: id.split("_")[0], kind: "select", remaining: 1, already: [], options: options.map(option) };
}

/**
 * A small fake builder whose open choices depend on earlier selections, like the real one:
 * - a feat pick can open a nested sub-choice keyed under it
 * - the second language cannot repeat the first
 * An answered choice is not open.
 */
function fakeChoices(selections: Selections): OpenChoice[] {
  const all: OpenChoice[] = [
    choice("class_skill-1", ["acrobatics", "athletics", "nature"]),
    choice("class_skill-2", ["acrobatics", "athletics", "nature"].filter((id) => id !== selections["class_skill-1"])),
    choice("class_feat-1", ["monster-hunter", "twin-takedown"]),
    choice("ancestry_lang-1", ["elven", "dwarven", "sylvan"]),
    choice("ancestry_lang-2", ["elven", "dwarven", "sylvan"].filter((id) => id !== selections["ancestry_lang-1"])),
  ];
  if (selections["class_feat-1"] === "twin-takedown") all.push(choice("class_feat-1_twin-takedown_style", ["melee", "ranged"]));
  return all.filter((item) => !Object.prototype.hasOwnProperty.call(selections, item.id));
}

function selectionsOf(character: Json): Selections {
  return { ...(((character.operation_data as Json | undefined)?.selections as Selections | undefined) ?? {}) };
}

type Harness = {
  client: Client;
  calls: string[];
  builderRuns: () => number;
  rows: Map<number, Json>;
  close: () => Promise<void>;
};

async function harness(rows: Json[]): Promise<Harness> {
  const store = new Map(rows.map((row) => [row.id as number, structuredClone(row)]));
  const calls: string[] = [];
  let runs = 0;
  setCharacterWriteApplier(null);
  setCharacterChoiceRunner(async (character) => {
    runs += 1;
    return fakeChoices(selectionsOf(character));
  });
  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Json;
    const name = url.split("/").pop() ?? url;
    calls.push(name);
    const row = store.get(body.id as number);
    if (name === "find-character") return row ? jsonResponse({ status: "success", data: row }) : jsonResponse({ status: "error", message: "nope" }, 404);
    if (name === "update-character" && row) {
      assert.equal(body.expected_updated_at, row.updated_at);
      const next = { ...row, ...body, updated_at: `${row.updated_at}+` };
      delete (next as Json).expected_updated_at;
      store.set(row.id as number, next);
      return jsonResponse({ status: "success", data: next });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    calls,
    builderRuns: () => runs,
    rows: store,
    close: async () => {
      await client.close();
      setCharacterFetch(null);
      setCharacterChoiceRunner(null);
      setCharacterWriteApplier(undefined);
    },
  };
}

function ranger(id: number, selections: Selections = {}): Json {
  return {
    id,
    user_id: "user-1",
    name: "Aragorn",
    level: 5,
    updated_at: "2026-11-02T00:58:00.000Z",
    content_sources: { enabled: [1] },
    details: {},
    operation_data: { selections },
  };
}

function count(calls: string[], name: string) {
  return calls.filter((call) => call === name).length;
}

test("choose_many applies several picks, including a dependent one, with one read and one write", async () => {
  const h = await harness([ranger(1)]);
  try {
    const result = await h.client.callTool({
      name: "choose_many",
      arguments: {
        characterId: 1,
        picks: [
          { choiceId: "class_skill-1", optionId: "nature" },
          { choiceId: "class_feat-1", optionId: "twin-takedown" },
          // Only open after the previous pick in this same batch.
          { choiceId: "class_feat-1_twin-takedown_style", optionId: "ranged" },
          { choiceId: "ancestry_lang-1", optionId: "elven" },
          { choiceId: "ancestry_lang-2", optionId: "sylvan" },
        ],
      },
    });
    assert.equal(result.isError, undefined);
    const out = result.structuredContent as Json;
    assert.equal(out.applied, 5);
    assert.equal(out.failed, 0);
    assert.equal(out.saved, true);
    assert.deepEqual((out.results as Json[]).map((r) => r.status), ["applied", "applied", "applied", "applied", "applied"]);
    assert.deepEqual(selectionsOf(h.rows.get(1)!), {
      "class_skill-1": "nature",
      "class_feat-1": "twin-takedown",
      "class_feat-1_twin-takedown_style": "ranged",
      "ancestry_lang-1": "elven",
      "ancestry_lang-2": "sylvan",
    });
    // Remaining open choices come back so the model does not need list_open_choices.
    assert.deepEqual((out.openChoices as OpenChoice[]).map((c) => c.id), ["class_skill-2"]);
    assert.deepEqual((out.openChoices as OpenChoice[])[0].options.map((o) => o.id), ["acrobatics", "athletics"]);
    assert.equal((out.character as Json).id, 1);
    // The whole batch costs one find-character and one update-character.
    assert.deepEqual(h.calls, ["find-character", "update-character"]);
  } finally {
    await h.close();
  }
});

test("choose_many saves the legal picks and reports the bad ones without touching their keys", async () => {
  const h = await harness([ranger(2, { "class_skill-1": "athletics" })]);
  try {
    const result = await h.client.callTool({
      name: "choose_many",
      arguments: {
        characterId: 2,
        picks: [
          { choiceId: "ancestry_lang-1", optionId: "dwarven" },
          { choiceId: "ancestry_lang-2", optionId: "dwarven" }, // illegal: repeats lang-1
          { choiceId: "class_feat-9", optionId: "x" }, // not an open choice
          { choiceId: "class_skill-2", optionId: "nature" },
        ],
      },
    });
    assert.equal(result.isError, undefined);
    const out = result.structuredContent as Json;
    const results = out.results as Json[];
    assert.equal(out.applied, 2);
    assert.equal(out.failed, 2);
    assert.deepEqual(results.map((r) => [r.index, r.status, r.code ?? null]), [
      [0, "applied", null],
      [1, "error", "VALIDATION_ERROR"],
      [2, "error", "NOT_FOUND"],
      [3, "applied", null],
    ]);
    assert.equal(results[1].message, "That option is not legal for this choice.");
    assert.equal(results[2].message, "That choice is not open.");
    assert.deepEqual(selectionsOf(h.rows.get(2)!), {
      "class_skill-1": "athletics",
      "ancestry_lang-1": "dwarven",
      "class_skill-2": "nature",
    });
    assert.equal(count(h.calls, "update-character"), 1);
  } finally {
    await h.close();
  }
});

test("choose_many atomic saves nothing when any pick fails", async () => {
  const h = await harness([ranger(3)]);
  try {
    const result = await h.client.callTool({
      name: "choose_many",
      arguments: {
        characterId: 3,
        atomic: true,
        picks: [
          { choiceId: "class_skill-1", optionId: "nature" },
          { choiceId: "class_skill-2", optionId: "nature" },
        ],
      },
    });
    assert.equal(result.isError, true);
    const out = result.structuredContent as Json;
    assert.equal(out.saved, false);
    assert.equal(out.applied, 0);
    assert.deepEqual((out.results as Json[]).map((r) => r.status), ["not_saved", "error"]);
    assert.equal(count(h.calls, "update-character"), 0);
    assert.deepEqual(selectionsOf(h.rows.get(3)!), {});
  } finally {
    await h.close();
  }
});

test("choose_many with no legal pick, or an empty list, writes nothing", async () => {
  const h = await harness([ranger(4)]);
  try {
    const empty = await h.client.callTool({ name: "choose_many", arguments: { characterId: 4, picks: [] } });
    assert.equal(empty.isError, true);
    assert.equal((empty.structuredContent as Json).code, "VALIDATION_ERROR");
    assert.deepEqual(h.calls, [], "an empty list is rejected before any backend call");

    const bad = await h.client.callTool({
      name: "choose_many",
      arguments: { characterId: 4, picks: [{ choiceId: "class_skill-1", optionId: "arcana" }] },
    });
    assert.equal(bad.isError, true);
    assert.equal((bad.structuredContent as Json).saved, false);
    assert.deepEqual(h.calls, ["find-character"]);
  } finally {
    await h.close();
  }
});

test("choose_many refuses another user's character before running the builder", async () => {
  const h = await harness([{ ...ranger(5), user_id: "someone-else" }]);
  try {
    const result = await h.client.callTool({
      name: "choose_many",
      arguments: { characterId: 5, picks: [{ choiceId: "class_skill-1", optionId: "nature" }] },
    });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as Json).code, "CHARACTER_FORBIDDEN");
    assert.equal(h.builderRuns(), 0);
    assert.equal(count(h.calls, "update-character"), 0);
  } finally {
    await h.close();
  }
});

test("choose_many ends in the same state as the same picks sent one by one through choose", async () => {
  // Starts with an answered feat and a nested answer, so the batch also covers changing a
  // parent choice (stale nested keys must be dropped) and a repeated choiceId (last wins).
  const start = {
    "class_feat-1": "twin-takedown",
    "class_feat-1_twin-takedown_style": "melee",
    "ancestry_lang-1": "elven",
  };
  const picks = [
    { choiceId: "class_feat-1", optionId: "monster-hunter" },
    { choiceId: "class_feat-1_twin-takedown_style", optionId: "ranged" }, // closed by the change above
    { choiceId: "class_skill-1", optionId: "acrobatics" },
    { choiceId: "class_skill-2", optionId: "acrobatics" }, // illegal: repeats skill-1
    { choiceId: "class_skill-2", optionId: "athletics" },
    { choiceId: "ancestry_lang-1", optionId: "sylvan" }, // re-answer
    { choiceId: "ancestry_lang-2", optionId: "elven" }, // legal only because lang-1 moved off elven
    { choiceId: "class_skill-1", optionId: "nature" }, // duplicate: last answer wins
  ];
  const h = await harness([ranger(10, start), ranger(11, start)]);
  try {
    const sequential: boolean[] = [];
    for (const pick of picks) {
      const one = await h.client.callTool({ name: "choose", arguments: { characterId: 10, ...pick } });
      sequential.push(one.isError !== true);
    }
    const sequentialCalls = [...h.calls];
    h.calls.length = 0;

    const batch = await h.client.callTool({ name: "choose_many", arguments: { characterId: 11, picks } });
    const results = (batch.structuredContent as Json).results as Json[];
    assert.deepEqual(results.map((r) => r.status === "applied"), sequential);
    assert.deepEqual(selectionsOf(h.rows.get(11)!), selectionsOf(h.rows.get(10)!));
    assert.deepEqual(selectionsOf(h.rows.get(11)!), {
      "class_feat-1": "monster-hunter",
      "class_skill-2": "athletics",
      "ancestry_lang-1": "sylvan",
      "ancestry_lang-2": "elven",
      "class_skill-1": "nature",
    });
    // 8 choose calls: 8 reads and 6 writes. One choose_many: 1 read and 1 write.
    assert.equal(count(sequentialCalls, "find-character"), 8);
    assert.equal(count(sequentialCalls, "update-character"), 6);
    assert.deepEqual(h.calls, ["find-character", "update-character"]);
  } finally {
    await h.close();
  }
});

test("planPicks leaves selections untouched by a failed pick and reports what a pick replaced", async () => {
  const character = ranger(20, { "ancestry_lang-1": "elven" });
  const list = async (c: Json) => fakeChoices(selectionsOf(c));
  const planned = await planPicks(character, [
    { choiceId: "ancestry_lang-1", optionId: "dwarven" },
    { choiceId: "ancestry_lang-2", optionId: "dwarven" },
  ], list);
  assert.deepEqual(planned.selections, { "ancestry_lang-1": "dwarven" });
  assert.deepEqual(planned.results[0], { index: 0, choiceId: "ancestry_lang-1", optionId: "dwarven", status: "applied", replaced: "elven" });
  assert.equal(planned.results[1].status, "error");
  // The input character is never mutated.
  assert.deepEqual(selectionsOf(character), { "ancestry_lang-1": "elven" });

  const broken = await planPicks(character, [{ choiceId: "ancestry_lang-2", optionId: "sylvan" }], async () => {
    throw new Error("builder exploded");
  });
  assert.deepEqual(broken.results[0], { index: 0, choiceId: "ancestry_lang-2", optionId: "sylvan", status: "error", code: "INTERNAL_ERROR", message: "builder exploded", retryable: true });
  assert.deepEqual(broken.selections, { "ancestry_lang-1": "elven" });
});
