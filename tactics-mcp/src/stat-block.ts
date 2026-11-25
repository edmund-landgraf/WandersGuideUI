import type { CombatantKind, CombatantRow, CombatantSheet } from "./reader.js";
import { isEncounterStrike } from "./encounter-actions.js";

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
  const { getAllSkillVariables } = await import("../../src/process/variables/variable-manager.ts");
  const { getFinalProfValue } = await import("../../src/process/variables/variable-helpers.ts");
  const { compileProficiencyType, variableToLabel } = await import("../../src/process/variables/variable-utils.ts");
  const skills = getAllSkillVariables(prepared.storeId).flatMap((skill) => {
    if (skill.name === "SKILL_LORE____") return [];
    const rank = compileProficiencyType(skill.value);
    if (rank === "U") return [];
    const parsed = Number.parseInt(getFinalProfValue(prepared.storeId, skill.name), 10);
    return [{
      name: variableToLabel(skill).replace(/^Skill /, ""),
      modifier: Number.isFinite(parsed) ? parsed : undefined,
      proficiency: rank,
    }];
  });
  const { readStoredDefenses } = await import("../../src/pages/phase1/phase1-creature-defenses.ts");
  const stored = prepared.kind === "CREATURE" ? readStoredDefenses(prepared.entity as never) : null;
  const hpMax = stored?.hp != null && stored.hp > status.maxHp ? stored.hp : status.maxHp;
  const ac = status.ac > 10 ? status.ac : stored?.ac ?? status.ac;
  const fortitude = status.fortitude !== 0 ? status.fortitude : stored?.fort ?? status.fortitude;
  const reflex = status.reflex !== 0 ? status.reflex : stored?.reflex ?? status.reflex;
  const will = status.will !== 0 ? status.will : stored?.will ?? status.will;
  let strikes: CombatantSheet["strikes"];
  if (prepared.kind === "CREATURE") {
    const { collectCreatureAbilities } = await import("../../src/pages/phase1/phase1-abilities.ts");
    const traits = new Map((prepared.content.traits ?? []).map((trait) => [trait.id, trait.name]));
    strikes = collectCreatureAbilities(prepared.entity as never, prepared.content.abilityBlocks ?? [], prepared.storeId, traits)
      .filter(isEncounterStrike)
      .map((ability) => ({
        name: ability.name,
        actions: ability.actions === "ONE-ACTION" ? 1 : ability.actions === "TWO-ACTIONS" ? 2 : ability.actions === "THREE-ACTIONS" ? 3 : ability.actions === "FREE-ACTION" ? 0 : null,
        actionCost: typeof ability.actions === "string" ? ability.actions : undefined,
        trigger: typeof ability.trigger === "string" && ability.trigger.trim() ? ability.trigger.trim() : undefined,
        traits: ability.traitNames,
        traitIds: (ability.traits ?? []).filter((id) => typeof id === "number" && Number.isFinite(id)),
        description: ability.description ?? undefined,
      }));
  }
  const speeds: NonNullable<CombatantSheet["speeds"]> = { land: status.speed };
  for (const speed of status.otherSpeeds) {
    const match = /^(.*?) ([0-9]+(?:\.[0-9]+)?) ft\.$/.exec(speed);
    if (match) speeds[match[1].toLowerCase()] = Number(match[2]);
  }
  const currentHp = prepared.kind === "CREATURE" && typeof prepared.entity.hp_current === "number" ? prepared.entity.hp_current : undefined;
  const hpCurrent = currentHp != null && stored?.hp != null && currentHp === status.maxHp && stored.hp > status.maxHp ? stored.hp : currentHp;
  return {
    row: {
      hpMax,
      ...(hpCurrent != null ? { hpCurrent } : {}),
      ac, fortitude, reflex, will,
      tempHp: typeof prepared.entity.hp_temp === "number" ? prepared.entity.hp_temp : 0,
    },
    sheet: {
      resistances: status.resistances, weaknesses: status.weaknesses,
      immunities: status.immunities,
      senses: [...senses.precise, ...senses.imprecise, ...senses.vague].flatMap((sense) => {
        const label = sense?.senseName ? displaySense(sense).trim() : "";
        return label ? [label] : [];
      }),
      skills,
      ...(strikes !== undefined ? { strikes } : {}),
      ...(typeof prepared.entity.id === "number" ? { catalogId: prepared.entity.id } : {}),
      ...(typeof (prepared.entity as { content_source_id?: unknown }).content_source_id === "number"
        ? { contentSourceId: (prepared.entity as { content_source_id: number }).content_source_id }
        : {}),
      speeds, abilityModifiers: status.attributes,
      perception: status.perception, classDc: status.classDc,
    },
  };
}
