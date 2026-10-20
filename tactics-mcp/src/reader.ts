export type CombatantKind = "character" | "creature";

export type CombatantRow = {
  id: string;
  name: string;
  side: "ally" | "enemy";
  level?: number;
  kind: CombatantKind;
  initiative?: number;
  conditions: { name: string; value?: number }[];
  ac?: number;
  fortitude?: number;
  reflex?: number;
  will?: number;
  hpCurrent: number;
  hpMax: number;
  tempHp?: number;
  place: "fighting" | "bench" | "down";
  out?: "dead" | "incapacitated";
};

export type EncounterRecord = {
  campaignId: number;
  encounterId: number;
  name: string;
  round: number;
  difficulty?: string;
  xp?: number;
  noteName?: string;
  combatants: CombatantRow[];
  roundLog: { round: number; name: string; side: string; initiative?: number; calculation?: string; note?: string }[];
  diceLog: ({ title?: string; dc?: number; stat?: string; result?: string; [key: string]: unknown })[];
  diceState?: Record<string, unknown> | null;
  sheets: Record<string, CombatantSheet>;
};

export type CombatantSheet = {
  senses?: string[];
  speeds?: { land?: number; fly?: number; climb?: number; burrow?: number; swim?: number; [movement: string]: number | undefined };
  perception?: number;
  classDc?: number;
  abilities?: Record<string, unknown>;
  resistances?: string[];
  weaknesses?: string[];
  immunities?: string[];
  abilityModifiers?: Record<string, number>;
  groups: { id: string; label: string; actions: { name: string; actions?: number | null; actionCost?: string; traits?: string[]; description?: string }[] }[];
  feats: { section: "class" | "ancestry" | "general" | "other"; name: string; level?: number; hasAction: boolean }[];
  classFeatures: { name: string; level?: number }[];
  skills: { name: string; modifier?: number; proficiency?: string }[];
  spells: { tradition?: string; rank?: number; name: string; spent?: number; max?: number; prepared?: boolean; attack?: number; dc?: number }[];
  inventory?: unknown;
  notes?: string;
  details?: unknown;
  sourceDetails?: unknown;
  log?: unknown;
};

export type ActionFailure = { ok: false; code: string; message: string };
export type ActionResult<T> = { ok: true; data: T } | ActionFailure;

export type CharacterExport =
  | { format: "json"; file: Record<string, unknown> }
  | { format: "pdf"; filename: string; mimeType: "application/pdf"; base64: string };

export type EncounterReader = {
  profile(userId: string): Promise<{ id: string; email?: string | null; name?: string | null }>;
  listEncounters(userId: string, campaignId: number): Promise<{ id: number; name: string; combatantCount: number }[]>;
  loadEncounter(userId: string, campaignId: number, encounterId: number, combatantId?: string, includeStats?: boolean): Promise<EncounterRecord | null>;
  ensurePublicUser(userId: string): Promise<ActionResult<{ userId: string; displayName: string; created: boolean }>>;
  joinCampaign(userId: string, characterId: number, joinKey: string): Promise<ActionResult<{ characterId: number; campaignId: number; campaignName: string; already: boolean }>>;
  campaignOwnerContacts(userId: string, ownerIds: string[]): Promise<ActionResult<{ userId: string; email: string; displayName: string }[]>>;
  patchEncounterDice(userId: string, campaignId: number, encounterId: number, patch: { diceRollState?: Record<string, unknown> | null; diceRollLog?: unknown[] }): Promise<ActionResult<{ diceRollState: unknown; diceRollLog: unknown[] }>>;
  listCampaignCharacters(userId: string, campaignId: number): Promise<ActionResult<{ id: number; name: string; level: number | null; ancestry: string | null; className: string | null }[]>>;
  exportCharacter(userId: string, characterId: number, format?: "json" | "pdf"): Promise<ActionResult<CharacterExport>>;
};

function unavailable(message = "This tool is unavailable without the campaign database."): ActionFailure {
  return { ok: false, code: "INTERNAL_ERROR", message };
}

const empty: EncounterReader = {
  async profile(userId) {
    return { id: userId, email: null, name: null };
  },
  async listEncounters() {
    return [];
  },
  async loadEncounter() {
    return null;
  },
  async ensurePublicUser() {
    return unavailable();
  },
  async joinCampaign() {
    return unavailable();
  },
  async campaignOwnerContacts() {
    return unavailable();
  },
  async patchEncounterDice() {
    return unavailable();
  },
  async listCampaignCharacters() {
    return unavailable();
  },
  async exportCharacter() {
    return unavailable();
  },
};

let reader: EncounterReader = empty;

export function setEncounterReader(next: EncounterReader) {
  reader = next;
}

export function getEncounterReader() {
  return reader;
}
