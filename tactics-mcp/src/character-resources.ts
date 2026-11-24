type SpellsField = Record<string, unknown>;

export type ResourcePools = { maxHp: number; maxFocus: number };

export type ResourceFill = {
  character: Record<string, unknown>;
  changed: boolean;
  reason: "initialized" | "rest" | "kept";
};

type ResourceCalculator = (character: Record<string, unknown>) => Promise<ResourcePools>;

let calculator: ResourceCalculator | null | undefined;

/** Tests inject calculated pools. null skips the sheet pass. undefined uses it. */
export function setResourceCalculator(next: ResourceCalculator | null | undefined) {
  calculator = next;
}

function spellsOf(character: Record<string, unknown>): SpellsField {
  const spells = character.spells;
  if (!spells || typeof spells !== "object" || Array.isArray(spells)) {
    return { slots: [], list: [], focus_point_current: 0, innate_casts: [] };
  }
  return { ...(spells as SpellsField) };
}

function metaOf(character: Record<string, unknown>): Record<string, unknown> {
  const meta = character.meta_data;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return { ...(meta as Record<string, unknown>) };
}

/**
 * The sheet fills HP while meta_data.reset_hp is not false, then sets it false.
 * create_character starts with reset_hp true. A character at 1 HP with an empty
 * focus pool is left alone once that flag is false.
 */
export function resourcesLookFresh(character: Record<string, unknown>) {
  return metaOf(character).reset_hp !== false;
}

export function applyResourcePools(character: Record<string, unknown>, pools: ResourcePools, force: boolean): ResourceFill {
  if (!force && !resourcesLookFresh(character)) {
    return { character, changed: false, reason: "kept" };
  }
  const maxHp = Math.max(0, Math.floor(pools.maxHp));
  const maxFocus = Math.min(3, Math.max(0, Math.floor(pools.maxFocus)));
  return {
    character: {
      ...character,
      hp_current: maxHp,
      spells: { ...spellsOf(character), focus_point_current: maxFocus },
      meta_data: { ...metaOf(character), reset_hp: false },
    },
    changed: true,
    reason: force ? "rest" : "initialized",
  };
}

export async function computeResourcePools(character: Record<string, unknown>): Promise<ResourcePools> {
  if (calculator) return calculator(character);
  if (calculator === null) return { maxHp: 0, maxFocus: 0 };
  const { sheetEnv } = await import("./live-sheet.js");
  sheetEnv();
  const { liveCharacterWrite } = await import("./character-choices-live.js");
  const next = await liveCharacterWrite(character);
  const { getFinalHealthValue } = await import("../../src/process/variables/variable-helpers.ts");
  const { collectEntitySpellcasting, getFocusPoints } = await import("../../src/process/content/collect-content.ts");
  const casting = collectEntitySpellcasting("CHARACTER", next as never);
  const focus = getFocusPoints("CHARACTER", next as never, casting.focus);
  return { maxHp: getFinalHealthValue("CHARACTER"), maxFocus: focus.max };
}
