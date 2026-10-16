import { register } from "node:module";
import type { CombatantSheet } from "./reader.js";

type Json = Record<string, unknown>;

const resolverReady = Promise.resolve(register(new URL("./resolve-app-deps.mjs", import.meta.url), import.meta.url));

export function sheetEnv() {
  const env = globalThis as typeof globalThis & {
    __WGUI_ENV?: Record<string, string | boolean>;
    localStorage?: Storage;
  };
  if (!env.localStorage) {
    const mem = new Map<string, string>();
    env.localStorage = {
      getItem: (key) => mem.get(key) ?? null,
      setItem: (key, value) => { mem.set(key, String(value)); },
      removeItem: (key) => { mem.delete(key); },
      clear: () => { mem.clear(); },
      key: () => null,
      length: 0,
    };
  }
  env.__WGUI_ENV = {
    VITE_ENV: "production",
    DEV: false,
    PROD: true,
    VITE_SUPABASE_URL: process.env.SUPABASE_URL ?? "",
    VITE_SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "",
  };
}

function signed(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function applyLiveCasting(sheet: CombatantSheet, character: Json, combatantId: string) {
  await resolverReady;
  sheetEnv();
  const { preparePhase1Entity } = await import("../../src/pages/phase1/phase1-entity.ts");
  const { collectEntitySpellcasting } = await import("../../src/process/content/collect-content.ts");
  const { getFinalProfValue, getFinalVariableValue } = await import("../../src/process/variables/variable-helpers.ts");
  const prepared = await preparePhase1Entity({
    _id: combatantId,
    type: "CHARACTER",
    data: character,
  } as never);
  const data = collectEntitySpellcasting(prepared.storeId, prepared.entity);
  const attack = signed(getFinalProfValue(prepared.storeId, "SPELL_ATTACK"));
  const dc = signed(getFinalProfValue(prepared.storeId, "SPELL_DC", true));
  const catalog = new Map((prepared.content.spells ?? []).map((spell) => [spell.id, spell]));
  for (const grant of data.focus) {
    const spell = catalog.get(grant.spell_id);
    const name = spell?.name ?? `Spell ${grant.spell_id}`;
    if (sheet.spells.some((entry) => entry.name === name)) continue;
    sheet.spells.push({ name, rank: grant.rank ?? spell?.rank, tradition: "focus", attack, dc });
  }
  const modifiers: Record<string, number> = {};
  for (const [label, key] of [
    ["strength", "ATTRIBUTE_STR"],
    ["dexterity", "ATTRIBUTE_DEX"],
    ["constitution", "ATTRIBUTE_CON"],
    ["intelligence", "ATTRIBUTE_INT"],
    ["wisdom", "ATTRIBUTE_WIS"],
    ["charisma", "ATTRIBUTE_CHA"],
  ] as const) {
    const total = getFinalVariableValue(prepared.storeId, key).total;
    if (total) modifiers[label] = total;
  }
  if (Object.keys(modifiers).length) sheet.abilityModifiers = modifiers;
  const speeds = {
    land: getFinalVariableValue(prepared.storeId, "SPEED").total || undefined,
    fly: getFinalVariableValue(prepared.storeId, "SPEED_FLY").total || undefined,
    climb: getFinalVariableValue(prepared.storeId, "SPEED_CLIMB").total || undefined,
    burrow: getFinalVariableValue(prepared.storeId, "SPEED_BURROW").total || undefined,
  };
  if (Object.values(speeds).some((value) => value)) sheet.speeds = speeds;
  return data.focus.length;
}
