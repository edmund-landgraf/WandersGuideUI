import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getEncounterReader, type CombatantSheet, type EncounterRecord } from "./reader.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const gm = { view: z.literal("gm").describe("Required. Only gm is accepted.") };

type ToolConfig = {
  title: string;
  description: string;
  inputSchema?: Record<string, z.ZodType>;
};

function textResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
  return {
    isError: isError || undefined,
    content: [{ type: "text" as const, text }],
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
      return textResult(profile.email || profile.id, { ...profile });
    },
  );

  registerEncounterTool(server, "list_encounters", {
    title: "Encounter list",
    description: "Lists encounters in a campaign.",
    inputSchema: { campaignId: z.number().int() },
  }, async (args, uid) => {
    const encounters = await getEncounterReader().listEncounters(uid, Number(args.campaignId));
    return textResult(encounters.length ? "Encounters." : "No encounters.", { encounters });
  }, userId);

  registerEncounterTool(server, "get_encounter", {
    title: "Encounter header",
    description: "Name, round, difficulty, and XP for one encounter.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    return textResult(record.name, {
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
    return textResult("Combatants.", { combatants: record.combatants.map(summary) });
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
    return textResult("Round log.", { roundLog: record.roundLog });
  }, userId);

  registerEncounterTool(server, "get_dice_log", {
    title: "Dice log",
    description: "Dice Rolls tab for the encounter.",
    inputSchema: ids,
  }, async (args, uid) => {
    const record = await encounter(uid, Number(args.campaignId), Number(args.encounterId));
    if (!record) return notFound("Encounter not found.");
    return textResult("Dice log.", { diceLog: record.diceLog });
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
      liveCasting: found.sheet.details ?? null,
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
