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

async function connectedClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCatalog(server, () => "user-1");
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("campaign and encounter tools create, merge meta_data, attach, detach, and refuse other owners", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let campaign: Record<string, unknown> = {
    id: 10,
    user_id: "user-1",
    name: "My Campaign",
    description: "A new adventure begins...",
    join_key: "secret-key",
    notes: { pages: [] },
    meta_data: { image_url: "https://example.test/art.png", settings: { players_manage_party: true } },
  };
  const otherCampaign = { ...campaign, id: 99, user_id: "someone-else", join_key: "nope" };
  let encounter: Record<string, unknown> = {
    id: 20,
    user_id: "user-1",
    name: "New Encounter",
    campaign_id: null,
    icon: "combat",
    color: "#359fdf",
    combatants: { list: [] },
    meta_data: { description: "", dice_roll_log: [{ title: "keep" }] },
  };
  const otherEncounter = { ...encounter, id: 21, user_id: "someone-else", name: "Not yours" };

  setCharacterFetch(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/find-campaign")) {
      if (body.user_id === "user-1") return jsonResponse({ status: "success", data: [campaign] });
      if (body.id === campaign.id) return jsonResponse({ status: "success", data: [campaign] });
      if (body.id === otherCampaign.id) return jsonResponse({ status: "success", data: [otherCampaign] });
      return jsonResponse({ status: "success", data: [] });
    }
    if (url.endsWith("/create-campaign")) {
      if (body.id === campaign.id) {
        campaign = { ...campaign, ...body, meta_data: body.meta_data };
        return jsonResponse({ status: "success", data: campaign });
      }
      return jsonResponse({
        status: "success",
        data: {
          id: 11,
          user_id: "user-1",
          join_key: "new-key",
          name: body.name,
          description: body.description,
          notes: body.notes ?? { pages: [] },
          meta_data: body.meta_data,
        },
      });
    }
    if (url.endsWith("/find-encounter")) {
      if (body.id === encounter.id) return jsonResponse({ status: "success", data: encounter });
      if (body.id === otherEncounter.id) return jsonResponse({ status: "success", data: otherEncounter });
      return jsonResponse({ status: "success", data: [] });
    }
    if (url.endsWith("/create-encounter")) {
      encounter = {
        ...encounter,
        ...body,
        id: body.id === -1 ? 20 : body.id,
        user_id: "user-1",
      };
      return jsonResponse({ status: "success", data: encounter });
    }
    return jsonResponse({ status: "error", message: "unexpected" }, 404);
  });

  const { client, server } = await connectedClient();

  const longArt = `https://example.test/${"a".repeat(400)}.png`;
  campaign.meta_data = { ...(campaign.meta_data as object), image_url: longArt };
  const listed = await client.callTool({ name: "list_campaigns", arguments: {} });
  assert.equal(listed.isError, undefined);
  assert.match(JSON.stringify(listed.structuredContent), /My Campaign/);
  assert.equal((listed.structuredContent?.campaigns as { image_url?: string }[])[0].image_url, longArt);
  const listedText = String((listed.content?.[0] as { text?: string } | undefined)?.text ?? "");
  assert.equal(listedText.includes(longArt), false);
  assert.match(listedText, /https:\/\/example\.test\/a+…/);
  assert.equal(JSON.stringify(listed.structuredContent).includes("secret-key"), false);
  campaign.meta_data = { image_url: "https://example.test/art.png", settings: { players_manage_party: true } };

  const got = await client.callTool({ name: "get_campaign", arguments: { campaignId: 10 } });
  assert.equal(got.isError, undefined);
  assert.equal(JSON.stringify(got.structuredContent).includes("secret-key"), false);

  const otherVisible = await client.callTool({ name: "get_campaign", arguments: { campaignId: 99 } });
  assert.equal(otherVisible.isError, undefined);
  assert.equal(otherVisible.structuredContent?.isOwner, false);
  assert.equal(otherVisible.structuredContent?.image_url, "https://example.test/art.png");
  assert.equal(otherVisible.structuredContent?.image_focus_y, null);
  assert.equal(JSON.stringify(otherVisible.structuredContent).includes("nope"), false);

  const missing = await client.callTool({ name: "get_campaign", arguments: { campaignId: 404 } });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent?.code, "NOT_FOUND");

  const createdCampaign = await client.callTool({
    name: "create_campaign",
    arguments: { name: "River Watch", description: "Along the river." },
  });
  assert.equal(createdCampaign.isError, undefined);
  const createCall = calls.find((item) => item.url.endsWith("/create-campaign") && item.body.id == null);
  assert.equal(createCall?.body.name, "River Watch");
  assert.deepEqual((createCall?.body.meta_data as { settings?: unknown }).settings, {
    show_party_member_status: "STATUS",
    players_manage_party: true,
  });

  const updated = await client.callTool({
    name: "update_campaign",
    arguments: { campaignId: 10, name: "River Watch", meta_data: { row_color: "blue" } },
  });
  assert.equal(updated.isError, undefined);
  const updateCall = calls.filter((item) => item.url.endsWith("/create-campaign") && item.body.id === 10).at(-1);
  assert.equal(updateCall?.body.name, "River Watch");
  assert.equal((updateCall?.body.meta_data as { image_url?: string }).image_url, "https://example.test/art.png");
  assert.equal((updateCall?.body.meta_data as { row_color?: string }).row_color, "blue");
  assert.equal(updateCall?.body.join_key, "secret-key");

  const createdStandalone = await client.callTool({ name: "create_encounter", arguments: { name: "Ambush" } });
  assert.equal(createdStandalone.isError, undefined);
  const standaloneCall = calls.find((item) => item.url.endsWith("/create-encounter") && item.body.id === -1 && item.body.campaign_id == null);
  assert.equal(standaloneCall?.body.name, "Ambush");
  assert.equal(standaloneCall?.body.campaign_id, null);
  assert.deepEqual(standaloneCall?.body.combatants, { list: [] });
  assert.equal(standaloneCall?.body.color, "#359fdf");

  const createdUnder = await client.callTool({ name: "create_encounter", arguments: { name: "Camp fight", campaignId: 10 } });
  assert.equal(createdUnder.isError, undefined);
  const underCall = calls.filter((item) => item.url.endsWith("/create-encounter") && item.body.id === -1).at(-1);
  assert.equal(underCall?.body.campaign_id, 10);

  const refusedUnder = await client.callTool({ name: "create_encounter", arguments: { name: "Nope", campaignId: 99 } });
  assert.equal(refusedUnder.isError, true);
  assert.equal(refusedUnder.structuredContent?.code, "CAMPAIGN_FORBIDDEN");

  encounter.meta_data = { description: "", dice_roll_log: [{ title: "keep" }] };
  encounter.campaign_id = null;
  const updatedEncounter = await client.callTool({
    name: "update_encounter",
    arguments: { encounterId: 20, name: "Night Ambush", description: "On the road." },
  });
  assert.equal(updatedEncounter.isError, undefined);
  const encounterUpdate = calls.filter((item) => item.url.endsWith("/create-encounter") && item.body.id === 20).at(-1);
  assert.equal(encounterUpdate?.body.name, "Night Ambush");
  assert.equal((encounterUpdate?.body.meta_data as { description?: string }).description, "On the road.");
  assert.deepEqual((encounterUpdate?.body.meta_data as { dice_roll_log?: unknown }).dice_roll_log, [{ title: "keep" }]);
  assert.equal(encounterUpdate?.body.campaign_id, null);

  const attached = await client.callTool({ name: "set_encounter_campaign", arguments: { encounterId: 20, campaignId: 10 } });
  assert.equal(attached.isError, undefined);
  const attachCall = calls.filter((item) => item.url.endsWith("/create-encounter") && item.body.id === 20).at(-1);
  assert.equal(attachCall?.body.campaign_id, 10);

  const detached = await client.callTool({ name: "set_encounter_campaign", arguments: { encounterId: 20, campaignId: null } });
  assert.equal(detached.isError, undefined);
  const detachCall = calls.filter((item) => item.url.endsWith("/create-encounter") && item.body.id === 20).at(-1);
  assert.equal(detachCall?.body.campaign_id, null);

  const hiddenEncounter = await client.callTool({ name: "update_encounter", arguments: { encounterId: 404, name: "Missing" } });
  assert.equal(hiddenEncounter.isError, true);
  assert.equal(hiddenEncounter.structuredContent?.code, "NOT_FOUND");

  const forbiddenEncounter = await client.callTool({ name: "update_encounter", arguments: { encounterId: 21, name: "Stolen" } });
  assert.equal(forbiddenEncounter.isError, true);
  assert.equal(forbiddenEncounter.structuredContent?.code, "ENCOUNTER_FORBIDDEN");

  const attachOther = await client.callTool({ name: "set_encounter_campaign", arguments: { encounterId: 20, campaignId: 99 } });
  assert.equal(attachOther.isError, true);
  assert.equal(attachOther.structuredContent?.code, "CAMPAIGN_FORBIDDEN");

  setCharacterFetch(null);
  await client.close();
  await server.close();
});
