import { createHmac } from "node:crypto";

import { mergePlayerDiceRollLog, mergePlayerDiceRollState } from "./dice-merge.js";
import { setEncounterReader, type ActionResult, type CharacterExport, type CombatantRow, type CombatantSheet, type EncounterReader, type EncounterRecord } from "./reader.js";

import { readLiveStatBlock } from "./stat-block.js";

type Json = Record<string, unknown>;

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function baseUrl() {
  return env("SUPABASE_URL").replace(/\/$/, "");
}

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function adminUser(userId: string) {
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` },
  });
  if (!response.ok) throw new Error("EXTENSION");
  return (await response.json()) as { id?: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
}

function displayName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const meta = user.user_metadata ?? {};
  const named = [meta.display_name, meta.name, meta.full_name].find((value) => typeof value === "string" && value.trim());
  if (typeof named === "string") return named.trim();
  const email = user.email?.split("@")[0]?.trim();
  return email || "Unknown User";
}

async function contentRows(name: string, ids: number[]) {
  const unique = [...new Set(ids)].filter((id) => id > 0).slice(0, 300);
  if (!unique.length) return [];
  const response = await fetch(`${baseUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: unique }),
  });
  if (!response.ok) {
    console.error(`[wgui-mcp] ${name} status=${response.status} ids=${unique.length}`);
    return [];
  }
  const payload = (await response.json()) as { status?: string; data?: unknown };
  const data = Array.isArray(payload) ? payload : payload.data;
  return Array.isArray(data) ? (data as Json[]) : [];
}

function optionKey(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function label(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/-/g, "_").replace(/[^A-Z_\s]/g, "").replace(/\s+/g, "_");
}

type SpellGrant = { spellId: number; type: string; rank?: number; source?: string; tradition?: string; casts?: number };

function scanVariables(entity: Json, blocks: Json[]) {
  const details = (entity.details as Json | undefined) ?? {};
  const classes = [details.class, details.class_2].filter(Boolean) as Json[];
  const values = new Map<string, unknown>([
    ["LEVEL", num(entity.level) ?? 0],
    ["CLASS_NAMES", classes.map((row) => String(row.name ?? ""))],
    ["CLASS_IDS", classes.map((row) => String(row.id ?? ""))],
    ["ACTIVE_MODES", (entity.meta_data as Json | undefined)?.active_modes ?? []],
  ]);
  for (const [type, prefix] of [["feat", "FEAT"], ["class-feature", "CLASS_FEATURE"], ["mode", "MODE"]]) {
    const rows = blocks.filter((block) => block.type === type);
    values.set(`${prefix}_IDS`, rows.map((row) => String(row.id)));
    values.set(`${prefix}_NAMES`, rows.map((row) => String(row.name ?? "")));
  }
  return values;
}

// Mirrors the sheet's runConditional comparisons for values available without
// preparing the entire character store. Unknown variables are reported, not guessed.
function checkCondition(check: Json, values: Map<string, unknown>): boolean | undefined {
  if (!values.has(String(check.name))) return undefined;
  const value = values.get(String(check.name));
  const expected = check.value;
  if (typeof value === "number") {
    const right = num(expected);
    if (right === undefined) return undefined;
    switch (check.operator) {
      case "EQUALS": return value === right;
      case "NOT_EQUALS": return value !== right;
      case "GREATER_THAN": return value > right;
      case "LESS_THAN": return value < right;
      case "GREATER_THAN_OR_EQUALS": return value >= right;
      case "LESS_THAN_OR_EQUALS": return value <= right;
    }
  } else if (Array.isArray(value)) {
    if (check.operator === "INCLUDES") return value.some((item) => label(item) === label(expected));
    if (check.operator === "NOT_INCLUDES") return !value.some((item) => label(item) === label(expected));
  } else if (typeof value === "string") {
    if (check.operator === "EQUALS") return label(value) === label(expected);
    if (check.operator === "NOT_EQUALS") return label(value) !== label(expected);
    if (check.operator === "INCLUDES") return label(value).includes(label(expected));
    if (check.operator === "NOT_INCLUDES") return !label(value).includes(label(expected));
  } else if (typeof value === "boolean") {
    if (check.operator === "EQUALS") return value === (expected === "TRUE");
    if (check.operator === "NOT_EQUALS") return value !== (expected === "TRUE");
  }
  return undefined;
}

function chosenFrom(entity: Json, classFeatures: Json[] = [], values = scanVariables(entity, classFeatures)) {
  const selections = ((entity.operation_data as Json | undefined)?.selections ?? {}) as Record<string, string>;
  const blockIds = new Set<number>();
  for (const feature of classFeatures) {
    const id = num(feature.id);
    if (id && id > 0) blockIds.add(id);
  }
  // These roots are executed by the sheet outside the class's own operations.
  for (const path of Object.keys(selections)) {
    const root = /^(?:class-feature|ability)-(\d+)(?:_|$)/.exec(path);
    if (root) blockIds.add(Number(root[1]));
  }
  for (const id of Array.isArray(entity.abilities_added) ? entity.abilities_added : []) {
    const blockId = num(id);
    if (blockId && blockId > 0) blockIds.add(blockId);
  }
  const custom: { name: string; description?: string }[] = [];
  const grants: SpellGrant[] = [];
  const unresolvedConditions = new Set<string>();
  const seen = new Set<string>();
  function addSpell(data: Json) {
    const spellId = num(data.spellId);
    if (!spellId || spellId <= 0 || !["NORMAL", "FOCUS", "INNATE"].includes(String(data.type))) return;
    const grant = { spellId, type: String(data.type), rank: num(data.rank),
      source: typeof data.castingSource === "string" ? data.castingSource : undefined,
      tradition: typeof data.tradition === "string" ? data.tradition : undefined, casts: num(data.casts) };
    if (!grants.some((item) => item.spellId === grant.spellId && item.type === grant.type && item.source === grant.source && item.rank === grant.rank)) grants.push(grant);
  }
  function walk(value: unknown, active: boolean, depth: number) {
    if (!active || depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, true, depth + 1);
      return;
    }
    const row = value as Json;
    if (row.type === "conditional") {
      const data = row.data as Json | undefined;
      const checks = Array.isArray(data?.conditions) ? data.conditions as Json[] : [];
      const results = checks.map((check) => checkCondition(check, values));
      if (results.includes(false)) walk(data?.falseOperations, true, depth + 1);
      else if (results.includes(undefined)) {
        for (const [index, check] of checks.entries()) if (results[index] === undefined) unresolvedConditions.add(String(check.name));
      } else walk(data?.trueOperations, true, depth + 1);
      return;
    }
    if (["createValue", "setValue", "adjValue"].includes(String(row.type))) {
      const data = row.data as Json | undefined;
      if (typeof data?.variable === "string") {
        const value = data.value;
        if (["string", "number", "boolean"].includes(typeof value) || Array.isArray(value)) {
          // Arithmetic expressions need the full variable engine; don't pretend
          // that the expression string is its computed value.
          if (!(typeof value === "string" && /[()+*/]/.test(value))) {
            const old = values.get(data.variable);
            values.set(data.variable, row.type === "adjValue" && typeof old === "number" && typeof value === "number" ? old + value : value);
          }
        }
      }
    }
    if (row.type === "select") {
      const data = row.data as Json | undefined;
      const options = Array.isArray(data?.optionsPredefined) ? data.optionsPredefined : [];
      const selectedValues = new Set(Object.entries(selections)
        .filter(([key]) => typeof row.id === "string" && (key === row.id || key.endsWith(`_${row.id}`)))
        .map(([, value]) => String(value)));
      for (const option of options) {
        if (!option || typeof option !== "object") continue;
        const picked = option as Json;
        if (data?.optionType !== "SPELL") walk(picked, selectedValues.has(optionKey(picked.id)), depth + 1);
      }
      const filters = data?.optionsFilters as Json | undefined;
      const spellData = filters?.spellData as Json | undefined;
      for (const value of selectedValues) {
        const selected = num(value);
        if (data?.optionType === "ABILITY_BLOCK" && data.modeType !== "PREDEFINED" && selected) blockIds.add(selected);
        if (data?.optionType === "SPELL") {
          const option = options.find((item) => item && typeof item === "object" && optionKey((item as Json).id) === value) as Json | undefined;
          const grant = (option?.operation as Json | undefined)?.data as Json | undefined;
          // OG getSpellPredefinedList applies the first option's metadata to
          // every spell; the selected option supplies only the spell ID.
          const first = ((options[0] as Json | undefined)?.operation as Json | undefined)?.data as Json | undefined;
          addSpell({ ...(data.modeType === "PREDEFINED" ? first : spellData), spellId: data.modeType === "PREDEFINED" ? grant?.spellId : selected });
        }
      }
      return;
    }
    if (row.type === "CUSTOM" && typeof row.title === "string" && !seen.has(row.title)) {
      seen.add(row.title);
      custom.push({ name: row.title, description: typeof row.description === "string" ? row.description : undefined });
    }
    if (row.type === "giveAbilityBlock") {
      const id = num((row.data as Json | undefined)?.abilityBlockId);
      if (id && id > 0) blockIds.add(id);
    }
    if (row.type === "SPELL") {
      const meta = row._meta_data as Json | undefined;
      if (meta) addSpell({ ...meta, spellId: row.id });
    }
    if (row.type === "giveSpell") {
      const data = row.data as Json | undefined;
      if (data) addSpell(data);
    }
    for (const child of Object.values(row)) walk(child, true, depth + 1);
  }
  walk(entity.custom_operations, true, 0);
  const details = entity.details as Json | undefined;
  for (const key of ["class", "class_2", "ancestry", "background", "class_archetype", "class_archetype_2"]) {
    walk((details?.[key] as Json | undefined)?.operations, true, 0);
  }
  return { blockIds, custom, grants, focus: grants.filter((grant) => grant.type === "FOCUS"), unresolvedConditions };
}

function scanEntity(entity: Json, classFeatures: Json[], blocks: Json[]) {
  const byId = new Map(blocks.map((block) => [num(block.id), block]));
  let known = classFeatures;
  let previous = "";
  for (let pass = 0; ; pass += 1) {
    const values = scanVariables(entity, known);
    const result = chosenFrom(entity, classFeatures, values);
    const queue = [...result.blockIds];
    const seen = new Set<number>();
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      const block = byId.get(id);
      if (block?.type === "class-feature" && (num(block.level) ?? 0) > (num(entity.level) ?? 0)) continue;
      seen.add(id);
      if (!block) continue;
      // Granting a mode makes it available; only toggled modes execute.
      if (block.type === "mode" && !(values.get("ACTIVE_MODES") as unknown[]).some((mode) => label(mode) === label(block.name))) continue;
      const nested = chosenFrom({ operation_data: entity.operation_data, custom_operations: block.operations }, [], values);
      result.grants.push(...nested.grants);
      result.custom.push(...nested.custom);
      for (const name of nested.unresolvedConditions) result.unresolvedConditions.add(name);
      queue.push(...nested.blockIds);
    }
    result.blockIds = seen;
    result.focus = result.grants.filter((grant) => grant.type === "FOCUS");
    const signature = JSON.stringify([[...seen].sort(), result.grants]);
    const stable = signature === previous;
    if (stable || pass >= blocks.length + 1) return { ...result, passes: pass + 1, stable };
    previous = signature;
    known = [...seen].flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  }
}

async function hydrateSources(entity: Json) {
  const details = { ...((entity.details as Json | undefined) ?? {}) };
  const sources: [string, string][] = [
    ["class", "find-class"],
    ["class_2", "find-class"],
    ["ancestry", "find-ancestry"],
    ["background", "find-background"],
    ["class_archetype", "find-class-archetype"],
    ["class_archetype_2", "find-class-archetype"],
  ];
  for (const [key, name] of sources) {
    const stored = details[key] as Json | undefined;
    const id = num(stored?.id);
    if (!id) continue;
    const rows = await contentRows(name, [id]);
    const fresh = rows.find((row) => num(row.id) === id) ?? rows[0];
    const storedOps = Array.isArray(stored?.operations) ? stored.operations : [];
    if (!fresh) continue;
    const freshOps = Array.isArray(fresh.operations) ? fresh.operations : [];
    details[key] = { ...stored, ...fresh, operations: Array.isArray(fresh.operations) ? freshOps : storedOps };
  }
  return { ...entity, details };
}

function spellIdsOf(entity: Json) {
  const spells = entity.spells as Json | undefined;
  const list = Array.isArray(spells?.list) ? (spells.list as Json[]) : [];
  const innate = Array.isArray(spells?.innate_casts) ? (spells.innate_casts as Json[]) : [];
  return [...list, ...innate].flatMap((entry) => {
    const id = num(entry.spell_id);
    return id ? [id] : [];
  });
}

function sameUser(left: unknown, right: string) {
  return String(left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

function fail<T>(code: string, message: string): ActionResult<T> {
  return { ok: false, code, message };
}

async function restWrite(method: "POST" | "PATCH", path: string, body: unknown): Promise<Json[]> {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${baseUrl()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      Accept: "application/json",
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 409) return [];
  if (!response.ok) throw new Error("EXTENSION");
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? (payload as Json[]) : [];
}

async function rest(path: string): Promise<Json[]> {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${baseUrl()}/rest/v1/${path}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("EXTENSION");
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as Json[]) : [];
}

async function classFeaturesOf(entity: Json) {
  const details = entity.details as Json | undefined;
  const features = new Map<number, Json>();
  for (const [classKey, archetypeKey] of [["class", "class_archetype"], ["class_2", "class_archetype_2"]]) {
    const classRow = details?.[classKey] as Json | undefined;
    const traitId = num(classRow?.trait_id);
    if (!traitId) continue;
    const level = num(entity.level) ?? 0;
    // The sheet runs every eligible class feature, including automatic grants
    // which never appear in operation_data.selections.
    const rows = await rest(`ability_block?type=eq.class-feature&traits=cs.%7B${traitId}%7D&or=(level.lte.${level},level.is.null)&select=id,name,type,level,operations,actions,description`);
    const classFeatures = new Map(rows.map((row) => [num(row.id)!, row]));
    const archetype = details?.[archetypeKey] as Json | undefined;
    const adjustments = Array.isArray(archetype?.feature_adjustments) ? archetype.feature_adjustments as Json[] : [];
    for (const adjustment of adjustments) {
      if (adjustment.type === "REMOVE" || adjustment.type === "REPLACE") classFeatures.delete(num(adjustment.prev_id)!);
      const added = adjustment.data as Json | undefined;
      const id = num(added?.id);
      if ((adjustment.type === "ADD" || adjustment.type === "REPLACE") && added && id && (num(added.level) ?? 0) <= level) {
        classFeatures.set(id, added);
      }
    }
    for (const [id, feature] of classFeatures) features.set(id, feature);
  }
  return [...features.values()];
}

async function campaignAccess(userId: string, campaignId: number) {
  const campaigns = await rest(`campaign?id=eq.${campaignId}&select=id,user_id`);
  const campaign = campaigns[0];
  if (!campaign) return null;
  const mine = await rest(`character?campaign_id=eq.${campaignId}&user_id=eq.${userId}&select=id`);
  const isGm = String(campaign.user_id ?? "").trim().toLowerCase() === userId.trim().toLowerCase();
  if (!isGm && mine.length === 0) return null;
  return { isGm, characterIds: new Set(mine.map((row) => num(row.id)).filter((id): id is number => id !== undefined)) };
}

function includesCharacter(encounter: Json, characterIds: Set<number>) {
  const list = ((encounter.combatants as Json | undefined)?.list as Json[] | undefined) ?? [];
  return list.some((combatant) => {
    if (combatant.type && combatant.type !== "CHARACTER") return false;
    const id = characterIdOf(combatant);
    return id !== undefined && characterIds.has(id);
  });
}

async function encountersFor(userId: string, campaignId: number, encounterId?: number) {
  const access = await campaignAccess(userId, campaignId);
  if (!access) return [];
  const filter = encounterId === undefined ? "" : `&id=eq.${encounterId}`;
  const rows = await rest(`encounter?campaign_id=eq.${campaignId}${filter}&select=*&order=id.asc`);
  return access.isGm ? rows : rows.filter((row) => includesCharacter(row, access.characterIds));
}

function characterIdOf(combatant: Json) {
  const data = combatant.data as Json | undefined;
  return num(combatant.character)
    ?? num(combatant.character_id)
    ?? num(combatant.characterId)
    ?? num(data?.id)
    ?? num(data?.character)
    ?? num(data?.character_id)
    ?? num(data?.characterId);
}

function entityOf(combatant: Json): Json {
  if (combatant.type === "CHARACTER") return (combatant.data as Json) ?? {};
  return (combatant.creature as Json) ?? (combatant.data as Json) ?? {};
}

async function encounterCharacters(raw: Json) {
  const list = ((raw.combatants as Json | undefined)?.list as Json[] | undefined) ?? [];
  const ids = [...new Set(list.map(characterIdOf).filter((id): id is number => id !== undefined))];
  if (!ids.length) return [];
  return rest(`character?id=in.(${ids.join(",")})&select=*`);
}

function plainNote(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const row = value as Json;
  const text = typeof row.text === "string" ? row.text : "";
  const content = Array.isArray(row.content) ? row.content.map(plainNote).join("") : "";
  if (row.type === "paragraph") return `${text || content}\n\n`;
  if (row.type === "heading") return `### ${text || content}\n\n`;
  if (row.type === "hardBreak") return "\n";
  return text || content;
}

function notesOf(entity: Json) {
  if (typeof entity.notes === "string" && entity.notes.trim()) return entity.notes.trim();
  const notes = entity.notes as Json | undefined;
  const pages = Array.isArray(notes?.pages) ? notes.pages as Json[] : [];
  return pages.map((page) => {
    const name = typeof page.name === "string" ? page.name.trim() : "";
    const contents = plainNote(page.contents).trim();
    return [name, contents].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

function statsOf(entity: Json) {
  const meta = entity.meta_data as Json | undefined;
  return (meta?.calculated_stats as Json) ?? {};
}

function profsOf(entity: Json) {
  const profs = statsOf(entity).profs;
  if (!profs || typeof profs !== "object") return {} as Record<string, { total?: number; type?: string }>;
  return profs as Record<string, { total?: number; type?: string }>;
}

function profTotal(entity: Json, key: string) {
  const total = profsOf(entity)[key]?.total;
  return typeof total === "number" ? total : undefined;
}

function dcTotal(entity: Json, key: string) {
  const total = profTotal(entity, key);
  return total === undefined ? undefined : 10 + total;
}

function conditionsOf(entity: Json) {
  const details = entity.details as Json | undefined;
  const list = details?.conditions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Json;
    const name = typeof row.name === "string" ? row.name : "";
    if (!name) return [];
    const value = num(row.value);
    return [{ name, ...(value === undefined ? {} : { value }) }];
  });
}

function mapCombatant(combatant: Json, characters: Json[]): CombatantRow | null {
  if (combatant.type === "HAZARD") return null;
  const id = typeof combatant._id === "string" ? combatant._id : "";
  if (!id) return null;
  const kind = combatant.type === "CHARACTER" ? "character" : "creature";
  const characterId = characterIdOf(combatant);
  const live = kind === "character" ? characters.find((row) => num(row.id) === characterId) : undefined;
  const entity = live ?? entityOf(combatant);
  const stats = statsOf(entity);
  const hpMax = num(stats.hp_max) ?? num(entity.hp_max) ?? 0;
  const hpCurrent = num(entity.hp_current) ?? hpMax;
  // The GM can mark a combatant out without changing its last recorded HP.
  // Match isCombatantOut in the UI instead of inferring life/death from HP alone.
  const out = combatant.out === "dead" || combatant.out === "incapacitated" ? combatant.out : undefined;
  return {
    id,
    name: typeof entity.name === "string" ? entity.name : "Unnamed",
    side: combatant.ally === true || kind === "character" ? "ally" : "enemy",
    level: num(entity.level),
    kind,
    initiative: num(combatant.initiative),
    conditions: conditionsOf(entity),
    ac: num(stats.ac),
    fortitude: profTotal(entity, "SAVE_FORT"),
    reflex: profTotal(entity, "SAVE_REFLEX"),
    will: profTotal(entity, "SAVE_WILL"),
    hpCurrent,
    hpMax: hpMax || hpCurrent,
    place: out || hpCurrent <= 0 ? "down" : "fighting",
    out,
  };
}

function actionCount(value: unknown) {
  if (typeof value === "number") return value;
  if (value === "FREE-ACTION") return 0;
  if (value === "ONE-ACTION") return 1;
  if (value === "TWO-ACTIONS") return 2;
  if (value === "THREE-ACTIONS") return 3;
  return null;
}

type FeatSection = "class" | "ancestry" | "general" | "other";

function featSection(entity: Json, ability: Json): FeatSection {
  const traits = Array.isArray(ability.traits)
    ? (ability.traits as unknown[]).map(num).filter((id): id is number => id !== undefined)
    : [];
  const details = (entity.details as Json | undefined) ?? {};
  const classTraits = [details.class, details.class_2]
    .map((value) => num((value as Json | undefined)?.trait_id))
    .filter((id): id is number => id !== undefined);
  const ancestryTrait = num(((details.ancestry as Json | undefined)?.trait_id));
  if (traits.some((id) => classTraits.includes(id))) return "class";
  if (ancestryTrait !== undefined && traits.includes(ancestryTrait)) return "ancestry";
  if (traits.includes(1437) || traits.includes(1438)) return "general";
  return "other";
}

function abilityRows(entity: Json) {
  const base = Array.isArray(entity.abilities_base) ? (entity.abilities_base as Json[]) : [];
  return base.flatMap((ability) => {
    const name = typeof ability.name === "string" ? ability.name : "";
    if (!name) return [];
    return [{
      type: typeof ability.type === "string" ? ability.type : "",
      name,
      actions: actionCount(ability.actions),
      description: typeof ability.description === "string" ? ability.description : undefined,
      level: num(ability.level),
      traits: Array.isArray(ability.traits) ? ability.traits : [],
    }];
  });
}

function sheetFor(entity: Json): CombatantSheet {
  const abilities = abilityRows(entity);
  const attacks = abilities.filter((ability) => ability.type === "action");
  const feats = abilities.filter((ability) => ability.type === "feat");
  const features = abilities.filter((ability) => ability.type === "class-feature" || ability.type === "physical-feature");
  const groups = [];
  if (attacks.length) {
    groups.push({
      id: "weapon-attacks",
      label: "Weapon Attacks",
      actions: attacks.map(({ name, actions, description }) => ({ name, actions, description })),
    });
  }
  const featActions = feats.filter((ability) => ability.actions !== null);
  if (featActions.length) {
    groups.push({
      id: "feats",
      label: "Feats (with Actions)",
      actions: featActions.map(({ name, actions, description }) => ({ name, actions, description })),
    });
  }
  const profs = profsOf(entity);
  const skills = Object.entries(profs).flatMap(([key, prof]) => {
    if (!key.startsWith("SKILL_") || key === "SKILL_LORE____") return [];
    const name = key.slice("SKILL_".length).toLowerCase().replaceAll("_", " ");
    return [{ name, modifier: typeof prof.total === "number" ? prof.total : undefined, proficiency: prof.type }];
  });
  const weapons = equippedWeapons(entity);
  if (weapons.length) {
    const existing = groups.find((group) => group.id === "weapon-attacks");
    if (existing) existing.actions.push(...weapons.filter((weapon) => !existing.actions.some((action) => action.name === weapon.name)));
    else groups.push({ id: "weapon-attacks", label: "Weapon Attacks", actions: weapons });
  }
  const details = entity.details as Json | undefined;
  const added = Array.isArray(entity.abilities_added) ? entity.abilities_added.length : 0;
  return {
    groups,
    feats: feats.map((ability) => ({ section: featSection(entity, ability), name: ability.name, level: ability.level, hasAction: ability.actions !== null })),
    classFeatures: features.map((ability) => ({ name: ability.name, level: ability.level })),
    skills,
    spells: [],
    perception: profTotal(entity, "PERCEPTION"),
    classDc: dcTotal(entity, "CLASS_DC"),
    abilityModifiers: Object.fromEntries(
      [
        ["strength", "ATTRIBUTE_STR"],
        ["dexterity", "ATTRIBUTE_DEX"],
        ["constitution", "ATTRIBUTE_CON"],
        ["intelligence", "ATTRIBUTE_INT"],
        ["wisdom", "ATTRIBUTE_WIS"],
        ["charisma", "ATTRIBUTE_CHA"],
      ].flatMap(([label, key]) => {
        const total = profTotal(entity, key);
        return total === undefined ? [] : [[label, total]];
      }),
    ),
    speeds: {
      land: profTotal(entity, "SPEED"),
      fly: profTotal(entity, "SPEED_FLY"),
      climb: profTotal(entity, "SPEED_CLIMB"),
      burrow: profTotal(entity, "SPEED_BURROW"),
    },
    inventory: entity.inventory ?? null,
    notes: [typeof details?.description === "string" ? details.description.trim() : "", notesOf(entity)]
      .filter(Boolean)
      .join("\\n\\n") || undefined,
    details: { storedAbilities: abilities.length, addedAbilityIds: added },
    sourceDetails: entity.details ?? null,
  };
}

function equippedWeapons(entity: Json) {
  const inventory = entity.inventory as Json | undefined;
  const items = Array.isArray(inventory?.items) ? (inventory.items as Json[]) : [];
  const found: { name: string; actions: number; description: string | undefined }[] = [];
  function walk(list: Json[]) {
    for (const entry of list) {
      if (Array.isArray(entry.container_contents)) walk(entry.container_contents as Json[]);
      if (entry.is_equipped !== true) continue;
      const item = entry.item as Json | undefined;
      if (item?.group !== "WEAPON") continue;
      const meta = item.meta_data as Json | undefined;
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) continue;
      const damage = meta?.damage && typeof meta.damage === "object" ? (meta.damage as Json) : undefined;
      const dice = damage ? `${damage.dice ?? ""}${damage.die ?? ""}` : "";
      const parts = [
        dice,
        damage?.damageType ? String(damage.damageType) : "",
        meta?.range != null ? `range ${meta.range}` : "",
        meta?.reload ? `reload ${meta.reload}` : "",
        typeof meta?.attack_bonus === "number" ? `item bonus +${meta.attack_bonus}` : "",
      ].filter(Boolean);
      found.push({ name, actions: 1, description: parts.join(", ") || undefined });
    }
  }
  walk(items);
  return found;
}

function entitiesFor(raw: Json, characters: Json[]) {
  const list = ((raw.combatants as Json | undefined)?.list as Json[] | undefined) ?? [];
  const entities: Record<string, Json> = {};
  for (const row of list) {
    const mapped = mapCombatant(row, characters);
    if (!mapped) continue;
    const characterId = characterIdOf(row);
    const live = mapped.kind === "character" ? characters.find((item) => num(item.id) === characterId) : undefined;
    entities[mapped.id] = live ?? entityOf(row);
  }
  return entities;
}

function spellTradition(entity: Json, spell: Json | undefined, grant?: SpellGrant) {
  if (grant?.type === "FOCUS") return "focus";
  const catalogTradition = typeof spell?.tradition === "string" && spell.tradition.trim() ? spell.tradition : undefined;
  if (catalogTradition) return catalogTradition;
  if (grant?.tradition) return grant.tradition;
  const details = (entity.details as Json | undefined) ?? {};
  const classNames = [details.class, details.class_2]
    .map((value) => typeof value === "object" && value ? (value as Json).name : undefined)
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim().toUpperCase());
  if (grant?.source && !classNames.includes(grant.source.trim().toUpperCase())) return grant.source;
  return undefined;
}

function applyCatalog(record: EncounterRecord, entities: Record<string, Json>, blocks: Json[], spellRows: Json[], classFeatures: Record<string, Json[]>) {
  const blockById = new Map(blocks.flatMap((row) => {
    const id = num(row.id);
    return id ? [[id, row] as const] : [];
  }));
  const spellById = new Map(spellRows.flatMap((row) => {
    const id = num(row.id);
    return id ? [[id, row] as const] : [];
  }));
  for (const [id, entity] of Object.entries(entities)) {
    const sheet = record.sheets[id];
    if (!sheet) continue;
    const chosen = scanEntity(entity, classFeatures[id] ?? [], blocks);
    const wanted = chosen.blockIds;
    const resolved = [...wanted].flatMap((blockId) => {
      const row = blockById.get(blockId);
      if (!row || typeof row.name !== "string") return [];
      return [{
        type: typeof row.type === "string" ? row.type : "",
        name: row.name,
        actions: actionCount(row.actions),
        actionCost: typeof row.actions === "string" ? row.actions : undefined,
        description: typeof row.description === "string" ? row.description : undefined,
        level: num(row.level),
        traits: Array.isArray(row.traits) ? row.traits : [],
      }];
    });
    const attacks = resolved.filter((ability) => ability.type === "action");
    const feats = resolved.filter((ability) => ability.type === "feat");
    const features = resolved.filter((ability) => ability.type === "class-feature" || ability.type === "physical-feature");
    if (attacks.length) {
      const existing = sheet.groups.find((group) => group.id === "weapon-attacks");
      const actions = attacks.map(({ name, actions, actionCost, description }) => ({ name, actions, actionCost, description }));
      if (existing) existing.actions.push(...actions.filter((action) => !existing.actions.some((item) => item.name === action.name)));
      else sheet.groups.push({
        id: "weapon-attacks",
        label: "Weapon Attacks",
        actions,
      });
    }
    const featActions = feats.filter((ability) => ability.actionCost !== undefined || ability.actions !== null).map(({ name, actions, actionCost, description }) => ({ name, actions, actionCost, description }));
    if (featActions.length) {
      const existing = sheet.groups.find((group) => group.id === "feats");
      if (existing) existing.actions.push(...featActions.filter((ability) => !existing.actions.some((item) => item.name === ability.name)));
      else sheet.groups.push({ id: "feats", label: "Feats (with Actions)", actions: featActions });
    }
    // Catalog lookups enrich embedded encounter data; an empty or partial lookup
    // must not erase already-present feats and class features.
    const resolvedFeats = feats.map((ability) => ({ section: featSection(entity, ability), name: ability.name, level: ability.level, hasAction: ability.actionCost !== undefined || ability.actions !== null }));
    sheet.feats = [...sheet.feats.filter((feat) => !resolvedFeats.some((item) => item.name === feat.name)), ...resolvedFeats];
    const resolvedFeatures = features.map((ability) => ({ name: ability.name, level: ability.level }));
    sheet.classFeatures = [...sheet.classFeatures.filter((feature) => !resolvedFeatures.some((item) => item.name === feature.name)), ...resolvedFeatures];
    const classAbilities = [
      ...feats.filter((ability) => ability.actionCost === undefined && ability.actions === null),
      ...chosen.custom.map((choice) => ({ ...choice, actions: null })),
    ];
    if (classAbilities.length) sheet.groups.push({ id: "class-abilities", label: "Class Abilities", actions: classAbilities });
    const spellBook = entity.spells as Json | undefined;
    const entries = Array.isArray(spellBook?.list) ? (spellBook.list as Json[]) : [];
    const slots = Array.isArray(spellBook?.slots) ? (spellBook.slots as Json[]) : [];
    const attack = profTotal(entity, "SPELL_ATTACK");
    const dc = dcTotal(entity, "SPELL_DC");
    sheet.spells = entries.flatMap((entry) => {
      const spellId = num(entry.spell_id);
      const spell = spellById.get(spellId ?? -1);
      const name = typeof spell?.name === "string" ? spell.name : spellId ? `Spell ${spellId}` : "";
      if (!name) return [];
      const rank = num(entry.rank);
      const rankSlots = slots.filter((slot) => num(slot.rank) === rank && slot.source === entry.source);
      const mine = slots.filter((slot) => num(slot.spell_id) === spellId);
      const spent = mine.filter((slot) => slot.exhausted === true).length;
      return [{
        name,
        rank,
        tradition: spellTradition(entity, spell),
        max: rankSlots.length || undefined,
        spent: spent || undefined,
        prepared: mine.length > 0,
        attack,
        dc,
      }];
    });
    const grants = chosen.grants;
    for (const grant of grants) {
      const spell = spellById.get(grant.spellId);
      const name = typeof spell?.name === "string" ? spell.name : `Spell ${grant.spellId}`;
      const tradition = spellTradition(entity, spell, grant);
      const existing = sheet.spells.find((entry) => entry.name === name && (grant.type === "NORMAL" ? entry.tradition === undefined || entry.tradition === tradition : entry.tradition === tradition));
      if (existing) { if (tradition) existing.tradition = tradition; continue; }
      const innate = Array.isArray(spellBook?.innate_casts) ? (spellBook.innate_casts as Json[]).find((row) => num(row.spell_id) === grant.spellId) : undefined;
      sheet.spells.push({ name, rank: grant.rank ?? num(spell?.rank), tradition, attack, dc,
        ...(grant.type === "INNATE" ? { max: grant.casts, spent: num(innate?.casts_current) ?? 0 } : {}) });
    }
    const classRow = (entity.details as Json | undefined)?.class as Json | undefined;
    const selections = ((entity.operation_data as Json | undefined)?.selections ?? {}) as Record<string, string>;
    const operations = Array.isArray(classRow?.operations) ? (classRow.operations as Json[]) : [];
    const selects: Json[] = [];
    function findSelects(value: unknown, depth: number) {
      if (!value || typeof value !== "object" || depth > 8 || selects.length > 20) return;
      if (Array.isArray(value)) {
        for (const item of value) findSelects(item, depth + 1);
        return;
      }
      const row = value as Json;
      if (row.type === "select") {
        const data = row.data as Json | undefined;
        const filters = data?.optionsFilters as Json | undefined;
        const spellData = filters?.spellData as Json | undefined;
        selects.push({
          id: typeof row.id === "string" ? row.id : null,
          optionType: data?.optionType ?? null,
          mode: data?.modeType ?? null,
          title: data?.title ?? null,
          spellType: spellData?.type ?? null,
          castingSource: spellData?.castingSource ?? null,
        });
      }
      for (const child of Object.values(row)) findSelects(child, depth + 1);
    }
    findSelects(operations, 0);
    sheet.details = {
      reader: "focus-scan",
      revision: "class-operation-grants-v3",
      classId: num(classRow?.id) ?? null,
      className: typeof classRow?.name === "string" ? classRow.name : null,
      classOperations: operations.length,
      operationTypes: operations.map((op) => op.type ?? null),
      selects,
      selectionCount: Object.keys(selections).length,
      blocksWalked: chosen.blockIds.size,
      scanPasses: chosen.passes,
      scanStable: chosen.stable,
      unresolvedConditions: [...chosen.unresolvedConditions],
      classFeatureIds: (classFeatures[id] ?? []).map((row) => row.id),
      focusSpellIds: [...new Set(chosen.focus.map((grant) => grant.spellId))],
      spellIds: spellIdsOf(entity).length,
    };
  }
}

function mapEncounter(raw: Json, characters: Json[]): EncounterRecord {
  const list = ((raw.combatants as Json | undefined)?.list as Json[] | undefined) ?? [];
  const meta = (raw.meta_data as Json | undefined) ?? {};
  const roundLog = Array.isArray(meta.initiative_log) ? meta.initiative_log : [];
  const diceRows = Array.isArray(meta.dice_roll_log) ? (meta.dice_roll_log as Json[]) : [];
  const diceState = meta.dice_roll_state && typeof meta.dice_roll_state === "object" ? (meta.dice_roll_state as Json) : null;
  const combatants = list.flatMap((row) => {
    const mapped = mapCombatant(row, characters);
    return mapped ? [mapped] : [];
  });
  const sheets: Record<string, CombatantSheet> = {};
  for (const row of list) {
    const mapped = mapCombatant(row, characters);
    if (!mapped) continue;
    const characterId = characterIdOf(row);
    const live = mapped.kind === "character" ? characters.find((item) => num(item.id) === characterId) : undefined;
    sheets[mapped.id] = sheetFor(live ?? entityOf(row));
  }
  return {
    campaignId: num(raw.campaign_id) ?? 0,
    encounterId: num(raw.id) ?? 0,
    name: typeof raw.name === "string" ? raw.name : "Encounter",
    round: Math.max(1, roundLog.length || num(meta.round) || 1),
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty : undefined,
    xp: num(raw.xp),
    combatants,
    roundLog: [],
    diceState,
    diceLog: diceRows.map((row) => ({
      title: typeof row.title === "string" ? row.title : undefined,
      dc: num(row.dc),
      stat: typeof row.defaultStat === "string" ? row.defaultStat : undefined,
      result: Array.isArray(row.entries) ? `${row.entries.length} rolls` : undefined,
    })),
    sheets,
  };
}

export function createSupabaseReader(readStats = readLiveStatBlock): EncounterReader {
  return {
    async profile(userId) {
      const user = await adminUser(userId);
      return { id: user.id ?? userId, email: user.email ?? null, name: null };
    },
    async listEncounters(userId, campaignId) {
      const rows = await encountersFor(userId, campaignId);
      return rows.map((encounter) => {
        const list = ((encounter.combatants as Json | undefined)?.list as unknown[] | undefined) ?? [];
        return {
          id: num(encounter.id) ?? 0,
          name: typeof encounter.name === "string" ? encounter.name : "Encounter",
          combatantCount: list.length,
        };
      });
    },
    async loadEncounter(userId, campaignId, encounterId, combatantId, includeStats = false) {
      const rows = await encountersFor(userId, campaignId, encounterId);
      if (!rows.length) return null;
      const characters = await encounterCharacters(rows[0]);
      const record = mapEncounter(rows[0], characters);
      const allEntities = entitiesFor(rows[0], characters);
      const entities = combatantId
        ? Object.fromEntries(Object.entries(allEntities).filter(([id]) => id === combatantId))
        : allEntities;
      for (const id of Object.keys(entities)) entities[id] = await hydrateSources(entities[id]);
      const classFeatures: Record<string, Json[]> = {};
      for (const [id, entity] of Object.entries(entities)) classFeatures[id] = await classFeaturesOf(entity);
      const blockIds = new Set<number>();
      const spellIds = new Set<number>();
      let customAbilities = 0;
      let focusSpells = 0;
      const blocks: Json[] = Object.values(classFeatures).flat();
      const requestedIds = new Set(blocks.map((block) => num(block.id)));
      while (true) {
        const more = new Set<number>();
        spellIds.clear();
        blockIds.clear();
        customAbilities = 0;
        focusSpells = 0;
        for (const [id, entity] of Object.entries(entities)) {
          const scan = scanEntity(entity, classFeatures[id], blocks);
          customAbilities += scan.custom.length;
          focusSpells += scan.focus.length;
          for (const blockId of scan.blockIds) {
            blockIds.add(blockId);
            if (!requestedIds.has(blockId)) more.add(blockId);
          }
          for (const spellId of spellIdsOf(entity)) spellIds.add(spellId);
          for (const grant of scan.grants) spellIds.add(grant.spellId);
        }
        if (!more.size) break;
        for (const id of more) requestedIds.add(id);
        blocks.push(...await contentRows("find-ability-block", [...more]));
      }
      const spellRows = await contentRows("find-spell", [...spellIds]);
      applyCatalog(record, entities, blocks, spellRows, classFeatures);
      console.error(`[wgui-mcp] encounter ${record.encounterId} combatants=${record.combatants.length} abilityIds=${blockIds.size} resolved=${blocks.length} custom=${customAbilities} focus=${focusSpells} spellIds=${spellIds.size} spells=${spellRows.length}`);
      if (includeStats) {
        for (const [id, entity] of Object.entries(entities)) {
          const row = record.combatants.find((item) => item.id === id);
          if (!row) continue;
          // Never turn calculation failures into misleading empty defense arrays.
          const stats = await readStats(entity, row.kind, id);
          Object.assign(record.sheets[id], stats.sheet);
          Object.assign(row, stats.row);
        }
      }
      return record;
    },
    async ensurePublicUser(userId) {
      const existing = await rest(`public_user?user_id=eq.${encodeURIComponent(userId)}&select=user_id,display_name`);
      if (existing[0]) {
        return { ok: true, data: { userId, displayName: String(existing[0].display_name ?? ""), created: false } };
      }
      const user = await adminUser(userId);
      const local = user.email?.split("@")[0]?.trim();
      const displayName = local || "Unknown User";
      const inserted = await restWrite("POST", "public_user", { user_id: userId, display_name: displayName });
      const row = inserted[0] ?? (await rest(`public_user?user_id=eq.${encodeURIComponent(userId)}&select=user_id,display_name`))[0];
      if (!row) return fail("PUBLIC_USER_CREATE_FAILED", "Could not create a user profile.");
      return { ok: true, data: { userId, displayName: String(row.display_name ?? displayName), created: true } };
    },
    async joinCampaign(userId, characterId, joinKey) {
      const key = joinKey.trim();
      if (!key) return fail("JOIN_KEY_REQUIRED", "Enter a join key.");
      const characters = await rest(`character?id=eq.${characterId}&select=id,user_id,campaign_id,name`);
      const character = characters[0];
      if (!character || !sameUser(character.user_id, userId)) return fail("CHARACTER_FORBIDDEN", "You do not have access to this character.");
      const campaigns = await rest(`campaign?join_key=eq.${encodeURIComponent(key)}&select=id,name,user_id`);
      const campaign = campaigns[0];
      if (!campaign || num(campaign.id) === undefined) return fail("JOIN_KEY_INVALID", "Invalid join key. Ask the GM for a valid key.");
      const campaignId = num(campaign.id)!;
      const already = num(character.campaign_id) === campaignId;
      if (!already) {
        await restWrite("PATCH", `character?id=eq.${characterId}&user_id=eq.${encodeURIComponent(userId)}`, { campaign_id: campaignId });
        const saved = (await rest(`character?id=eq.${characterId}&select=campaign_id`))[0];
        if (num(saved?.campaign_id) !== campaignId) return fail("JOIN_NOT_SAVED", "Could not add that character to the campaign.");
      }
      return { ok: true, data: { characterId, campaignId, campaignName: String(campaign.name ?? "Campaign"), already } };
    },
    async campaignOwnerContacts(userId, ownerIds) {
      const requested = [...new Set(ownerIds.map((id) => id.trim()).filter(Boolean))].slice(0, 24);
      if (!requested.length) return { ok: true, data: [] };
      const [owned, mine] = await Promise.all([
        rest(`campaign?user_id=eq.${encodeURIComponent(userId)}&select=id`),
        rest(`character?user_id=eq.${encodeURIComponent(userId)}&select=campaign_id`),
      ]);
      const ownedIds = new Set(owned.map((row) => num(row.id)).filter((id): id is number => id !== undefined));
      const joinedIds = new Set(mine.map((row) => num(row.campaign_id)).filter((id): id is number => id !== undefined));
      const contacts: { userId: string; email: string; displayName: string }[] = [];
      for (const ownerId of requested) {
        const campaigns = sameUser(ownerId, userId) ? [{ id: 0 }] : await rest(`campaign?user_id=eq.${encodeURIComponent(ownerId)}&select=id`);
        const allowed = sameUser(ownerId, userId) || campaigns.some((row) => {
          const id = num(row.id);
          return id !== undefined && (ownedIds.has(id) || joinedIds.has(id));
        });
        if (!allowed) continue;
        const user = await adminUser(ownerId);
        contacts.push({ userId: ownerId, email: user.email ?? "", displayName: displayName(user) });
      }
      return { ok: true, data: contacts };
    },
    async patchEncounterDice(userId, campaignId, encounterId, patch) {
      const hasState = patch.diceRollState !== undefined;
      const hasLog = patch.diceRollLog !== undefined;
      if (!hasState && !hasLog) return fail("DICE_PATCH_REQUIRED", "Send diceRollState, diceRollLog, or both.");
      const access = await campaignAccess(userId, campaignId);
      if (!access) return fail("CAMPAIGN_FORBIDDEN", "You do not have access to this campaign.");
      const rows = await rest(`encounter?id=eq.${encounterId}&select=id,campaign_id,meta_data,combatants`);
      const encounter = rows[0];
      if (!encounter || num(encounter.campaign_id) !== campaignId) return fail("ENCOUNTER_FORBIDDEN", "You do not have access to this encounter.");
      if (!access.isGm && !includesCharacter(encounter, access.characterIds)) return fail("ENCOUNTER_FORBIDDEN", "You do not have access to this encounter.");
      const meta = { ...((encounter.meta_data as Json | undefined) ?? {}) };
      if (hasState) {
        meta.dice_roll_state = access.isGm ? (patch.diceRollState ?? {}) : mergePlayerDiceRollState(meta.dice_roll_state, patch.diceRollState);
      }
      if (hasLog) {
        meta.dice_roll_log = access.isGm ? (patch.diceRollLog ?? []) : mergePlayerDiceRollLog(meta.dice_roll_log, patch.diceRollLog, userId);
      }
      await restWrite("PATCH", `encounter?id=eq.${encounterId}`, { meta_data: meta });
      return { ok: true, data: { diceRollState: meta.dice_roll_state ?? null, diceRollLog: Array.isArray(meta.dice_roll_log) ? meta.dice_roll_log : [] } };
    },
    async listCampaignCharacters(userId, campaignId) {
      const access = await campaignAccess(userId, campaignId);
      if (!access) return fail("CAMPAIGN_FORBIDDEN", "You do not have access to this campaign.");
      const rows = await rest(`character?campaign_id=eq.${campaignId}&select=id,name,level,details&order=id.asc`);
      return {
        ok: true,
        data: rows.map((row) => {
          const details = (row.details as Json | undefined) ?? {};
          const ancestry = details.ancestry as Json | undefined;
          const classRow = details.class as Json | undefined;
          return {
            id: num(row.id) ?? 0,
            name: typeof row.name === "string" ? row.name : "Character",
            level: num(row.level) ?? null,
            ancestry: typeof ancestry?.name === "string" ? ancestry.name : null,
            className: typeof classRow?.name === "string" ? classRow.name : null,
          };
        }),
      };
    },
    async exportCharacter(userId, characterId, format = "json"): Promise<ActionResult<CharacterExport>> {
      const rows = await rest(`character?id=eq.${characterId}&select=id,user_id,campaign_id`);
      const character = rows[0];
      if (!character) return fail("NOT_FOUND", "Character not found.");
      const owner = sameUser(character.user_id, userId);
      const campaignId = num(character.campaign_id);
      const access = campaignId === undefined ? null : await campaignAccess(userId, campaignId);
      if (!owner && !access?.isGm) return fail("CHARACTER_FORBIDDEN", "You do not have access to this character.");
      const secret = env("JWT_SECRET") || env("SB_JWT_SECRET");
      const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY");
      if (!secret && !serviceRole) return fail("INTERNAL_ERROR", "Character export is unavailable until JWT_SECRET or SUPABASE_SERVICE_ROLE_KEY is set on the MCP server.");
      // A user JWT is preferred. The service role is already on this server and the ownership check above has passed.
      const token = secret ? userJwt(userId, secret) : serviceRole;
      const response = await fetch(`${baseUrl()}/functions/v1/wgui-export-character`, {
        method: "POST",
        headers: {
          apikey: env("SUPABASE_ANON_KEY"),
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: characterId, format }),
      });
      if (!response.ok) return fail("INTERNAL_ERROR", "Character export failed.");
      if (format === "pdf") {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) return fail("INTERNAL_ERROR", "Character export returned an empty PDF.");
        return {
          ok: true,
          data: {
            format: "pdf",
            filename: `character-${characterId}.pdf`,
            mimeType: "application/pdf",
            base64: Buffer.from(bytes).toString("base64"),
          },
        };
      }
      const file = (await response.json()) as unknown;
      if (!file || typeof file !== "object" || Array.isArray(file)) return fail("INTERNAL_ERROR", "Character export did not return a file.");
      return { ok: true, data: { format: "json", file: file as Record<string, unknown> } };
    },
  };
}

function userJwt(userId: string, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iss: `${baseUrl()}/auth/v1`,
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function installSupabaseReader() {
  if (!env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY") || !env("SUPABASE_SERVICE_ROLE_KEY")) return false;
  setEncounterReader(createSupabaseReader());
  return true;
}
