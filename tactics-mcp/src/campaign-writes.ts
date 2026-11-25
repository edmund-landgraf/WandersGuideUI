import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { fail, textResult, thrown } from "./character-catalog.js";
import { asRow, invokeFunction, type CharacterRow, type InvokeResult } from "./character-client.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const ENCOUNTER_COLOR = "#359fdf";

function sameUser(left: unknown, right: string) {
  return String(left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstRow(data: unknown): CharacterRow | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const row = asRow(item);
      if (row) return row;
    }
    return null;
  }
  return asRow(data);
}

function rowsOf(data: unknown): CharacterRow[] {
  if (Array.isArray(data)) return data.map((item) => asRow(item)).filter((item): item is CharacterRow => item !== null);
  const row = asRow(data);
  return row ? [row] : [];
}

function mergeObject(existing: unknown, patch: unknown) {
  const base = asRecord(existing) ?? {};
  const next = asRecord(patch);
  if (!next) return existing ?? null;
  return { ...base, ...next };
}

function withoutJoinKey(row: CharacterRow) {
  const { join_key: _joinKey, ...rest } = row;
  return rest;
}

function focusStored(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function campaignSummary(row: CharacterRow, userId: string) {
  const meta = asRecord(row.meta_data);
  const image = typeof meta?.image_url === "string" && meta.image_url.trim() ? meta.image_url : null;
  return {
    id: Number(row.id),
    name: typeof row.name === "string" ? row.name : null,
    image_url: image,
    image_focus_y: focusStored(meta?.image_focus_y),
    isOwner: sameUser(row.user_id, userId),
    description: row.description ?? null,
    notes: row.notes ?? null,
    meta_data: row.meta_data ?? null,
    created_at: row.created_at ?? null,
  };
}

const TEXT_STRING_CAP = 120;

function capStrings(value: unknown, max = TEXT_STRING_CAP): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (Array.isArray(value)) return value.map((item) => capStrings(item, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = capStrings(item, max);
    return out;
  }
  return value;
}

function listed(text: string, structuredContent: Record<string, unknown>) {
  const visible = `${text}\n${JSON.stringify(capStrings(structuredContent))}`;
  return {
    content: [{ type: "text" as const, text: visible }],
    structuredContent,
  };
}

function encounterSummary(row: CharacterRow) {
  const combatants = asRecord(row.combatants);
  const list = Array.isArray(combatants?.list) ? combatants.list : [];
  return {
    id: row.id,
    name: row.name ?? null,
    campaign_id: row.campaign_id ?? null,
    icon: row.icon ?? null,
    color: row.color ?? null,
    combatantCount: list.length,
    meta_data: row.meta_data ?? null,
    created_at: row.created_at ?? null,
  };
}

function ownedCampaign(row: CharacterRow | null, userId: string): InvokeResult {
  if (!row) return { ok: false, code: "NOT_FOUND", message: "Campaign not found." };
  if (!sameUser(row.user_id, userId)) {
    return { ok: false, code: "CAMPAIGN_FORBIDDEN", message: "You do not own this campaign." };
  }
  return { ok: true, data: row };
}

function ownedEncounter(row: CharacterRow | null, userId: string): InvokeResult {
  if (!row) return { ok: false, code: "NOT_FOUND", message: "Encounter not found." };
  if (!sameUser(row.user_id, userId)) {
    return { ok: false, code: "ENCOUNTER_FORBIDDEN", message: "You do not own this encounter." };
  }
  return { ok: true, data: row };
}

async function loadCampaign(userId: string, id: number) {
  const found = await invokeFunction(userId, "find-campaign", { id });
  if (!found.ok) return found;
  return ownedCampaign(firstRow(found.data), userId);
}

async function loadEncounter(userId: string, id: number) {
  const found = await invokeFunction(userId, "find-encounter", { id });
  if (!found.ok) return found;
  return ownedEncounter(firstRow(found.data), userId);
}

async function saveCampaign(userId: string, row: CharacterRow) {
  const saved = await invokeFunction(userId, "create-campaign", row);
  if (!saved.ok) return saved;
  const next = firstRow(saved.data) ?? row;
  const owned = ownedCampaign(next, userId);
  if (!owned.ok) return owned;
  return { ok: true as const, data: next };
}

async function saveEncounter(userId: string, row: CharacterRow, patch: Record<string, unknown>) {
  const revision = asRecord(row.meta_data)?.encounter_revision ?? 0;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid encounter revision. Reload before saving.');
  const saved = await invokeFunction(userId, "wgui-ext-save-encounter", { encounter_id:row.id, encounter_revision:revision, patch });
  if (!saved.ok) return saved;
  const next = firstRow(saved.data);
  if (!next || next.id !== row.id || asRecord(next.meta_data)?.encounter_revision !== revision + 1) throw new Error("Encounter save could not be confirmed. Reload before retrying.");
  const owned = ownedEncounter(next, userId);
  if (!owned.ok) return owned;
  return { ok: true as const, data: next };
}

export function registerCampaignWrites(server: McpServer, userId: () => string) {
  server.registerTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description: "Campaigns this account owns, via find-campaign({ user_id }). Join keys are omitted.",
      annotations: readOnly,
    },
    async () => {
      try {
        const found = await invokeFunction(userId(), "find-campaign", { user_id: userId() });
        if (!found.ok) return fail(found);
        const campaigns = rowsOf(found.data).filter((row) => sameUser(row.user_id, userId())).map((row) => campaignSummary(withoutJoinKey(row), userId()));
        const lines = campaigns.map((row) => `${row.id}\t${row.name ?? ""}`);
        return listed(lines.length ? `Campaigns.\n${lines.join("\n")}` : "No campaigns.", { campaigns });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "get_campaign",
    {
      title: "Get campaign",
      description: "One campaign this account owns, via find-campaign({ id }). Same art fields as the campaign art tool (image_url, image_focus_y, isOwner) plus description, notes, and meta_data. A blank image_url is null. A missing image_focus_y is null (the sheet displays that as 30). Join keys are omitted. A missing campaign is NOT_FOUND. A campaign owned by someone else is CAMPAIGN_FORBIDDEN, including when find-campaign still returns the row. PR #20's get_campaign did not grant access to campaign members; this tool stays owner-only.",
      annotations: readOnly,
      inputSchema: { campaignId: z.number().int() },
    },
    async (args) => {
      try {
        const loaded = await loadCampaign(userId(), Number(args.campaignId));
        if (!loaded.ok) return fail(loaded);
        const campaign = campaignSummary(withoutJoinKey(loaded.data as CharacterRow), userId());
        return textResult(campaign.name ?? "Campaign", campaign);
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "get_campaign_notes",
    {
      title: "Campaign notes",
      description: "Reads campaign note pages through wgui-ext-find-campaign-notes. The GM receives every page. A member receives pages marked shared. Each page includes its index and name. Use the index and name with patch_campaign_notes. This does not return the rest of the campaign row.",
      annotations: readOnly,
      inputSchema: { campaignId: z.number().int() },
    },
    async (args) => {
      try {
        const found = await invokeFunction(userId(), "wgui-ext-find-campaign-notes", { campaign_id: Number(args.campaignId) });
        if (!found.ok) return fail(found);
        const data = asRecord(found.data) ?? {};
        const pages = Array.isArray(data.pages) ? data.pages : [];
        return textResult(pages.length ? `${pages.length} note pages` : "No notes", { campaignId: Number(args.campaignId), pages });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "patch_campaign_notes",
    {
      title: "Update one campaign note",
      description: "Updates one campaign note page through wgui-ext-patch-campaign-notes. Send pageIndex and the current page name from get_campaign_notes, plus contents and any metadata you are changing. Other pages and other notes fields stay as stored. A player may change contents only on a page that is already shared. This does not send the rest of the notes.",
      annotations: writes,
      inputSchema: {
        campaignId: z.number().int(),
        pageIndex: z.number().int().nonnegative(),
        pageName: z.string(),
        contents: z.unknown().optional(),
        name: z.string().optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
        shared: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const patch: Record<string, unknown> = {};
        if (args.contents !== undefined) patch.contents = args.contents;
        if (typeof args.name === "string") patch.name = args.name;
        if (typeof args.icon === "string") patch.icon = args.icon;
        if (typeof args.color === "string") patch.color = args.color;
        if (typeof args.shared === "boolean") patch.shared = args.shared;
        if (!Object.keys(patch).length) return textResult("Send contents or page metadata to update.", { code: "VALIDATION_ERROR", retryable: false }, true);
        const saved = await invokeFunction(userId(), "wgui-ext-patch-campaign-notes", {
          campaign_id: Number(args.campaignId),
          page_index: Number(args.pageIndex),
          expected_page_name: args.pageName,
          patch,
        });
        if (!saved.ok) return fail(saved);
        return textResult("Campaign note updated.", asRecord(saved.data) ?? { campaignId: Number(args.campaignId) });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "add_campaign_note",
    {
      title: "Add a campaign note",
      description: "Appends one campaign note page through wgui-ext-patch-campaign-notes. Existing pages and other notes fields stay as stored. Only the GM can add a page. contents is the page body. shared marks the page visible to players.",
      annotations: writes,
      inputSchema: {
        campaignId: z.number().int(),
        name: z.string(),
        contents: z.unknown(),
        icon: z.string().optional(),
        color: z.string().optional(),
        shared: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const saved = await invokeFunction(userId(), "wgui-ext-patch-campaign-notes", {
          campaign_id: Number(args.campaignId),
          create: {
            name: args.name,
            contents: args.contents,
            ...(typeof args.icon === "string" ? { icon: args.icon } : {}),
            ...(typeof args.color === "string" ? { color: args.color } : {}),
            ...(typeof args.shared === "boolean" ? { shared: args.shared } : {}),
          },
        });
        if (!saved.ok) return fail(saved);
        return textResult("Campaign note added.", asRecord(saved.data) ?? { campaignId: Number(args.campaignId) });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "create_campaign",
    {
      title: "Create campaign",
      description: "Creates a campaign with stock create-campaign. The caller is the owner. Same defaults as the Phase 1 campaign page. Call ensure_public_user first if create-campaign says the user was not found.",
      annotations: writes,
      inputSchema: {
        name: z.string().optional(),
        description: z.string().optional(),
        notes: z.unknown().optional(),
        meta_data: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        const created = await invokeFunction(userId(), "create-campaign", {
          name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : "My Campaign",
          description: typeof args.description === "string" ? args.description : "A new adventure begins...",
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
          meta_data: mergeObject({
            settings: {
              show_party_member_status: "STATUS",
              players_manage_party: true,
            },
          }, args.meta_data),
        });
        if (!created.ok) return fail(created);
        const row = firstRow(created.data);
        if (!row) return textResult("create-campaign did not return a campaign.", { code: "INTERNAL_ERROR", retryable: false }, true);
        return textResult(String(row.name ?? "Campaign"), { campaign: campaignSummary(withoutJoinKey(row), userId()) });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "update_campaign",
    {
      title: "Update campaign",
      description: "Updates name, description, notes, and/or meta_data on a campaign this account owns. meta_data is merged so keys such as image_url from set_campaign_art are kept unless you send a replacement. Posts the existing row to create-campaign (there is no update-campaign). Does not change the join key. To change one note page, use patch_campaign_notes or add_campaign_note. Sending notes here replaces the notes object and is limited by the request size.",
      annotations: writes,
      inputSchema: {
        campaignId: z.number().int(),
        name: z.string().optional(),
        description: z.string().optional(),
        notes: z.unknown().optional(),
        meta_data: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        const loaded = await loadCampaign(userId(), Number(args.campaignId));
        if (!loaded.ok) return fail(loaded);
        const current = loaded.data as CharacterRow;
        const next: CharacterRow = { ...current };
        if (typeof args.name === "string") next.name = args.name;
        if (typeof args.description === "string") next.description = args.description;
        if (args.notes !== undefined) next.notes = mergeObject(current.notes, args.notes) ?? args.notes;
        if (args.meta_data !== undefined) next.meta_data = mergeObject(current.meta_data, args.meta_data);
        const saved = await saveCampaign(userId(), next);
        if (!saved.ok) return fail(saved);
        return textResult("Campaign updated.", { campaign: campaignSummary(withoutJoinKey(saved.data), userId()) });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "create_encounter",
    {
      title: "Create encounter",
      description: "Creates an encounter with stock create-encounter. Omit campaignId for a standalone encounter owned by the caller (campaign_id null, same as the Phase 1 encounters page). Pass campaignId to file it under a campaign this account owns.",
      annotations: writes,
      inputSchema: {
        name: z.string().optional(),
        description: z.string().optional(),
        campaignId: z.number().int().optional(),
        meta_data: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        let campaignId: number | null = null;
        if (args.campaignId !== undefined) {
          const campaign = await loadCampaign(userId(), Number(args.campaignId));
          if (!campaign.ok) return fail(campaign);
          campaignId = Number(args.campaignId);
        }
        const created = await invokeFunction(userId(), "create-encounter", {
          id: -1,
          created_at: "",
          user_id: "",
          name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : "New Encounter",
          icon: "combat",
          color: ENCOUNTER_COLOR,
          campaign_id: campaignId,
          combatants: { list: [] },
          meta_data: mergeObject({ description: typeof args.description === "string" ? args.description : "" }, args.meta_data),
        });
        if (!created.ok) return fail(created);
        const row = firstRow(created.data);
        if (!row) return textResult("create-encounter did not return an encounter.", { code: "INTERNAL_ERROR", retryable: false }, true);
        return textResult(String(row.name ?? "Encounter"), { encounter: encounterSummary(row) });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "update_encounter",
    {
      title: "Update encounter",
      description: "Updates name, description, and/or meta_data on an encounter this account owns. Description is stored on meta_data.description. The encounter table has no notes column, so there is no notes argument. meta_data is merged so dice logs and other keys stay unless you send a replacement. Saves only changed fields with an encounter revision check. Does not change campaign_id; use set_encounter_campaign to attach or detach. An encounter the caller cannot see is NOT_FOUND because find-encounter hides it.",
      annotations: writes,
      inputSchema: {
        encounterId: z.number().int(),
        name: z.string().optional(),
        description: z.string().optional(),
        meta_data: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        const loaded = await loadEncounter(userId(), Number(args.encounterId));
        if (!loaded.ok) return fail(loaded);
        const current = loaded.data as CharacterRow;
        const patch: Record<string, unknown> = {};
        if (typeof args.name === "string") patch.name = args.name;
        const metaPatch = { ...(asRecord(args.meta_data) ?? {}) };
        delete metaPatch.encounter_revision;
        if (typeof args.description === "string") metaPatch.description = args.description;
        if (Object.keys(metaPatch).length) patch.meta_data = mergeObject(current.meta_data, metaPatch);
        if (!Object.keys(patch).length) return textResult("No encounter changes.", { encounter: encounterSummary(current) });
        const saved = await saveEncounter(userId(), current,patch);
        if (!saved.ok) return fail(saved);
        return textResult("Encounter updated.", { encounter: encounterSummary(saved.data) });
      } catch (error) {
        return thrown(error);
      }
    },
  );

  server.registerTool(
    "set_encounter_campaign",
    {
      title: "Move encounter",
      description: "Attach a standalone encounter this account owns to a campaign this account owns, or detach it (campaignId null) so it is standalone again. Saves only campaign_id with an encounter revision check.",
      annotations: writes,
      inputSchema: {
        encounterId: z.number().int(),
        campaignId: z.number().int().nullable(),
      },
    },
    async (args) => {
      try {
        const loaded = await loadEncounter(userId(), Number(args.encounterId));
        if (!loaded.ok) return fail(loaded);
        const current = loaded.data as CharacterRow;
        let campaignId: number | null = null;
        if (args.campaignId != null) {
          const campaign = await loadCampaign(userId(), Number(args.campaignId));
          if (!campaign.ok) return fail(campaign);
          campaignId = Number(args.campaignId);
        }
        const saved = await saveEncounter(userId(),current,{campaign_id:campaignId});
        if (!saved.ok) return fail(saved);
        return textResult(campaignId == null ? "Encounter detached." : "Encounter attached.", { encounter: encounterSummary(saved.data) });
      } catch (error) {
        return thrown(error);
      }
    },
  );
}
