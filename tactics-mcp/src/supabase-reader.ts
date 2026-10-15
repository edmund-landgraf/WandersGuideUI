import { setEncounterReader, type CombatantRow, type EncounterReader, type EncounterRecord } from "./reader.js";

type Json = Record<string, unknown>;

const sessions = new Map<string, { token: string; until: number }>();

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

async function userAccessToken(userId: string) {
  const cached = sessions.get(userId);
  if (cached && cached.until > Date.now()) return cached.token;
  const user = await adminUser(userId);
  if (!user.email) throw new Error("EXTENSION");
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const link = await fetch(`${baseUrl()}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: user.email }),
  });
  if (!link.ok) throw new Error("EXTENSION");
  const generated = (await link.json()) as { hashed_token?: string };
  if (!generated.hashed_token) throw new Error("EXTENSION");
  const verified = await fetch(`${baseUrl()}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: env("SUPABASE_ANON_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: generated.hashed_token }),
  });
  if (!verified.ok) throw new Error("EXTENSION");
  const session = (await verified.json()) as { access_token?: string };
  if (!session.access_token) throw new Error("EXTENSION");
  sessions.set(userId, { token: session.access_token, until: Date.now() + 45 * 60_000 });
  return session.access_token;
}

async function extension(userId: string, name: string, body: Json): Promise<unknown[] | null> {
  const token = await userAccessToken(userId);
  const response = await fetch(`${baseUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error("EXTENSION");
  const payload = (await response.json()) as { status?: string; data?: unknown };
  if (payload.status !== "success" || !Array.isArray(payload.data)) throw new Error("EXTENSION");
  return payload.data;
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

function mapEncounter(raw: Json, characters: Json[]): EncounterRecord {
  const list = ((raw.combatants as Json | undefined)?.list as Json[] | undefined) ?? [];
  const meta = (raw.meta_data as Json | undefined) ?? {};
  const roundLog = Array.isArray(meta.initiative_log) ? meta.initiative_log : [];
  return {
    campaignId: num(raw.campaign_id) ?? 0,
    encounterId: num(raw.id) ?? 0,
    name: typeof raw.name === "string" ? raw.name : "Encounter",
    round: Math.max(1, roundLog.length || num(meta.round) || 1),
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty : undefined,
    xp: num(raw.xp),
    combatants: list.flatMap((row) => {
      const mapped = mapCombatant(row, characters);
      return mapped ? [mapped] : [];
    }),
    roundLog: [],
    diceLog: [],
    sheets: {},
  };
}

export function createSupabaseReader(): EncounterReader {
  return {
    async profile(userId) {
      const user = await adminUser(userId);
      return { id: user.id ?? userId, email: user.email ?? null, name: null };
    },
    async listEncounters(userId, campaignId) {
      const rows = await extension(userId, "wgui-ext-find-encounter", { campaign_id: campaignId });
      if (!rows) return [];
      return rows.map((row) => {
        const encounter = row as Json;
        const list = ((encounter.combatants as Json | undefined)?.list as unknown[] | undefined) ?? [];
        return {
          id: num(encounter.id) ?? 0,
          name: typeof encounter.name === "string" ? encounter.name : "Encounter",
          combatantCount: list.length,
        };
      });
    },
    async loadEncounter(userId, campaignId, encounterId) {
      const [rows, characters] = await Promise.all([
        extension(userId, "wgui-ext-find-encounter", { campaign_id: campaignId, id: encounterId }),
        extension(userId, "wgui-ext-find-campaign-characters", { campaign_id: campaignId }),
      ]);
      if (!rows?.length) return null;
      const match = rows.find((row) => num((row as Json).id) === encounterId) ?? rows[0];
      return mapEncounter(match as Json, (characters ?? []) as Json[]);
    },
  };
}

export function installSupabaseReader() {
  if (!env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY") || !env("SUPABASE_SERVICE_ROLE_KEY")) return false;
  setEncounterReader(createSupabaseReader());
  return true;
}
