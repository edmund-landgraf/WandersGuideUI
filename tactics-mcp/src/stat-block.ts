import type { CombatantKind, CombatantRow, CombatantSheet } from "./reader.js";

export type StatBlock = {
  row: Partial<CombatantRow>;
  sheet: Partial<CombatantSheet>;
};

/** Use WG's operation engine: defenses may be granted by ancestry, feats or gear. */
export async function readLiveStatBlock(entity: Record<string, unknown>, kind: CombatantKind, id: string): Promise<StatBlock> {
  const { sheetEnv } = await import("./live-sheet.js");
  sheetEnv();
  const { preparePhase1Entity } = await import("../../src/pages/phase1/phase1-entity.ts");
  const prepared = await preparePhase1Entity({
    _id: id, type: kind === "character" ? "CHARACTER" : "CREATURE", data: entity,
  } as never);
  return readPreparedStatBlock(prepared);
}

/** Calculate from an isolated store, shared with the UI; also usable by offline fixtures. */
export async function readPreparedStatBlock(prepared: import("../../src/pages/phase1/phase1-entity.ts").PreparedPhase1Entity): Promise<StatBlock> {
  const { sheetEnv } = await import("./live-sheet.js");
  sheetEnv();
  const { calculatePreparedEntityStatus } = await import("../../src/pages/phase1/phase1-stats.ts");
  const { collectEntitySenses } = await import("../../src/process/content/collect-content.ts");
  const { displaySense } = await import("../../src/utils/senses.ts");
  const status = calculatePreparedEntityStatus(prepared);
  const senses = collectEntitySenses(prepared.storeId, prepared.content.abilityBlocks);
  const speeds: NonNullable<CombatantSheet["speeds"]> = { land: status.speed };
  for (const speed of status.otherSpeeds) {
    const match = /^(.*?) ([0-9]+(?:\.[0-9]+)?) ft\.$/.exec(speed);
    if (match) speeds[match[1].toLowerCase()] = Number(match[2]);
  }
  return {
    row: {
      hpMax: status.maxHp, ac: status.ac, fortitude: status.fortitude,
      reflex: status.reflex, will: status.will,
      tempHp: typeof prepared.entity.hp_temp === "number" ? prepared.entity.hp_temp : 0,
    },
    sheet: {
      resistances: status.resistances, weaknesses: status.weaknesses,
      immunities: status.immunities,
      senses: [...senses.precise, ...senses.imprecise, ...senses.vague].map((sense) => displaySense(sense).trim()),
      speeds, abilityModifiers: status.attributes,
      perception: status.perception, classDc: status.classDc,
    },
  };
}
