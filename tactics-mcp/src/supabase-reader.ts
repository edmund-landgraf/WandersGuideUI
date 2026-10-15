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
    fortitude: num(stats.fortitude),
    reflex: num(stats.reflex),
    will: num(stats.will),
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
  const details = entity.details as Json | undefined;
  const added = Array.isArray(entity.abilities_added) ? entity.abilities_added.length : 0;
  return {
    groups,
    feats: feats.map((ability) => ({ section: "other" as const, name: ability.name, level: ability.level, hasAction: ability.actions !== null })),
    classFeatures: features.map((ability) => ({ name: ability.name, level: ability.level })),
    skills: [],
    spells: [],
    inventory: entity.inventory ?? null,
    notes: typeof details?.description === "string" ? details.description : undefined,
    details: { storedAbilities: abilities.length, addedAbilityIds: added },
  };
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
  const storedAbilities = Object.values(sheets).reduce((sum, sheet) => sum + sheet.groups.reduce((count, group) => count + group.actions.length, 0), 0);
  console.error(`[wgui-mcp] encounter ${num(raw.id) ?? 0} combatants=${combatants.length} storedActions=${storedAbilities}`);
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
      return mapEncounter(rows[0], characters);
    },
  };
}

export function installSupabaseReader() {
  if (!env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY") || !env("SUPABASE_SERVICE_ROLE_KEY")) return false;
  setEncounterReader(createSupabaseReader());
  return true;
}
