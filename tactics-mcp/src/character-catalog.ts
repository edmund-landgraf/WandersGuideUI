import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { applyCharacterWrite, listCharacterChoices, type OpenChoice } from "./character-choices.js";
import { asRow, guardOf, invokeFunction, type CharacterRow, type InvokeResult } from "./character-client.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const KINDS = {
  class: "find-class",
  ancestry: "find-ancestry",
  background: "find-background",
  "class-archetype": "find-class-archetype",
  archetype: "find-archetype",
  "versatile-heritage": "find-versatile-heritage",
  "ability-block": "find-ability-block",
  spell: "find-spell",
  item: "find-item",
  language: "find-language",
  trait: "find-trait",
  "content-source": "find-content-source",
} as const;

type Kind = keyof typeof KINDS;

export function textResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
  return {
    isError: isError || undefined,
    content: [{ type: "text" as const, text: `${text}\n${JSON.stringify(structuredContent)}` }],
    structuredContent,
  };
}

export function fail(result: Extract<InvokeResult, { ok: false }>) {
  return textResult(result.message, { code: result.code, retryable: result.code === "CONFLICT", ...(result.data ? { data: result.data } : {}) }, true);
}

export function thrown(error: unknown) {
  const message = error instanceof Error ? error.message : "Character operations failed.";
  return textResult(message, { code: "INTERNAL_ERROR", retryable: true }, true);
}

const SAVE_FIELDS = [
  "name", "level", "experience", "hp_current", "hp_temp", "hero_points", "stamina_current", "resolve_current",
  "inventory", "notes", "details", "roll_history", "custom_operations", "meta_data", "options", "variants",
  "content_sources", "operation_data", "spells", "companions",
] as const;

function savePatch(row: CharacterRow) {
  const patch: Record<string, unknown> = {};
  for (const key of SAVE_FIELDS) {
    if (key in row) patch[key] = row[key];
  }
  return patch;
}

function shorten(value: unknown, full: boolean): unknown {
  if (full) return value;
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (Array.isArray(value)) return value.map((item) => shorten(item, false));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = shorten(item, false);
    return out;
  }
  return value;
}

function named(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

export function summary(row: CharacterRow) {
  const details = (row.details as Record<string, unknown> | undefined) ?? {};
  const sources = (row.content_sources as { enabled?: unknown } | undefined)?.enabled;
  return {
    id: row.id,
    name: row.name ?? null,
    level: row.level ?? null,
    books: Array.isArray(sources) ? sources : [],
    ancestry: named(details.ancestry),
    background: named(details.background),
    className: named(details.class),
    updated_at: row.updated_at ?? null,
  };
}

export async function loadRow(userId: string, id: number) {
  const found = await invokeFunction(userId, "find-character", { id });
  if (!found.ok) return found;
  const blocked = guardOf(found.data);
  if (blocked) return blocked;
  const row = asRow(found.data);
  if (!row) return { ok: false as const, code: "NOT_FOUND", message: "Character not found." };
  return { ok: true as const, data: row };
}

export async function saveRow(userId: string, row: CharacterRow, patch: Record<string, unknown>) {
  const expected = typeof row.updated_at === "string" ? row.updated_at : undefined;
  const saved = await invokeFunction(userId, "update-character", {
    id: row.id,
    ...patch,
    ...(expected ? { expected_updated_at: expected } : {}),
  });
  if (!saved.ok) return saved;
  const blocked = guardOf(saved.data);
  if (blocked) return blocked;
  const next = asRow(Array.isArray(saved.data) ? saved.data[0] : saved.data) ?? row;
  return { ok: true as const, data: next };
}

function dropSelections(selections: unknown, prefixes: string[]) {
  const next = selections && typeof selections === "object" ? { ...(selections as Record<string, string>) } : {};
  for (const key of Object.keys(next)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) delete next[key];
  }
  return next;
}

export function enabledIds(row: CharacterRow) {
  const sources = (row.content_sources as { enabled?: unknown } | undefined)?.enabled;
  return Array.isArray(sources) ? sources.filter((id): id is number => typeof id === "number") : [];
}

export function registerCharacterCatalog(server: McpServer, userId: () => string) {
  server.registerTool(
    "create_character",
    {
      title: "Create character",
      description: "Creates a character row with create-character. Returns id and updated_at.",
      annotations: writes,
      inputSchema: { name: z.string().optional(), level: z.number().int().min(1).max(20).optional() },
    },
    async (args) => {
      const created = await invokeFunction(userId(), "create-character", {
        name: args.name,
        level: args.level ?? 1,
        meta_data: { reset_hp: true },
        details: {},
      });
      if (!created.ok) return fail(created);
      const row = asRow(created.data);
      if (!row) return textResult("create-character did not return a character.", { code: "INTERNAL_ERROR", retryable: false }, true);
      return textResult(String(row.name ?? "Character"), shorten(summary(row), false) as Record<string, unknown>);
    },
  );

  server.registerTool(
    "get_character_row",
    {
      title: "Character row",
      description: "Reads a character with find-character. The encounter tool get_character is a different call. full returns the row.",
      annotations: readOnly,
      inputSchema: {
        id: z.number().int().optional(),
        user_id: z.string().optional(),
        campaignId: z.number().int().optional(),
        full: z.boolean().optional(),
      },
    },
    async (args) => {
      const body: Record<string, unknown> = {};
      if (args.id !== undefined) body.id = args.id;
      if (args.user_id) body.user_id = args.user_id;
      if (args.campaignId !== undefined) body.campaign_id = args.campaignId;
      if (!Object.keys(body).length) return textResult("Pass id, user_id, or campaignId.", { code: "VALIDATION_ERROR", retryable: false }, true);
      const found = await invokeFunction(userId(), "find-character", body);
      if (!found.ok) return fail(found);
      if (Array.isArray(found.data)) {
        const rows = found.data.map((item) => asRow(item)).filter((item): item is CharacterRow => item !== null).map(summary);
        return textResult(`${rows.length} characters`, { characters: shorten(rows, Boolean(args.full)) });
      }
      const row = asRow(found.data);
      if (!row) return textResult("Character not found.", { code: "NOT_FOUND", retryable: false }, true);
      const payload = args.full ? { ...summary(row), character: shorten(row, true) } : summary(row);
      return textResult(String(row.name ?? "Character"), payload as Record<string, unknown>);
    },
  );

  server.registerTool(
    "set_books",
    {
      title: "Enabled books",
      description: "Adds or removes content source ids on content_sources.enabled and saves with expected_updated_at. Later catalog calls use this list.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        add: z.array(z.number().int()).optional(),
        remove: z.array(z.number().int()).optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const current = new Set(enabledIds(loaded.data));
      for (const id of args.add ?? []) current.add(id);
      for (const id of args.remove ?? []) current.delete(id);
      const sources = { ...((loaded.data.content_sources as Record<string, unknown> | undefined) ?? {}), enabled: [...current] };
      const saved = await saveRow(userId(), loaded.data, { content_sources: sources });
      if (!saved.ok) return fail(saved);
      return textResult("Books saved", summary(saved.data));
    },
  );

  server.registerTool(
    "list_options",
    {
      title: "Catalog options",
      description: "One catalog read. kind selects the find-* function. content_sources defaults to the character's enabled books.",
      annotations: readOnly,
      inputSchema: {
        kind: z.enum(Object.keys(KINDS) as [Kind, ...Kind[]]),
        characterId: z.number().int().optional(),
        content_sources: z.array(z.number().int()).optional(),
        id: z.number().int().optional(),
        name: z.string().optional(),
        full: z.boolean().optional(),
      },
    },
    async (args) => {
      let sources = args.content_sources;
      if (!sources && args.characterId !== undefined) {
        const loaded = await loadRow(userId(), args.characterId);
        if (!loaded.ok) return fail(loaded);
        sources = enabledIds(loaded.data);
      }
      const body: Record<string, unknown> = {};
      if (sources) body.content_sources = sources;
      if (args.id !== undefined) body.id = args.id;
      if (args.name) body.name = args.name;
      const found = await invokeFunction(userId(), KINDS[args.kind], body);
      if (!found.ok) return fail(found);
      const rows = Array.isArray(found.data) ? found.data : found.data ? [found.data] : [];
      const options = rows.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => ({
        id: item.id ?? null,
        name: typeof item.name === "string" ? item.name : null,
        traits: Array.isArray(item.traits) ? item.traits : [],
        ...(args.full ? { record: shorten(item, true) } : {}),
      }));
      return textResult(`${options.length} ${args.kind}`, { options: shorten(options, Boolean(args.full)) as Record<string, unknown>[] });
    },
  );

  server.registerTool(
    "set_identity",
    {
      title: "Ancestry, background, or class",
      description: "Writes details.ancestry, details.background, or details.class from a list_options id, clears the child selection keys the builder clears, and reruns character operations.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        slot: z.enum(["ancestry", "background", "class"]),
        optionId: z.number().int(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const kind = args.slot === "class" ? "class" : args.slot;
      const found = await invokeFunction(userId(), KINDS[kind], { id: args.optionId, content_sources: enabledIds(loaded.data) });
      if (!found.ok) return fail(found);
      const option = Array.isArray(found.data) ? found.data[0] : found.data;
      if (!option || typeof option !== "object") return textResult("Option not found in the character's books.", { code: "NOT_FOUND", retryable: false }, true);
      const sourceId = (option as { content_source_id?: unknown }).content_source_id;
      const allowedSources = new Set([3, ...enabledIds(loaded.data)]);
      if (typeof sourceId !== "number" || !allowedSources.has(sourceId)) {
        return textResult("Option not found in the character's books.", { code: "NOT_IN_BOOKS", retryable: false, content_source_id: sourceId ?? null }, true);
      }
      const details = { ...((loaded.data.details as Record<string, unknown> | undefined) ?? {}) };
      const operation = (loaded.data.operation_data as Record<string, unknown> | undefined) ?? {};
      let selections = operation.selections;
      if (args.slot === "ancestry") {
        details.ancestry = option;
        selections = dropSelections(selections, ["ancestry"]);
      } else if (args.slot === "background") {
        details.background = option;
        selections = dropSelections(selections, ["background"]);
      } else {
        details.class = option;
        details.class_archetype = undefined;
        selections = dropSelections(selections, ["class_", "class-feature"]);
      }
      let drafted: CharacterRow;
      try {
        drafted = await applyCharacterWrite({ ...loaded.data, details, operation_data: { ...operation, selections } });
      } catch (error) {
        return thrown(error);
      }
      const saved = await saveRow(userId(), loaded.data, savePatch(drafted));
      if (!saved.ok) return fail(saved);
      return textResult("Identity saved", summary(saved.data));
    },
  );

  server.registerTool(
    "list_open_choices",
    {
      title: "Open builder choices",
      description: "Runs character operations and returns unfilled selects: stored selection key, kind, remaining, already, and legal options. Pass that key to choose.",
      annotations: readOnly,
      inputSchema: { characterId: z.number().int() },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      let choices: OpenChoice[];
      try {
        choices = await listCharacterChoices(loaded.data, userId());
      } catch (error) {
        return thrown(error);
      }
      return textResult(`${choices.length} open choices`, { id: loaded.data.id, updated_at: loaded.data.updated_at ?? null, choices });
    },
  );

  server.registerTool(
    "choose",
    {
      title: "Record a builder choice",
      description: "Writes or changes one option id in a selection key, reruns character operations, reopens dependent choices, and saves the builder fields. An id that is not legal for that choice is rejected before the save.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        choiceId: z.string(),
        optionId: z.string(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const operation = (loaded.data.operation_data as Record<string, unknown> | undefined) ?? {};
      const currentSelections = { ...((operation.selections as Record<string, string> | undefined) ?? {}) };
      const wasAnswered = Object.prototype.hasOwnProperty.call(currentSelections, args.choiceId);
      // Remove the target and nested answers before rerunning the builder. This
      // makes an answered choice visible again and prevents stale dependent
      // selections from surviving a changed parent choice.
      const selectionsWithoutChoice = Object.fromEntries(Object.entries(currentSelections).filter(([key]) => key !== args.choiceId && !key.startsWith(`${args.choiceId}_`)));
      const choiceCharacter = wasAnswered
        ? { ...loaded.data, operation_data: { ...operation, selections: selectionsWithoutChoice } }
        : loaded.data;
      let choices: OpenChoice[];
      try {
        choices = await listCharacterChoices(choiceCharacter, userId());
      } catch (error) {
        return thrown(error);
      }
      const choice = choices.find((item) => item.id === args.choiceId);
      if (!choice) return textResult("That choice is not open.", { code: "NOT_FOUND", retryable: false }, true);
      if (!choice.options.some((option) => option.id === args.optionId)) {
        return textResult("That option is not legal for this choice.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const selections = { ...selectionsWithoutChoice, [args.choiceId]: args.optionId };
      let drafted: CharacterRow;
      try {
        drafted = await applyCharacterWrite({ ...loaded.data, operation_data: { ...operation, selections } });
      } catch (error) {
        return thrown(error);
      }
      const saved = await saveRow(userId(), loaded.data, savePatch(drafted));
      if (!saved.ok) return fail(saved);
      return textResult("Choice saved", { ...summary(saved.data), choiceId: args.choiceId, optionId: args.optionId });
    },
  );

  server.registerTool(
    "delete_character",
    {
      title: "Delete character",
      description: "Deletes a character the caller can read by posting { id, type: character } to delete-content.",
      annotations: writes,
      inputSchema: { characterId: z.number().int() },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const deleted = await invokeFunction(userId(), "delete-content", { id: loaded.data.id, type: "character" });
      if (!deleted.ok) return fail(deleted);
      return textResult("Character deleted", { id: args.characterId });
    },
  );
}

export type { OpenChoice };
