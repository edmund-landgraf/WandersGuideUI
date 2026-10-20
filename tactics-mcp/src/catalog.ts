import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getEncounterReader, type CharacterExport, type CombatantSheet, type EncounterRecord } from "./reader.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const gm = { view: z.literal("gm").describe("Required. Only gm is accepted.") };

type ToolConfig = {
  title: string;
  description: string;
  inputSchema?: Record<string, z.ZodType>;
};

function textResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
  const visibleText = structuredContent ? `${text}\n${JSON.stringify(structuredContent)}` : text;
  return {
    isError: isError || undefined,
    content: [{ type: "text" as const, text: visibleText }],
    structuredContent,
  };
}

function notFound(message: string) {
  return textResult(message, { code: "NOT_FOUND", retryable: false }, true);
}

export function registerEncounterTool(
  server: McpServer,
  name: string,
  config: ToolConfig,
  handler: (args: Record<string, unknown>, userId: string) => Promise<ReturnType<typeof textResult>>,
  userId: () => string,
) {
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      annotations: readOnly,
      inputSchema: { ...gm, ...(config.inputSchema ?? {}) },
    },
    async (args) => {
      // view is required as the literal gm. Checked here as well as on the schema so a value the SDK forwards still never reaches a loader.
      if ((args as { view?: string }).view !== "gm") {
        return textResult("view must be gm.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      return handler(args as Record<string, unknown>, userId());
    },
  );
}

async function encounter(userId: string, campaignId: number, encounterId: number, combatantId?: string, includeStats = false) {
  return getEncounterReader().loadEncounter(userId, campaignId, encounterId, combatantId, includeStats);
}

function sheetOf(record: EncounterRecord, combatantId: string) {
  const row = record.combatants.find((item) => item.id === combatantId);
  if (!row) return null;
  return { row, sheet: record.sheets[combatantId] ?? emptySheet() };
}

function emptySheet(): CombatantSheet {
  return { groups: [], feats: [], classFeatures: [], skills: [], spells: [] };
}

const ids = {
  campaignId: z.number().int(),
  encounterId: z.number().int(),
};

export function registerCatalog(server: McpServer, userId: () => string) {
  server.registerTool(
    "get_profile",
    {
      title: "Connected account",
      description: "Returns the Supabase user id for this token. No view argument.",
      annotations: readOnly,
    },
    async () => {
      const profile = await getEncounterReader().profile(userId());
      return textResult(profile.id, { ...profile });
    },
  );

  server.registerTool(
    "ensure_public_user",
    {
      title: "Ensure account profile",
      description: "Create the caller's public_user row when sign-in succeeded but campaign or character creation says the user was not found. Idempotent: an existing profile is returned unchanged. Call this before create-campaign or create-character only after that missing-profile error. It does not create a campaign or a character.",
      annotations: writes,
    },
    async () => {
      const result = await getEncounterReader().ensurePublicUser(userId());
      if (!result.ok) return textResult(result.message, { code: result.code, retryable: false }, true);
      return textResult(result.data.created ? "Profile created." : "Profile already exists.", result.data);
    },
  );

  server.registerTool(
    "join_campaign",
    {
      title: "Join a campaign",
      description: "Attach one character the caller owns to a campaign using the GM's join key. Use the character's numeric id, not an encounter combatant id. The key is checked and then discarded; never repeat the key in your reply. If the character is already in that campaign, the call reports already=true and does not write again. A wrong key or a character owned by someone else fails without revealing which campaigns exist.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int().describe("Numeric id of a character this account owns."),
        joinKey: z.string().describe("Campaign join key from the GM. Do not echo it back."),
      },
    },
    async (args) => {
      const result = await getEncounterReader().joinCampaign(userId(), Number(args.characterId), String(args.joinKey));
      if (!result.ok) return textResult(result.message, { code: result.code, retryable: false }, true);
      return textResult(result.data.already ? "Already in the campaign." : "Joined the campaign.", result.data);
    },
  );

  server.registerTool(
    "get_campaign_owner_contacts",
    {
      title: "Campaign owner contacts",
      description: "Email and display name for campaign owners the caller already shares a campaign with, including the caller. Pass at most 24 user ids from campaign rows you already loaded. Ids the caller does not play with are omitted, not reported as errors, so an empty list does not mean the id is invalid. Do not use this to look up arbitrary accounts.",
      annotations: readOnly,
      inputSchema: {
        userIds: z.array(z.string()).max(24).describe("Owner user ids from campaigns the caller already belongs to."),
      },
    },
    async (args) => {
      const result = await getEncounterReader().campaignOwnerContacts(userId(), args.userIds as string[]);
      if (!result.ok) return textResult(result.message, { code: result.code, retryable: false }, true);
      return textResult(result.data.length ? "Owner contacts." : "No shared owners.", { contacts: result.data });
    },
  );

  server.registerTool(
    "patch_encounter_dice",
    {
      title: "Update encounter dice",
      description: "Write only the encounter dice tray (diceRollState) and dice log (diceRollLog). Read get_dice_log first. A GM replacement overwrites whichever field you send, so include every log row you intend to keep. A player may add, edit, or drop only log rows they started, and may change the tray title, DC, stat, and results; side and challenge stay as the GM set them. This does not change initiative, HP, conditions, or the roster. Send at least one of the two fields.",
      annotations: writes,
      inputSchema: {
        ...ids,
        diceRollState: z.record(z.string(), z.unknown()).nullable().optional().describe("Full tray for a GM. Players may set title, dc, stat, and results."),
        diceRollLog: z.array(z.record(z.string(), z.unknown())).optional().describe("Full log for a GM. Players send only their own rows plus the ones they are keeping."),
      },
    },
    async (args) => {
      const result = await getEncounterReader().patchEncounterDice(userId(), Number(args.campaignId), Number(args.encounterId), {
        diceRollState: args.diceRollState as Record<string, unknown> | null | undefined,
        diceRollLog: args.diceRollLog as unknown[] | undefined,
      });
      if (!result.ok) return textResult(result.message, { code: result.code, retryable: false }, true);
      return textResult("Dice updated.", result.data);
    },
  );

  server.registerTool(
    "list_campaign_characters",
    {
      title: "Campaign roster",
      description: "Every PC in a campaign the caller belongs to, the same roster as wgui-ext-find-campaign-characters. Use this for the party list, not list_pcs, which is only the characters placed in one encounter. Returns id, name, level, ancestry, and class. For the compiled character file, call export_character.",
      annotations: readOnly,
      inputSchema: { campaignId: z.number().int() },
    },
    async (args) => {
      const result = await getEncounterReader().listCampaignCharacters(userId(), Number(args.campaignId));
      if (!result.ok) return textResult(result.message, { code: result.code, retryable: false }, true);
      const characters = result.data;
      const lines = characters.map((row) => `${row.id}\t${row.name}\tlevel ${row.level ?? "?"}\t${row.ancestry ?? ""}\t${row.className ?? ""}`.trimEnd());
      return textResult(lines.length ? `Campaign roster.\n${lines.join("\n")}` : "No characters in this campaign.", { characters });
    },
  );

  server.registerTool(
    "export_character",
    {
      title: "Export character file",
      description: "Export a character as JSON or PDF through wgui-export-character. Use the character's numeric id from list_campaign_characters. The caller must own the character, or be the campaign GM. Do not use it for encounter creatures.",
      annotations: readOnly,
      inputSchema: {
        characterId: z.number().int().describe("Numeric character id, not an encounter combatant id."),
        format: z.enum(["json", "pdf"]).default("json").describe("Export format. Defaults to JSON."),
      },
    },
    async (args) => {
      const format = args.format === "pdf" ? "pdf" : "json";
      const result = await getEncounterReader().exportCharacter(userId(), Number(args.characterId), format);
      if (!result.ok) return textResult(result.message, { code: result.code, retryable: false }, true);
      const data = result.data as CharacterExport;
      if (data.format === "pdf") {
        return textResult(`Character PDF.\nFilename: ${data.filename}\nMIME type: ${data.mimeType}\nBase64 payload follows.\n${data.base64}`, {
          format: data.format,
          filename: data.filename,
          mimeType: data.mimeType,
          base64: data.base64,
        });
      }
      return textResult(`Character file.\n${JSON.stringify(data.file, null, 2)}`, { format: data.format, file: data.file });
    },
  );

  registerEncounterTool(server, "list_encounters", {
    title: "Encounter list",
    description: "Campaign fights from the same membership check as wgui-ext-find-encounter. Returns encounter id, name, and combatant count. Pass one of those ids to get_encounter.",
    inputSchema: { campaignId: z.number().int() },
  }, async (args, uid) => {
    const encounters = await getEncounterReader().listEncounters(uid, Number(args.campaignId));
    const lines = encounters.map((row) => `${row.id}\t${row.name}\t${row.combatantCount} combatants`);
    return textResult(lines.length ? `Encounters.\n${lines.join("\n")}` : "No encounters.", { encounters });
  }, userId);

  registerEncounterTool(server, "get_encounter", {
    title: "Encounter header",
    description: "Name, round, difficulty, and XP for one encounter.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    return textResult(formatEncounter(record), {
      name: record.name,
      round: record.round,
      difficulty: record.difficulty ?? null,
      xp: record.xp ?? null,
      noteName: record.noteName ?? null,
    });
  }, userId);

  registerEncounterTool(server, "list_pcs", {
    title: "Party",
    description: "Every PC fighting, on the bench, or down, with current HP.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    const pcs = record.combatants.filter((row) => row.kind === "character").map(summary);
    return textResult(pcs.length ? "PCs." : "No PCs.", { pcs });
  }, userId);

  registerEncounterTool(server, "list_combatants", {
    title: "Combat table",
    description: "Initiative, defenses, conditions, and current HP for every combatant.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    const combatants = record.combatants.map(summary);
    return textResult(
      combatants.length ? `Combatants.\n${combatants.map(formatCombatant).join("\n")}` : "No combatants.",
      { combatants },
    );
  }, userId);

  registerEncounterTool(server, "list_roster_edges", {
    title: "Bench and casualties",
    description: "PCs on the bench or down, with current HP.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    const edges = record.combatants.filter((row) => row.place !== "fighting" && row.kind === "character").map(summary);
    return textResult(edges.length ? "Roster edges." : "No one on the bench or down.", { edges });
  }, userId);

  registerEncounterTool(server, "get_round_log", {
    title: "Round log",
    description: "Round log lines for the encounter.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    const roundLog = record.roundLog;
    return textResult(
      roundLog.length ? `Round log.\n${roundLog.map(formatRoundLogEntry).join("\n")}` : "No round log entries.",
      { roundLog },
    );
  }, userId);

  registerEncounterTool(server, "get_dice_log", {
    title: "Dice log",
    description: "Shared dice tray and dice log for one encounter, the read side of wgui-ext-patch-encounter-dice. diceState is the current check. diceLog is the saved rolls. To change them, call patch_encounter_dice with the full fields you intend to keep.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    const diceState = record.diceState ?? null;
    const diceLog = record.diceLog;
    const stateText = diceState ? `Current check: ${JSON.stringify(diceState)}` : "Current check: none";
    const logText = diceLog.length
      ? diceLog.map((entry, index) => `${index + 1}. ${formatDiceLogEntry(entry)}`).join("\n")
      : "No dice rolls.";
    return textResult(`Dice log.\n${stateText}\n${logText}`, { diceState, diceLog });
  }, userId);

  registerEncounterTool(server, "get_stat_block", {
    title: "Health tab",
    description: "Current HP, defenses, senses, speeds, and ability modifiers.",
    inputSchema: { ...ids, combatantId: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args, true, true);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    const { row, sheet } = found;
    return textResult(row.name, {
      id: row.id,
      name: row.name,
      level: row.level ?? null,
      place: row.place,
      out: row.out ?? null,
      hpCurrent: row.hpCurrent,
      hpMax: row.hpMax,
      tempHp: row.tempHp ?? null,
      conditions: row.conditions,
      ac: row.ac ?? null,
      fortitude: row.fortitude ?? null,
      reflex: row.reflex ?? null,
      will: row.will ?? null,
      perception: sheet.perception ?? null,
      senses: sheet.senses ?? [],
      speeds: sheet.speeds ?? {},
      classDc: sheet.classDc ?? null,
      resistances: sheet.resistances ?? [],
      weaknesses: sheet.weaknesses ?? [],
      immunities: sheet.immunities ?? [],
      abilityModifiers: sheet.abilityModifiers ?? {},
    });
  }, userId);

  registerEncounterTool(server, "list_ability_groups", {
    title: "Ability group counts",
    description: "Weapon attacks, feats with actions, basic actions, skill actions, speciality basics, exploration, and downtime, with counts.",
    inputSchema: { ...ids, combatantId: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    return textResult("Ability groups.", { groups: found.sheet.groups.map((group) => ({ id: group.id, label: group.label, count: group.actions.length })) });
  }, userId);

  registerEncounterTool(server, "get_abilities", {
    title: "One ability group",
    description: "Entries in one ability group: name, action cost, traits, and description.",
    inputSchema: { ...ids, combatantId: z.string(), group: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    const group = found.sheet.groups.find((item) => item.id === args.group || item.label === args.group);
    if (!group) return notFound("Ability group not found.");
    return textResult(group.label, { actions: group.actions });
  }, userId);

  registerEncounterTool(server, "get_feats", {
    title: "Feats",
    description: "Class, ancestry, general, and other feats. Optional section filter.",
    inputSchema: { ...ids, combatantId: z.string(), section: z.enum(["class", "ancestry", "general", "other"]).optional() },
  }, async (args, uid) => {
    const found = await one(uid, args);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    const feats = found.sheet.feats.filter((feat) => !args.section || feat.section === args.section);
    return textResult("Feats.", { feats });
  }, userId);

  registerEncounterTool(server, "get_class_features", {
    title: "Class features",
    description: "Class features with name and level.",
    inputSchema: { ...ids, combatantId: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    return textResult("Class features.", { classFeatures: found.sheet.classFeatures });
  }, userId);

  registerEncounterTool(server, "get_skills", {
    title: "Skills",
    description: "Skill name, modifier, and proficiency.",
    inputSchema: { ...ids, combatantId: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    return textResult("Skills.", { skills: found.sheet.skills });
  }, userId);

  registerEncounterTool(server, "get_spells", {
    title: "Spells",
    description: "Tradition, rank, and spent slots from the encounter.",
    inputSchema: { ...ids, combatantId: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args, true);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    return textResult("Spells.", {
      spells: found.sheet.spells,
    });
  }, userId);

  registerEncounterTool(server, "get_character", {
    title: "Remaining PC tabs",
    description: "Inventory, notes, details, and log for a PC. A creature id is not found.",
    inputSchema: { ...ids, combatantId: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    if (found.row.kind !== "character") return notFound("Combatant not found.");
    return textResult(found.row.name, { inventory: found.sheet.inventory ?? null, notes: found.sheet.notes ?? null, details: found.sheet.details ?? null, log: found.sheet.log ?? null });
  }, userId);

  registerEncounterTool(server, "get_monster", {
    title: "Remaining creature tabs",
    description: "Inventory, notes, details, and log for a creature. A PC id is not found.",
    inputSchema: { ...ids, combatantId: z.string() },
  }, async (args, uid) => {
    const found = await one(uid, args);
    if (!found) return notFound("Encounter not found.");
    if ("missing" in found) return notFound("Combatant not found.");
    if (found.row.kind !== "creature") return notFound("Combatant not found.");
    return textResult(found.row.name, { inventory: found.sheet.inventory ?? null, notes: found.sheet.notes ?? null, details: found.sheet.details ?? null, log: found.sheet.log ?? null });
  }, userId);
}

function formatEncounter(record: EncounterRecord) {
  return [
    `Encounter: ${record.name}`,
    `Round: ${record.round}`,
    `Difficulty: ${record.difficulty ?? "unknown"}`,
    `XP: ${record.xp ?? "unknown"}`,
    `Note: ${record.noteName ?? "none"}`,
  ].join("\n");
}

function formatCombatant(row: ReturnType<typeof summary>) {
  const conditions = row.conditions.length
    ? row.conditions.map((condition) => condition.value == null ? condition.name : `${condition.name} ${condition.value}`).join(", ")
    : "none";
  const saves = `AC ${row.ac ?? "?"}, Fort ${row.fortitude ?? "?"}, Ref ${row.reflex ?? "?"}, Will ${row.will ?? "?"}`;
  const hp = `HP ${row.hpCurrent}/${row.hpMax}${row.tempHp == null ? "" : ` (+${row.tempHp} temp)`}`;
  return `${row.id} | ${row.name} | ${row.kind} | ${row.side} | init ${row.initiative ?? "?"} | ${hp} | ${saves} | conditions: ${conditions} | ${row.place}${row.out ? ` (${row.out})` : ""}`;
}

function formatRoundLogEntry(entry: EncounterRecord["roundLog"][number]) {
  return `round ${entry.round} | ${entry.name} | ${entry.side} | initiative ${entry.initiative ?? "?"} | ${entry.calculation ?? ""}${entry.note ? ` | note: ${entry.note}` : ""}`.replace(/ \\| $/, "");
}

function formatDiceLogEntry(entry: EncounterRecord["diceLog"][number]) {
  return [
    entry.title ?? "Untitled roll",
    entry.dc == null ? null : `DC ${entry.dc}`,
    entry.stat ?? null,
    entry.result == null ? null : `result ${entry.result}`,
  ].filter(Boolean).join(" | ");
}

function summary(row: EncounterRecord["combatants"][number]) {
  return {
    id: row.id,
    name: row.name,
    side: row.side,
    level: row.level ?? null,
    kind: row.kind,
    place: row.place,
    out: row.out ?? null,
    initiative: row.initiative ?? null,
    conditions: row.conditions,
    ac: row.ac ?? null,
    fortitude: row.fortitude ?? null,
    reflex: row.reflex ?? null,
    will: row.will ?? null,
    hpCurrent: row.hpCurrent,
    hpMax: row.hpMax,
    tempHp: row.tempHp ?? null,
  };
}

async function one(userId: string, args: Record<string, unknown>, live = false, includeStats = false) {
  const record = await encounter(userId, Number(args.campaignId), Number(args.encounterId), live ? String(args.combatantId) : undefined, includeStats);
  if (!record) return null;
  const found = sheetOf(record, String(args.combatantId));
  if (!found) return { missing: true as const };
  return found;
}
