import { setEncounterReader, type CombatantRow, type CombatantSheet, type EncounterReader, type EncounterRecord } from "./reader.js";

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
  return (await response.json()) as { id?: string; email?: string | null };
}

async function contentRows(name: string, ids: number[]) {
  const unique = [...new Set(ids)].filter((id) => id > 0).slice(0, 80);
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

function chosenFrom(entity: Json) {
  const selections = ((entity.operation_data as Json | undefined)?.selections ?? {}) as Record<string, string>;
  const chosenIds = new Set(Object.values(selections).map((value) => String(value)));
  const blockIds = new Set<number>();
  const custom: { name: string; description?: string }[] = [];
  const focus: { spellId: number; rank?: number; source?: string }[] = [];
  const seen = new Set<string>();
  function addFocus(spellId: number | undefined, rank: unknown, source: unknown) {
    if (!spellId || spellId <= 0 || focus.some((grant) => grant.spellId === spellId)) return;
    focus.push({ spellId, rank: num(rank), source: typeof source === "string" ? source : undefined });
  }
  function walk(value: unknown, active: boolean, depth: number) {
    if (!active || depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, true, depth + 1);
      return;
    }
    const row = value as Json;
    if (row.type === "select") {
      const data = row.data as Json | undefined;
      const options = Array.isArray(data?.optionsPredefined) ? data.optionsPredefined : [];
      for (const option of options) {
        if (!option || typeof option !== "object") continue;
        const picked = option as Json;
        walk(picked, chosenIds.has(optionKey(picked.id)), depth + 1);
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
      if (meta?.type === "FOCUS") addFocus(num(row.id), meta.rank, meta.castingSource);
    }
    if (row.type === "giveSpell") {
      const data = row.data as Json | undefined;
      if (data?.type === "FOCUS") addFocus(num(data.spellId), data.rank, data.castingSource);
    }
    for (const child of Object.values(row)) walk(child, true, depth + 1);
  }
  walk(entity.custom_operations, true, 0);
  const details = entity.details as Json | undefined;
  for (const key of ["class", "class_2", "ancestry", "background", "class_archetype", "class_archetype_2"]) {
    walk((details?.[key] as Json | undefined)?.operations, true, 0);
  }
  return { blockIds, custom, focus };
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

async function rest(path: string): Promise<Json[]> {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${baseUrl()}/rest/v1/${path}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("EXTENSION");
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as Json[]) : [];
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
    const id = num(combatant.character) ?? num((combatant.data as Json | undefined)?.id);
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

function entityOf(combatant: Json): Json {
  if (combatant.type === "CHARACTER") return (combatant.data as Json) ?? {};
  return (combatant.creature as Json) ?? (combatant.data as Json) ?? {};
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
  const characterId = num(combatant.character);
  const live = kind === "character" ? characters.find((row) => num(row.id) === characterId) : undefined;
  const entity = live ?? entityOf(combatant);
  const stats = statsOf(entity);
  const hpMax = num(stats.hp_max) ?? num(entity.hp_max) ?? 0;
  const hpCurrent = num(entity.hp_current) ?? hpMax;
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
    place: hpCurrent <= 0 ? "down" : "fighting",
  };
}

function actionCount(value: unknown) {
  if (typeof value === "number") return value;
  if (value === "ONE-ACTION") return 1;
  if (value === "TWO-ACTIONS") return 2;
  if (value === "THREE-ACTIONS") return 3;
  return null;
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
    feats: feats.map((ability) => ({ section: "other" as const, name: ability.name, level: ability.level, hasAction: ability.actions !== null })),
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
    notes: typeof details?.description === "string" ? details.description : undefined,
    details: { storedAbilities: abilities.length, addedAbilityIds: added },
  };
}

function equippedWeapons(entity: Json) {
  const inventory = entity.inventory as Json | undefined;
  const items = Array.isArray(inventory?.items) ? (inventory.items as Json[]) : [];
  const found: { name: string; actions: number; description?: string }[] = [];
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
    const characterId = num(row.character);
    const live = mapped.kind === "character" ? characters.find((item) => num(item.id) === characterId) : undefined;
    entities[mapped.id] = live ?? entityOf(row);
  }
  return entities;
}

function applyCatalog(record: EncounterRecord, entities: Record<string, Json>, blocks: Json[], spellRows: Json[]) {
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
    const chosen = chosenFrom(entity);
    const wanted = chosen.blockIds;
    const resolved = [...wanted].flatMap((blockId) => {
      const row = blockById.get(blockId);
      if (!row || typeof row.name !== "string") return [];
      return [{
        type: typeof row.type === "string" ? row.type : "",
        name: row.name,
        actions: actionCount(row.actions),
        description: typeof row.description === "string" ? row.description : undefined,
        level: num(row.level),
      }];
    });
    const attacks = resolved.filter((ability) => ability.type === "action");
    const feats = resolved.filter((ability) => ability.type === "feat");
    const features = resolved.filter((ability) => ability.type === "class-feature" || ability.type === "physical-feature");
    if (attacks.length && !sheet.groups.some((group) => group.id === "weapon-attacks")) {
      sheet.groups.push({
        id: "weapon-attacks",
        label: "Weapon Attacks",
        actions: attacks.map(({ name, actions, description }) => ({ name, actions, description })),
      });
    }
    const featActions = feats.filter((ability) => ability.actions !== null).map(({ name, actions, description }) => ({ name, actions, description }));
    if (featActions.length) {
      const existing = sheet.groups.find((group) => group.id === "feats");
      if (existing) existing.actions.push(...featActions.filter((ability) => !existing.actions.some((item) => item.name === ability.name)));
      else sheet.groups.push({ id: "feats", label: "Feats (with Actions)", actions: featActions });
    }
    sheet.feats = feats.map((ability) => ({ section: "other" as const, name: ability.name, level: ability.level, hasAction: ability.actions !== null }));
    sheet.classFeatures = features.map((ability) => ({ name: ability.name, level: ability.level }));
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
        max: rankSlots.length || undefined,
        spent: spent || undefined,
        prepared: mine.length > 0,
        attack,
        dc,
      }];
    });
    for (const grant of chosen.focus) {
      const spell = spellById.get(grant.spellId);
      const name = typeof spell?.name === "string" ? spell.name : `Spell ${grant.spellId}`;
      if (sheet.spells.some((entry) => entry.name === name)) continue;
      sheet.spells.push({ name, rank: grant.rank, tradition: grant.source ?? "focus", attack, dc });
    }
    sheet.details = {
      referencedAbilities: wanted.size,
      resolvedAbilities: resolved.length,
      customAbilities: chosen.custom.length,
      spellIds: spellIdsOf(entity).length,
    };
  }
}

function mapEncounter(raw: Json, characters: Json[]): EncounterRecord {
  const list = ((raw.combatants as Json | undefined)?.list as Json[] | undefined) ?? [];
  const meta = (raw.meta_data as Json | undefined) ?? {};
  const roundLog = Array.isArray(meta.initiative_log) ? meta.initiative_log : [];
  const combatants = list.flatMap((row) => {
    const mapped = mapCombatant(row, characters);
    return mapped ? [mapped] : [];
  });
  const sheets: Record<string, CombatantSheet> = {};
  for (const row of list) {
    const mapped = mapCombatant(row, characters);
    if (!mapped) continue;
    const characterId = num(row.character);
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
    diceLog: [],
    sheets,
  };
}

export function createSupabaseReader(): EncounterReader {
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
    async loadEncounter(userId, campaignId, encounterId) {
      const rows = await encountersFor(userId, campaignId, encounterId);
      if (!rows.length) return null;
      const characters = await rest(`character?campaign_id=eq.${campaignId}&select=*`);
      const record = mapEncounter(rows[0], characters);
      const entities = entitiesFor(rows[0], characters);
      const blockIds = new Set<number>();
      const spellIds = new Set<number>();
      let customAbilities = 0;
      let focusSpells = 0;
      for (const entity of Object.values(entities)) {
        const chosen = chosenFrom(entity);
        customAbilities += chosen.custom.length;
        focusSpells += chosen.focus.length;
        for (const id of chosen.blockIds) blockIds.add(id);
        for (const id of spellIdsOf(entity)) spellIds.add(id);
        for (const grant of chosen.focus) spellIds.add(grant.spellId);
      }
      const [blocks, spellRows] = await Promise.all([
        contentRows("find-ability-block", [...blockIds]),
        contentRows("find-spell", [...spellIds]),
      ]);
      applyCatalog(record, entities, blocks, spellRows);
      console.error(`[wgui-mcp] encounter ${record.encounterId} combatants=${record.combatants.length} abilityIds=${blockIds.size} resolved=${blocks.length} custom=${customAbilities} focus=${focusSpells} spellIds=${spellIds.size} spells=${spellRows.length}`);
      return record;
    },
  };
}

export function installSupabaseReader() {
  if (!env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY") || !env("SUPABASE_SERVICE_ROLE_KEY")) return false;
  setEncounterReader(createSupabaseReader());
  return true;
}
