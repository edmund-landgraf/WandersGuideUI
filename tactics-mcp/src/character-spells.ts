import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { invokeFunction, type CharacterRow } from "./character-client.js";
import { enabledIds, fail, loadRow, saveRow, summary, textResult, thrown } from "./character-catalog.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

export type CastingSource = { name: string; type: string; tradition: string; attribute: string };
export type SpellListEntry = { spell_id: number; rank: number; source: string };
export type SpellSlot = { id?: string; rank: number; source: string; spell_id?: number; spell_list_source?: string; exhausted?: boolean; color?: string };
type SpellsField = { slots: SpellSlot[]; list: SpellListEntry[]; focus_point_current: number; innate_casts: unknown[] };
type SpellRecord = { id: number; name: string; rank: number; traditions: string[]; rarity: string };

const EMPTY_SPELLS: SpellsField = { slots: [], list: [], focus_point_current: 0, innate_casts: [] };

export type SlotCount = { rank: number; source: string; amount: number };
export type Spellcasting = { sources: CastingSource[]; slots: SlotCount[] };
export type SpellcastingRunner = (character: CharacterRow) => Promise<Spellcasting>;

/** Parses CASTING_SOURCES entries, "NAME:::TYPE:::TRADITION:::ATTRIBUTE". */
export function parseCastingSources(values: unknown): CastingSource[] {
  const found = new Map<string, CastingSource>();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string") continue;
    const [name, type, tradition, attribute] = value.split(":::");
    if (name && type && tradition) found.set(name, { name, type, tradition, attribute: attribute ?? "" });
  }
  return [...found.values()];
}

let spellcastingRunner: SpellcastingRunner | null = null;

/** Tests inject the computed sources and slots. null uses the builder operation pass. */
export function setSpellcastingRunner(next: SpellcastingRunner | null) {
  spellcastingRunner = next;
}

async function spellcastingOf(row: CharacterRow): Promise<Spellcasting> {
  if (spellcastingRunner) return spellcastingRunner(row);
  const { liveSpellcasting } = await import("./character-choices-live.js");
  return liveSpellcasting(row);
}

/** The builder always includes the common core book (id 3) with the enabled books. */
export const COMMON_CORE_ID = 3;

export function spellBooks(row: CharacterRow) {
  return [...new Set([COMMON_CORE_ID, ...enabledIds(row)])];
}

export function maxSpellRank(level: unknown) {
  const n = typeof level === "number" && level > 0 ? level : 1;
  return Math.min(10, Math.ceil(n / 2));
}

export function isPrepared(source: CastingSource) {
  return source.type.startsWith("PREPARED");
}

function spellsOf(row: CharacterRow): SpellsField {
  const current = row.spells as Partial<SpellsField> | null | undefined;
  return { ...EMPTY_SPELLS, ...(current ?? {}) } as SpellsField;
}

function asSpell(value: unknown): SpellRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "number" || typeof item.rank !== "number") return null;
  return {
    id: item.id,
    name: typeof item.name === "string" ? item.name : String(item.id),
    rank: item.rank,
    traditions: Array.isArray(item.traditions) ? item.traditions.map((t) => String(t).toLowerCase()) : [],
    rarity: typeof item.rarity === "string" ? item.rarity : "COMMON",
  };
}

function pickSource(sources: CastingSource[], name: string | undefined) {
  if (!sources.length) return { error: "This character has no spellcasting source." };
  if (name) {
    const source = sources.find((item) => item.name.toUpperCase() === name.toUpperCase());
    return source ? { source } : { error: `Unknown casting source ${name}. Sources: ${sources.map((s) => s.name).join(", ")}.` };
  }
  if (sources.length > 1) return { error: `Pass source. Sources: ${sources.map((s) => s.name).join(", ")}.` };
  return { source: sources[0] };
}

/** Checks one spell against the source: in the character's books, on the tradition, and castable at rank. */
export function spellProblem(spell: SpellRecord | null, id: number, rank: number, source: CastingSource, maxRank: number) {
  if (!spell) return `Spell ${id} is not in the character's enabled books.`;
  if (!spell.traditions.includes(source.tradition.toLowerCase())) return `${spell.name} is not on the ${source.tradition.toLowerCase()} list.`;
  if (spell.rank === 0 && rank !== 0) return `${spell.name} is a cantrip; use rank 0.`;
  if (spell.rank > 0 && rank === 0) return `${spell.name} is not a cantrip.`;
  if (rank < spell.rank) return `${spell.name} is rank ${spell.rank}; it cannot be taken at rank ${rank}.`;
  if (rank > maxRank) return `Rank ${rank} is above this character's highest rank ${maxRank}.`;
  return null;
}

async function fetchSpells(userId: string, row: CharacterRow, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return { ok: true as const, data: new Map<number, SpellRecord>() };
  const found = await invokeFunction(userId, "find-spell", { id: unique, content_sources: spellBooks(row) });
  if (!found.ok) return found;
  const rows = Array.isArray(found.data) ? found.data : found.data ? [found.data] : [];
  const map = new Map<number, SpellRecord>();
  for (const item of rows) {
    const spell = asSpell(item);
    if (spell) map.set(spell.id, spell);
  }
  return { ok: true as const, data: map };
}

const entrySchema = z.object({ spellId: z.number().int(), rank: z.number().int().min(0).max(10) });

function invalid(message: string, extra: Record<string, unknown> = {}) {
  return textResult(message, { code: "VALIDATION_ERROR", retryable: false, ...extra }, true);
}

function spellsSummary(row: CharacterRow, source: CastingSource) {
  const spells = spellsOf(row);
  return {
    ...summary(row),
    source: source.name,
    list: spells.list.filter((entry) => entry.source === source.name),
    prepared: spells.slots.filter((slot) => slot.source === source.name && slot.spell_id !== undefined),
  };
}

export function registerCharacterSpells(server: McpServer, userId: () => string) {
  server.registerTool(
    "list_spell_options",
    {
      title: "Spell options",
      description: "Legal spells for one casting source: the source's tradition, rank 0 (cantrips) up to the character's highest rank, from the common core plus the character's enabled books. Common only unless includeUncommon. Returns the source name, type, tradition, and max_rank.",
      annotations: readOnly,
      inputSchema: {
        characterId: z.number().int(),
        source: z.string().optional(),
        rank: z.number().int().min(0).max(10).optional(),
        name: z.string().optional(),
        includeUncommon: z.boolean().optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      let casting: Spellcasting;
      try {
        casting = await spellcastingOf(loaded.data);
      } catch (error) {
        return thrown(error);
      }
      const picked = pickSource(casting.sources, args.source);
      if (!picked.source) return invalid(picked.error ?? "No source.", { sources: casting.sources });
      const source = picked.source;
      const maxRank = maxSpellRank(loaded.data.level);
      const body: Record<string, unknown> = { content_sources: spellBooks(loaded.data) };
      if (args.name) body.name = args.name;
      const found = await invokeFunction(userId(), "find-spell", body);
      if (!found.ok) return fail(found);
      const rows = Array.isArray(found.data) ? found.data : found.data ? [found.data] : [];
      const tradition = source.tradition.toLowerCase();
      const options = rows
        .map(asSpell)
        .filter((spell): spell is SpellRecord => spell !== null)
        .filter((spell) => spell.traditions.includes(tradition) && spell.rank <= maxRank)
        .filter((spell) => args.rank === undefined || spell.rank === args.rank)
        .filter((spell) => args.includeUncommon || spell.rarity === "COMMON")
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
        .map((spell) => ({ id: spell.id, name: spell.name, rank: spell.rank, rarity: spell.rarity }));
      return textResult(`${options.length} spells for ${source.name}`, {
        source: source.name,
        type: source.type,
        tradition: source.tradition,
        max_rank: maxRank,
        slots: casting.slots.filter((slot) => slot.source === source.name),
        options,
      });
    },
  );

  server.registerTool(
    "add_spell",
    {
      title: "Add a spell",
      description: "Adds { spell_id, rank, source } to spells.list, the same entry Manage Spells writes (repertoire, spellbook, or known list). With prepare, also fills the first empty prepared slot of that rank for a prepared source. Rejects unknown ids, off-tradition spells, and illegal ranks.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        spellId: z.number().int(),
        rank: z.number().int().min(0).max(10),
        source: z.string().optional(),
        prepare: z.boolean().optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      let casting: Spellcasting;
      try {
        casting = await spellcastingOf(loaded.data);
      } catch (error) {
        return thrown(error);
      }
      const picked = pickSource(casting.sources, args.source);
      if (!picked.source) return invalid(picked.error ?? "No source.");
      const source = picked.source;
      if (args.prepare && !isPrepared(source)) return invalid(`${source.name} is not a prepared caster.`);
      const fetched = await fetchSpells(userId(), loaded.data, [args.spellId]);
      if (!fetched.ok) return fail(fetched);
      const problem = spellProblem(fetched.data.get(args.spellId) ?? null, args.spellId, args.rank, source, maxSpellRank(loaded.data.level));
      if (problem) return invalid(problem);
      const spells = spellsOf(loaded.data);
      if (args.prepare) {
        const have = casting.slots.filter((slot) => slot.source === source.name && slot.rank === args.rank).reduce((n, slot) => n + slot.amount, 0);
        const used = spells.slots.filter((slot) => slot.source === source.name && slot.rank === args.rank && slot.spell_id !== undefined && slot.spell_list_source === undefined).length;
        if (used >= have) return invalid(`${source.name} has no empty rank ${args.rank} slot.`);
      }
      const list = spells.list.some((e) => e.spell_id === args.spellId && e.rank === args.rank && e.source === source.name)
        ? spells.list
        : [...spells.list, { spell_id: args.spellId, rank: args.rank, source: source.name }];
      const slots = args.prepare
        ? [...spells.slots, { rank: args.rank, source: source.name, spell_id: args.spellId }]
        : spells.slots;
      const saved = await saveRow(userId(), loaded.data, { spells: { ...spells, list, slots } });
      if (!saved.ok) return fail(saved);
      return textResult("Spell saved", spellsSummary(saved.data, source));
    },
  );

  server.registerTool(
    "remove_spell",
    {
      title: "Remove a spell",
      description: "Removes a spell from spells.list for one source and clears it from that source's prepared slots. rank limits the removal to one rank.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        spellId: z.number().int(),
        rank: z.number().int().min(0).max(10).optional(),
        source: z.string().optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      let casting: Spellcasting;
      try {
        casting = await spellcastingOf(loaded.data);
      } catch (error) {
        return thrown(error);
      }
      const picked = pickSource(casting.sources, args.source);
      if (!picked.source) return invalid(picked.error ?? "No source.");
      const source = picked.source;
      const hit = (id: number | undefined, rank: number, from: string) =>
        id === args.spellId && from === source.name && (args.rank === undefined || rank === args.rank);
      const spells = spellsOf(loaded.data);
      const list = spells.list.filter((e) => !hit(e.spell_id, e.rank, e.source));
      const slots = spells.slots.filter((s) => !hit(s.spell_id, s.rank, s.source));
      if (list.length === spells.list.length && slots.length === spells.slots.length) {
        return textResult("That spell is not on this source.", { code: "NOT_FOUND", retryable: false }, true);
      }
      const saved = await saveRow(userId(), loaded.data, { spells: { ...spells, list, slots } });
      if (!saved.ok) return fail(saved);
      return textResult("Spell removed", spellsSummary(saved.data, source));
    },
  );

  server.registerTool(
    "set_spells",
    {
      title: "Set spells for a source",
      description: "Replaces one casting source's spells.list entries with list, and for a prepared source its prepared slots with prepared (one entry per slot). Entries for other sources, focus points, and innate casts are kept. Every id is validated before the save; nothing is written if any entry fails.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        source: z.string().optional(),
        list: z.array(entrySchema).optional(),
        prepared: z.array(entrySchema).optional(),
      },
    },
    async (args) => {
      if (!args.list && !args.prepared) return invalid("Pass list, prepared, or both.");
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      let casting: Spellcasting;
      try {
        casting = await spellcastingOf(loaded.data);
      } catch (error) {
        return thrown(error);
      }
      const picked = pickSource(casting.sources, args.source);
      if (!picked.source) return invalid(picked.error ?? "No source.");
      const source = picked.source;
      if (args.prepared && !isPrepared(source)) return invalid(`${source.name} is not a prepared caster; use list.`);
      const entries = [...(args.list ?? []), ...(args.prepared ?? [])];
      const fetched = await fetchSpells(userId(), loaded.data, entries.map((e) => e.spellId));
      if (!fetched.ok) return fail(fetched);
      const maxRank = maxSpellRank(loaded.data.level);
      const problems = entries
        .map((e) => spellProblem(fetched.data.get(e.spellId) ?? null, e.spellId, e.rank, source, maxRank))
        .filter((p): p is string => p !== null);
      for (const rank of new Set((args.prepared ?? []).map((e) => e.rank))) {
        const wanted = (args.prepared ?? []).filter((e) => e.rank === rank).length;
        const have = casting.slots.filter((slot) => slot.source === source.name && slot.rank === rank).reduce((n, slot) => n + slot.amount, 0);
        if (wanted > have) problems.push(`${source.name} has ${have} rank ${rank} slots; ${wanted} prepared.`);
      }
      if (problems.length) return invalid(problems.join(" "), { problems });
      const spells = spellsOf(loaded.data);
      const list = args.list
        ? [
            ...spells.list.filter((e) => e.source !== source.name),
            ...args.list.map((e) => ({ spell_id: e.spellId, rank: e.rank, source: source.name })),
          ]
        : spells.list;
      const slots = args.prepared
        ? [
            ...spells.slots.filter((s) => s.source !== source.name || s.spell_list_source !== undefined),
            ...args.prepared.map((e) => ({ rank: e.rank, source: source.name, spell_id: e.spellId })),
          ]
        : spells.slots;
      const saved = await saveRow(userId(), loaded.data, { spells: { ...spells, list, slots } });
      if (!saved.ok) return fail(saved);
      return textResult("Spells saved", spellsSummary(saved.data, source));
    },
  );
}
