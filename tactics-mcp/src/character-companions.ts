import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { collectOpenChoices, type OpenChoice } from "./character-choices.js";
import { enabledIds, fail, loadRow, saveRow, textResult, thrown } from "./character-catalog.js";
import { invokeFunction, type CharacterRow, type InvokeErr } from "./character-client.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

/** Same core book id the builder always includes. See COMMON_CORE_ID in src/constants/data.ts. */
const CORE_BOOK_ID = 3;

// Writes go to vanilla update-character, the same POST the sheet uses
// (src/utils/use-character.tsx and Phase1SheetPage persist). Catalog checks are
// find-creature, find-trait, and find-ability-block, the RequestType names in
// src/process/content/content-store.ts. Those function sources are not in this repo.
// Open selects are computed in-process with the sheet's creature operation runner.

type CreatureRecord = Record<string, unknown>;

type TraitInfo = { id: number; name: string; companionType: boolean };

type OperationPackage = {
  creatureResults?: Parameters<typeof collectOpenChoices>[0];
  abilityResults?: { baseSource?: { id?: number }; baseResults?: Parameters<typeof collectOpenChoices>[0] }[];
  itemResults?: { baseSource?: { id?: number }; baseResults?: Parameters<typeof collectOpenChoices>[0] }[];
};

export type CompanionChoiceRunner = (
  character: CharacterRow,
  creature: CreatureRecord,
  index: number,
  userId: string,
) => Promise<OpenChoice[]>;

let choiceRunner: CompanionChoiceRunner | null = null;

export function setCompanionChoiceRunner(next: CompanionChoiceRunner | null) {
  choiceRunner = next;
}

function booksOf(row: CharacterRow) {
  return [...new Set([CORE_BOOK_ID, ...enabledIds(row)])];
}

export function ownsCharacter(userId: string, row: CharacterRow) {
  const owner = row.user_id;
  return typeof owner === "string" && owner.trim().toLowerCase() === userId.trim().toLowerCase();
}

export function companionList(row: CharacterRow): unknown[] {
  const raw = row.companions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const list = (raw as { list?: unknown }).list;
  return Array.isArray(list) ? [...list] : [];
}

export function companionsRecord(row: CharacterRow, list: unknown[]) {
  const current = row.companions;
  const base = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  return { ...base, list };
}

export function asCreature(value: unknown): CreatureRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as CreatureRecord;
}

// Same read as findCreatureTraits in src/utils/creature.ts.
export function giveTraitIds(creature: CreatureRecord) {
  const ops = creature.operations;
  if (!Array.isArray(ops)) return [];
  const ids: number[] = [];
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const record = op as { type?: unknown; data?: { traitId?: unknown } };
    if (record.type !== "giveTrait") continue;
    const id = record.data?.traitId;
    if (typeof id === "number" && id !== -1) ids.push(id);
  }
  return ids;
}

// Same label as determineCompanionType: the first companion_type_trait, otherwise "Creature".
export function companionTypeName(traitIds: number[], traits: Map<number, TraitInfo>) {
  for (const id of traitIds) {
    const trait = traits.get(id);
    if (trait?.companionType) return trait.name;
  }
  return "Creature";
}

// CompanionsPanel offers a companion-type creature (including level -100 templates) or any other creature except level -100.
export function creatureAddable(level: unknown, traitIds: number[], traits: Map<number, TraitInfo>, unresolved: number[]) {
  if (unresolved.length > 0 && level === -100) return false;
  const typed = traitIds.some((id) => traits.get(id)?.companionType);
  if (typed) return true;
  return level !== -100;
}

export function sheetLevel(level: unknown, characterLevel: unknown) {
  if (typeof level !== "number") return null;
  if (level === -100) return typeof characterLevel === "number" ? characterLevel : 0;
  return level;
}

export function trimmedCompanionName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function selectionsOf(creature: CreatureRecord) {
  const operation = creature.operation_data;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return {};
  const selections = (operation as { selections?: unknown }).selections;
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(selections)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

// Mirrors CreatureDrawer saveSelectionChange, including clearing a key when value is empty.
export function withSelections(creature: CreatureRecord, selections: Record<string, string>) {
  const operation = creature.operation_data;
  const base = operation && typeof operation === "object" && !Array.isArray(operation) ? { ...(operation as Record<string, unknown>) } : {};
  return { ...creature, operation_data: { ...base, selections } };
}

// Same drop the builder uses before reopening a choice: the key and its nested answers.
export function selectionsWithout(selections: Record<string, string>, key: string) {
  return Object.fromEntries(Object.entries(selections).filter(([entry]) => entry !== key && !entry.startsWith(`${key}_`)));
}

export function abilityIds(creature: CreatureRecord) {
  const raw = creature.abilities_added;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is number => typeof id === "number");
}

// CreateCreatureModal adds with uniq and removes with filter.
export function withAbilities(creature: CreatureRecord, add: number[], remove: number[]) {
  const drop = new Set(remove);
  const next = abilityIds(creature).filter((id) => !drop.has(id));
  for (const id of add) {
    if (!next.includes(id)) next.push(id);
  }
  return { ...creature, abilities_added: next };
}

// Drawer prefixes match convertKeyToBasePrefix: creature, ability-<id>, item-<id>.
export function companionChoicesFromPackage(pkg: OperationPackage): OpenChoice[] {
  const choices = collectOpenChoices(pkg.creatureResults, "creature");
  for (const section of pkg.abilityResults ?? []) {
    if (typeof section.baseSource?.id !== "number") continue;
    choices.push(...collectOpenChoices(section.baseResults, `ability-${section.baseSource.id}`));
  }
  for (const section of pkg.itemResults ?? []) {
    if (typeof section.baseSource?.id !== "number") continue;
    choices.push(...collectOpenChoices(section.baseResults, `item-${section.baseSource.id}`));
  }
  return choices;
}

async function listCompanionChoices(character: CharacterRow, creature: CreatureRecord, index: number, userId: string) {
  if (choiceRunner) return choiceRunner(character, creature, index, userId);
  const { liveCompanionChoices } = await import("./character-companions-live.js");
  return liveCompanionChoices(character, creature, index);
}

function traitInfo(row: CreatureRecord): TraitInfo | null {
  if (typeof row.id !== "number" || typeof row.name !== "string") return null;
  const meta = row.meta_data;
  const companionType = !!meta && typeof meta === "object" && (meta as { companion_type_trait?: unknown }).companion_type_trait === true;
  return { id: row.id, name: row.name, companionType };
}

type ToolResult = ReturnType<typeof textResult>;
type RowFetch = { ok: true; row: CreatureRecord | null } | InvokeErr;
type TraitLoad = { ok: true; traits: Map<number, TraitInfo>; unresolved: number[] } | InvokeErr;
type CatalogLoad = { ok: true; creature: CreatureRecord; type: string } | { ok: false; error: ToolResult };

async function fetchRow(userId: string, name: string, id: number, sources: number[]): Promise<RowFetch> {
  const found = await invokeFunction(userId, name, { id, content_sources: sources });
  if (!found.ok) return found;
  const row = Array.isArray(found.data) ? found.data[0] : found.data;
  if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: true, row: null };
  return { ok: true, row: row as CreatureRecord };
}

async function loadTraits(userId: string, sources: number[], ids: number[]): Promise<TraitLoad> {
  const traits = new Map<number, TraitInfo>();
  const unresolved: number[] = [];
  for (const id of [...new Set(ids)]) {
    const found = await fetchRow(userId, "find-trait", id, sources);
    if (!found.ok) return found;
    const info = found.row ? traitInfo(found.row) : null;
    if (!info) unresolved.push(id);
    else traits.set(info.id, info);
  }
  return { ok: true, traits, unresolved };
}

function inBooks(row: CreatureRecord, sources: number[]) {
  return typeof row.content_source_id === "number" && sources.includes(row.content_source_id);
}

function baseAbilities(creature: CreatureRecord) {
  const raw = creature.abilities_base;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (!item || typeof item !== "object") return { id: null, name: null };
    const record = item as CreatureRecord;
    return {
      id: typeof record.id === "number" ? record.id : null,
      name: typeof record.name === "string" ? record.name : null,
    };
  });
}

async function present(userId: string, row: CharacterRow) {
  const sources = booksOf(row);
  const list = companionList(row);
  const creatures = list.map((item) => asCreature(item));
  const loaded = await loadTraits(userId, sources, creatures.flatMap((creature) => creature ? giveTraitIds(creature) : []));
  if (!loaded.ok) return { ok: false as const, error: fail(loaded) };
  const { traits } = loaded;
  const companions = [];
  for (let index = 0; index < list.length; index += 1) {
    const creature = creatures[index];
    const traitIds = creature ? giveTraitIds(creature) : [];
    const level = creature && typeof creature.level === "number" ? creature.level : null;
    let options: OpenChoice[] = [];
    if (creature) {
      try {
        options = await listCompanionChoices(row, creature, index, userId);
      } catch (error) {
        return { ok: false as const, error: thrown(error) };
      }
    }
    companions.push({
      index,
      storeId: `COMPANION_${index}`,
      id: creature && typeof creature.id === "number" ? creature.id : null,
      name: creature && typeof creature.name === "string" ? creature.name : null,
      level,
      sheetLevel: sheetLevel(level, row.level),
      type: companionTypeName(traitIds, traits),
      traitIds,
      selections: creature ? selectionsOf(creature) : {},
      abilitiesBase: creature ? baseAbilities(creature) : [],
      abilitiesAdded: creature ? abilityIds(creature) : [],
      hpCurrent: creature && typeof creature.hp_current === "number" ? creature.hp_current : null,
      hpTemp: creature && typeof creature.hp_temp === "number" ? creature.hp_temp : null,
      options,
    });
  }
  return { ok: true as const, companions };
}

async function loadCatalogCreature(userId: string, row: CharacterRow, creatureId: number): Promise<CatalogLoad> {
  const sources = booksOf(row);
  const found = await fetchRow(userId, "find-creature", creatureId, sources);
  if (!found.ok) return { ok: false, error: fail(found) };
  if (!found.row) return { ok: false, error: textResult("Creature not found in the character's books.", { code: "NOT_FOUND", retryable: false }, true) };
  if (!inBooks(found.row, sources)) return { ok: false, error: textResult("Creature not found in the character's books.", { code: "NOT_IN_BOOKS", retryable: false, content_source_id: found.row.content_source_id ?? null }, true) };
  const traitIds = giveTraitIds(found.row);
  const loaded = await loadTraits(userId, sources, traitIds);
  if (!loaded.ok) return { ok: false, error: fail(loaded) };
  const { traits, unresolved } = loaded;
  if (!creatureAddable(found.row.level, traitIds, traits, unresolved)) {
    const message = unresolved.length
      ? "Could not resolve this creature's traits, so a level -100 companion template cannot be confirmed."
      : "The sheet does not offer that creature. Companion templates use a companion type trait; other creatures must not be level -100.";
    return { ok: false, error: textResult(message, { code: "VALIDATION_ERROR", retryable: false, unresolvedTraitIds: unresolved }, true) };
  }
  return { ok: true, creature: structuredClone(found.row), type: companionTypeName(traitIds, traits) };
}

function ownerError() {
  return textResult("Only the character owner can edit companions.", { code: "CHARACTER_FORBIDDEN", retryable: false }, true);
}

function requireOwner(userId: string, row: CharacterRow) {
  return ownsCharacter(userId, row) ? null : ownerError();
}

export function registerCharacterCompanions(server: McpServer, userId: () => string) {
  server.registerTool(
    "list_companions",
    {
      title: "Character companions",
      description: "Lists character.companions.list the way the character sheet Companions panel stores it. Animal companions, familiars, and eidolons are the same creature records; type is the first giveTrait whose trait has meta_data.companion_type_trait, or Creature. level -100 is the sheet's use-the-character's-level sentinel (sheetLevel). options are the unfilled selects the creature drawer writes to operation_data.selections, with the same keys (creature_<id>, ability-<id>_<id>, item-<id>_<id>). Witch familiar spells stay on the spells tab.",
      annotations: readOnly,
      inputSchema: { characterId: z.number().int() },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const shown = await present(userId(), loaded.data);
      if (!shown.ok) return shown.error;
      return textResult(`${shown.companions.length} companions`, { characterId: args.characterId, updated_at: loaded.data.updated_at ?? null, companions: shown.companions });
    },
  );

  server.registerTool(
    "add_companion",
    {
      title: "Add companion",
      description: "Appends a catalog creature to companions.list the way CompanionsPanel does: a creature with a companion_type_trait (including level -100 templates) or any other creature whose level is not -100. Optional name is trimmed the way the creature edit modal trims it. Saves only companions with expected_updated_at. Only the character owner may write.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        creatureId: z.number().int(),
        name: z.string().optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const denied = requireOwner(userId(), loaded.data);
      if (denied) return denied;
      const catalog = await loadCatalogCreature(userId(), loaded.data, args.creatureId);
      if (!catalog.ok) return catalog.error;
      let creature = catalog.creature;
      if (args.name !== undefined) {
        const name = trimmedCompanionName(args.name);
        if (!name) return textResult("Companion name cannot be empty.", { code: "VALIDATION_ERROR", retryable: false }, true);
        creature = { ...creature, name };
      }
      const list = [...companionList(loaded.data), creature];
      const saved = await saveRow(userId(), loaded.data, { companions: companionsRecord(loaded.data, list) });
      if (!saved.ok) return fail(saved);
      const shown = await present(userId(), saved.data);
      if (!shown.ok) return shown.error;
      const index = list.length - 1;
      return textResult(`Added ${String(creature.name ?? "companion")}`, { characterId: args.characterId, index, type: catalog.type, companions: shown.companions });
    },
  );

  server.registerTool(
    "update_companion",
    {
      title: "Update companion",
      description: "Edits companions.list[index]. creatureId replaces that slot with another catalog creature (the panel's type and creature pick) and drops the previous selections. name sets creature.name, trimmed like the edit modal. addAbilityIds and removeAbilityIds edit abilities_added the way that modal does. choiceId plus optionId writes one operation_data.selections entry the creature drawer writes; an empty optionId clears that key and its nested keys. An option that is not legal for the open select is rejected. Does not write HP, conditions, inventory, spells, or notes. Owner only. Saves companions with expected_updated_at.",
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        index: z.number().int().min(0),
        name: z.string().optional(),
        creatureId: z.number().int().optional(),
        choiceId: z.string().optional(),
        optionId: z.string().optional(),
        addAbilityIds: z.array(z.number().int()).optional(),
        removeAbilityIds: z.array(z.number().int()).optional(),
      },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const denied = requireOwner(userId(), loaded.data);
      if (denied) return denied;
      const hasChoice = args.choiceId !== undefined || args.optionId !== undefined;
      const adding = args.addAbilityIds ?? [];
      const removing = args.removeAbilityIds ?? [];
      if (args.name === undefined && args.creatureId === undefined && !hasChoice && adding.length === 0 && removing.length === 0) {
        return textResult("Pass name, creatureId, abilities, or a choice to update.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      if ((args.choiceId === undefined) !== (args.optionId === undefined)) {
        return textResult("choiceId and optionId are set together. An empty optionId clears the select.", { code: "VALIDATION_ERROR", retryable: false }, true);
      }
      const list = companionList(loaded.data);
      const current = asCreature(list[args.index]);
      if (!current) return textResult("No companion at that index.", { code: "NOT_FOUND", retryable: false }, true);
      let creature = current;
      if (args.creatureId !== undefined) {
        const catalog = await loadCatalogCreature(userId(), loaded.data, args.creatureId);
        if (!catalog.ok) return catalog.error;
        creature = catalog.creature;
      }
      if (args.name !== undefined) {
        const name = trimmedCompanionName(args.name);
        if (!name) return textResult("Companion name cannot be empty.", { code: "VALIDATION_ERROR", retryable: false }, true);
        creature = { ...creature, name };
      }
      if (adding.length || removing.length) {
        const sources = booksOf(loaded.data);
        for (const abilityId of adding) {
          const found = await fetchRow(userId(), "find-ability-block", abilityId, sources);
          if (!found.ok) return fail(found);
          if (!found.row) return textResult("Ability not found in the character's books.", { code: "NOT_FOUND", retryable: false, abilityId }, true);
          if (!inBooks(found.row, sources)) return textResult("Ability not found in the character's books.", { code: "NOT_IN_BOOKS", retryable: false, abilityId, content_source_id: found.row.content_source_id ?? null }, true);
        }
        const before = abilityIds(creature);
        if (removing.length && !removing.some((id) => before.includes(id)) && adding.length === 0 && args.name === undefined && args.creatureId === undefined && !hasChoice) {
          return textResult("That ability is not on this companion.", { code: "NOT_FOUND", retryable: false }, true);
        }
        creature = withAbilities(creature, adding, removing);
      }
      if (args.choiceId !== undefined && args.optionId !== undefined) {
        const cleared = withSelections(creature, selectionsWithout(selectionsOf(creature), args.choiceId));
        if (args.optionId === "") {
          creature = cleared;
        } else {
          let choices: OpenChoice[];
          try {
            choices = await listCompanionChoices(loaded.data, cleared, args.index, userId());
          } catch (error) {
            return thrown(error);
          }
          const choice = choices.find((item) => item.id === args.choiceId);
          if (!choice) return textResult("That choice is not open.", { code: "NOT_FOUND", retryable: false }, true);
          if (!choice.options.some((option) => option.id === args.optionId)) {
            return textResult("That option is not legal for this choice.", { code: "VALIDATION_ERROR", retryable: false }, true);
          }
          creature = withSelections(cleared, { ...selectionsOf(cleared), [args.choiceId]: args.optionId });
        }
      }
      const next = list.map((item, index) => index === args.index ? creature : item);
      const saved = await saveRow(userId(), loaded.data, { companions: companionsRecord(loaded.data, next) });
      if (!saved.ok) return fail(saved);
      const shown = await present(userId(), saved.data);
      if (!shown.ok) return shown.error;
      return textResult("Companion saved", { characterId: args.characterId, index: args.index, companions: shown.companions });
    },
  );

  server.registerTool(
    "remove_companion",
    {
      title: "Remove companion",
      description: "Removes companions.list[index], the same filter the Companions panel uses on delete. Later entries shift down, matching COMPANION_<index>. Owner only. Saves companions with expected_updated_at.",
      annotations: writes,
      inputSchema: { characterId: z.number().int(), index: z.number().int().min(0) },
    },
    async (args) => {
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const denied = requireOwner(userId(), loaded.data);
      if (denied) return denied;
      const list = companionList(loaded.data);
      if (!asCreature(list[args.index])) return textResult("No companion at that index.", { code: "NOT_FOUND", retryable: false }, true);
      const next = list.filter((_, index) => index !== args.index);
      const saved = await saveRow(userId(), loaded.data, { companions: companionsRecord(loaded.data, next) });
      if (!saved.ok) return fail(saved);
      const shown = await present(userId(), saved.data);
      if (!shown.ok) return shown.error;
      return textResult("Companion removed", { characterId: args.characterId, companions: shown.companions });
    },
  );
}
