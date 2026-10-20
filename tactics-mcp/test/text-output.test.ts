import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerCatalog } from "../src/catalog.js";
import { getEncounterReader, setEncounterReader, type EncounterReader } from "../src/reader.js";

function textOf(response: { content?: unknown[] }) {
  return String((response.content?.[0] as { text?: string } | undefined)?.text ?? "");
}

test("encounter tools include their structured data in model-readable text", async () => {
  const original = getEncounterReader();
  const record = {
    campaignId: 1,
    encounterId: 172,
    name: "Random Encounter",
    round: 3,
    difficulty: "Severe",
    xp: 120,
    noteName: "Ambush",
    combatants: [{
      id: "lyra-row",
      name: "Lyra",
      side: "ally" as const,
      kind: "character" as const,
      place: "fighting" as const,
      initiative: 18,
      conditions: [],
      hpCurrent: 22,
      hpMax: 30,
      ac: 20,
      fortitude: 8,
      reflex: 10,
      will: 7,
    }],
    roundLog: [{ round: 3, name: "Lyra", side: "ally", initiative: 18, calculation: "rolled 12 + 6" }],
    diceLog: [{ title: "Reflex save", dc: 22, stat: "reflex", result: "success" }],
    diceState: { title: "Reflex save", dc: 22 },
    sheets: {},
  };
  const reader = {
    async loadEncounter() { return record; },
    async exportCharacter(_userId: string, _characterId: number, format = "json") {
      return format === "pdf"
        ? { ok: true as const, data: { format: "pdf" as const, filename: "character-7.pdf", mimeType: "application/pdf" as const, base64: "JVBERi0x" } }
        : { ok: true as const, data: { format: "json" as const, file: { name: "Lyra", level: 5 } } };
    },
  } as unknown as EncounterReader;
  setEncounterReader(reader);
  const server = new McpServer({ name: "text-output-test", version: "1" });
  const client = new Client({ name: "text-output-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  registerCatalog(server, () => "gm");
  try {
    await server.connect(st);
    await client.connect(ct);
    const args = { campaignId: 1, encounterId: 172, view: "gm" };

    let response = await client.callTool({ name: "export_character", arguments: { characterId: 7 } });
    assert.match(textOf(response), /"name": "Lyra"/);

    response = await client.callTool({ name: "get_encounter", arguments: args });
    assert.match(textOf(response), /Round: 3/);
    assert.match(textOf(response), /XP: 120/);

    response = await client.callTool({ name: "list_combatants", arguments: args });
    assert.match(textOf(response), /lyra-row \| Lyra/);

    response = await client.callTool({ name: "get_dice_log", arguments: args });
    assert.match(textOf(response), /Reflex save/);
    assert.match(textOf(response), /DC 22/);

    response = await client.callTool({ name: "get_round_log", arguments: args });
    assert.match(textOf(response), /round 3 \| Lyra/);
  } finally {
    await client.close();
    await server.close();
    setEncounterReader(original);
  }
});
