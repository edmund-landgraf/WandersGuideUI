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
  diceLog: { title?: string; dc?: number; stat?: string; result?: string }[];
  sheets: Record<string, CombatantSheet>;
};

export type CombatantSheet = {
  senses?: string[];
  speeds?: { land?: number; fly?: number; climb?: number; burrow?: number };
  perception?: number;
  classDc?: number;
  abilities?: Record<string, unknown>;
  resistances?: string[];
  weaknesses?: string[];
  immunities?: string[];
  abilityModifiers?: Record<string, number>;
  groups: { id: string; label: string; actions: { name: string; actions?: number | null; traits?: string[]; description?: string }[] }[];
  feats: { section: "class" | "ancestry" | "general" | "other"; name: string; level?: number; hasAction: boolean }[];
  classFeatures: { name: string; level?: number }[];
  skills: { name: string; modifier?: number; proficiency?: string }[];
  spells: { tradition?: string; rank?: number; name: string; spent?: number; max?: number; prepared?: boolean }[];
  inventory?: unknown;
  notes?: string;
  details?: unknown;
  log?: unknown;
};

export type EncounterReader = {
  profile(userId: string): Promise<{ id: string; email?: string | null; name?: string | null }>;
  listEncounters(userId: string, campaignId: number): Promise<{ id: number; name: string; combatantCount: number }[]>;
  loadEncounter(userId: string, campaignId: number, encounterId: number): Promise<EncounterRecord | null>;
};

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
};

let reader: EncounterReader = empty;

export function setEncounterReader(next: EncounterReader) {
  reader = next;
}

export function getEncounterReader() {
  return reader;
}
