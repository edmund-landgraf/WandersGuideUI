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

/** Wanderer's Guide creates a character at 1 HP and 0 focus. Anything else has been played. */
export function resourcesLookFresh(character: Record<string, unknown>) {
  const hp = character.hp_current;
  const focus = spellsOf(character).focus_point_current;
  const focusFresh = focus == null || focus === 0;
  return (hp == null || hp === 1) && focusFresh;
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
