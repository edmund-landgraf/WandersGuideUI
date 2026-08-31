import type {
  AmbaChallengeTable,
  Character,
  Combatant,
  DiceCheckResult,
  DiceRollLog,
  DiceRollLogEntry,
  DiceRollOutcome,
  DiceRollSide,
  DiceRollState,
  Encounter,
  LivingEntity,
} from '@schemas/content';
import { noteForAmbaOutcome } from './phase1-amba-challenges';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { isCharacter, isCreature, isTruthy } from '@utils/type-fixing';
import { getFinalProfValue, getFinalVariableValue } from '@variables/variable-helpers';
import { getAllSkillVariables } from '@variables/variable-manager';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';
import type { InitiativeSkillOption } from './phase1-initiative';

export const DICE_CHECK_OPTIONS: { value: string; group: string }[] = [
  { value: 'PERCEPTION', group: 'Senses' },
  { value: 'SAVE_FORT', group: 'Saves' },
  { value: 'SAVE_REFLEX', group: 'Saves' },
  { value: 'SAVE_WILL', group: 'Saves' },
  { value: 'ATTRIBUTE_STR', group: 'Ability' },
  { value: 'ATTRIBUTE_DEX', group: 'Ability' },
  { value: 'ATTRIBUTE_CON', group: 'Ability' },
  { value: 'ATTRIBUTE_INT', group: 'Ability' },
  { value: 'ATTRIBUTE_WIS', group: 'Ability' },
  { value: 'ATTRIBUTE_CHA', group: 'Ability' },
  { value: 'SKILL_ACROBATICS', group: 'Skill' },
  { value: 'SKILL_ARCANA', group: 'Skill' },
  { value: 'SKILL_ATHLETICS', group: 'Skill' },
  { value: 'SKILL_CRAFTING', group: 'Skill' },
  { value: 'SKILL_DECEPTION', group: 'Skill' },
  { value: 'SKILL_DIPLOMACY', group: 'Skill' },
  { value: 'SKILL_INTIMIDATION', group: 'Skill' },
  { value: 'SKILL_MEDICINE', group: 'Skill' },
  { value: 'SKILL_NATURE', group: 'Skill' },
  { value: 'SKILL_OCCULTISM', group: 'Skill' },
  { value: 'SKILL_PERFORMANCE', group: 'Skill' },
  { value: 'SKILL_RELIGION', group: 'Skill' },
  { value: 'SKILL_SOCIETY', group: 'Skill' },
  { value: 'SKILL_STEALTH', group: 'Skill' },
  { value: 'SKILL_SURVIVAL', group: 'Skill' },
  { value: 'SKILL_THIEVERY', group: 'Skill' },
];

export const DICE_CHECK_VALUES = new Set(DICE_CHECK_OPTIONS.map((option) => option.value));

export function checkStatLabel(stat: string | undefined) {
  if (!stat) return 'Check';
  return toLabel(stat);
}

export function degreeOfSuccess(die: number, total: number, dc: number): DiceRollOutcome {
  let degree = 0;
  if (total >= dc + 10) degree = 2;
  else if (total >= dc) degree = 1;
  else if (total <= dc - 10) degree = -1;
  if (die === 20) degree += 1;
  if (die === 1) degree -= 1;
  if (degree >= 2) return 'critical-success';
  if (degree === 1) return 'success';
  if (degree <= -1) return 'critical-failure';
  return 'failure';
}

export function formatCheckRoll(roll: Pick<DiceCheckResult, 'die' | 'bonus' | 'source'>, total?: number, dc?: number) {
  const bonus = roll.source ? `${roll.source} (${sign(roll.bonus)})` : roll.bonus !== 0 ? sign(roll.bonus) : null;
  const equation = bonus ? `d20 (${roll.die}) + ${bonus}` : `d20 (${roll.die})`;
  if (total === undefined) return equation;
  if (dc == null) return `${equation} = ${total}`;
  return `${equation} = ${total} vs DC ${dc}`;
}

export function outcomeRowClass(outcome: DiceRollOutcome | undefined) {
  if (outcome === 'critical-success') return 'dice-roll-crit-success';
  if (outcome === 'success') return 'dice-roll-success';
  if (outcome === 'failure') return 'dice-roll-failure';
  if (outcome === 'critical-failure') return 'dice-roll-crit-failure';
  return '';
}

export function outcomeLabel(outcome: DiceRollOutcome | undefined) {
  if (outcome === 'critical-success') return 'Critical success';
  if (outcome === 'success') return 'Success';
  if (outcome === 'failure') return 'Failure';
  if (outcome === 'critical-failure') return 'Critical failure';
  return '';
}

const DICE_NOTE_PREVIEW_LIMIT = 255;

export function previewDiceNote(note: string | undefined, clickable: boolean) {
  if (!note) return clickable ? 'Add note' : '';
  if (note.length <= DICE_NOTE_PREVIEW_LIMIT) return note;
  return `${note.slice(0, DICE_NOTE_PREVIEW_LIMIT)}…`;
}

export const DICE_OUTCOME_LEGEND: { outcome: DiceRollOutcome | 'unrolled'; label: string; detail: string; className: string }[] = [
  { outcome: 'critical-success', label: 'Critical success', detail: 'Succeed by 10 or more, or a natural 20 that upgrades a success.', className: 'dice-roll-crit-success' },
  { outcome: 'success', label: 'Success', detail: 'Meet or beat the DC.', className: 'dice-roll-success' },
  { outcome: 'failure', label: 'Failure', detail: 'Below the DC, but not by 10.', className: 'dice-roll-failure' },
  { outcome: 'critical-failure', label: 'Critical failure', detail: 'Fail by 10 or more, or a natural 1 that downgrades a failure.', className: 'dice-roll-crit-failure' },
  { outcome: 'unrolled', label: 'Not rolled', detail: 'Skipped or not rolled yet.', className: '' },
];

export function filterCombatantsBySide<T extends { ally: boolean }>(combatants: T[], side: DiceRollSide | undefined) {
  if (!side) return [];
  if (side === 'allies') return combatants.filter((combatant) => combatant.ally);
  if (side === 'enemies') return combatants.filter((combatant) => !combatant.ally);
  return combatants;
}

export function overlayDiceRollMeta(
  encounters: Encounter[],
  logs: ReadonlyMap<number, DiceRollLog[]>,
  states: ReadonlyMap<number, DiceRollState | undefined>,
): Encounter[] {
  if (logs.size === 0 && states.size === 0) return encounters;
  return encounters.map((encounter) => {
    const log = logs.get(encounter.id);
    const state = states.get(encounter.id);
    if (log === undefined && state === undefined) return encounter;
    return {
      ...encounter,
      meta_data: {
        ...encounter.meta_data,
        ...(log !== undefined ? { dice_roll_log: log } : {}),
        ...(state !== undefined ? { dice_roll_state: state } : {}),
      },
    };
  });
}

export function buildDiceRollLog(
  title: string,
  dc: number,
  defaultStat: string,
  combatants: Array<Combatant & { data: LivingEntity }>,
  results: Record<string, DiceCheckResult>,
  challenge?: AmbaChallengeTable,
): DiceRollLog {
  const entries: DiceRollLogEntry[] = combatants.map((combatant) => {
    const result = results[combatant._id];
    if (!result) {
      return {
        combatant_id: combatant._id,
        name: combatant.data.name,
        ally: combatant.ally,
        calculation: 'Skipped',
        total: null,
      };
    }
    return {
      combatant_id: combatant._id,
      name: combatant.data.name,
      ally: combatant.ally,
      calculation: formatCheckRoll(result, result.total, dc),
      total: result.total,
      outcome: result.outcome,
      note: noteForAmbaOutcome(challenge, result.outcome),
    };
  });
  return { id: crypto.randomUUID(), title: title.trim(), dc, defaultStat, entries };
}

function hasFullCharacterDetails(character: Character) {
  return Boolean(character.user_id && character.created_at);
}

function isAttribute(stat: string) {
  return stat.startsWith('ATTRIBUTE_');
}

function modifierFor(storeId: string, stat: string) {
  if (isAttribute(stat)) return getFinalVariableValue(storeId, stat).total;
  return Number.parseInt(getFinalProfValue(storeId, stat), 10) || 0;
}

function optionsFromStore(storeId: string): InitiativeSkillOption[] {
  const skills = getAllSkillVariables(storeId).filter((skill) => skill.name !== 'SKILL_LORE____');
  const keys = [
    'PERCEPTION',
    'SAVE_FORT',
    'SAVE_REFLEX',
    'SAVE_WILL',
    'ATTRIBUTE_STR',
    'ATTRIBUTE_DEX',
    'ATTRIBUTE_CON',
    'ATTRIBUTE_INT',
    'ATTRIBUTE_WIS',
    'ATTRIBUTE_CHA',
    ...skills.map((skill) => skill.name),
  ];
  return keys
    .map((stat) => {
      const num = modifierFor(storeId, stat);
      return { value: stat, label: `${toLabel(stat)}, ${sign(num)}`, num };
    })
    .sort(compareCheckOptions);
}

function optionsFromCharacterProfs(profs: Record<string, { total: number } | undefined> | undefined): InitiativeSkillOption[] {
  if (!profs) return [];
  const keys = Object.keys(profs).filter((prof) => (
    prof === 'PERCEPTION' || prof.startsWith('SKILL_') || prof.startsWith('SAVE_')
  ));
  return keys
    .map((stat) => {
      const value = profs[stat];
      if (!value) return null;
      return { value: stat, label: `${toLabel(stat)}, ${sign(value.total)}`, num: value.total };
    })
    .filter(isTruthy)
    .sort(compareCheckOptions);
}

function compareCheckOptions(a: InitiativeSkillOption, b: InitiativeSkillOption) {
  const order = (value: string) => {
    if (value === 'PERCEPTION') return 0;
    if (value.startsWith('SAVE_')) return 1;
    if (value.startsWith('ATTRIBUTE_')) return 2;
    return 3;
  };
  const aOrder = order(a.value);
  const bOrder = order(b.value);
  if (aOrder !== bOrder) return aOrder - bOrder;
  if (a.num === b.num) return a.value.localeCompare(b.value);
  return b.num - a.num;
}

export async function loadCheckOptions(combatant: Combatant & { data: LivingEntity }): Promise<InitiativeSkillOption[]> {
  if (combatant.type === 'CHARACTER' && isCharacter(combatant.data)) {
    const fromStats = optionsFromCharacterProfs(combatant.data.meta_data?.calculated_stats?.profs);
    if (fromStats.length) return fromStats;
  }
  const canPrepare =
    (combatant.type === 'CHARACTER' && isCharacter(combatant.data) && hasFullCharacterDetails(combatant.data))
    || (combatant.type === 'CREATURE' && isCreature(combatant.data));
  if (!canPrepare) return [];
  try {
    const { storeId } = await preparePhase1Entity(combatant as Phase1EntityCombatant);
    return optionsFromStore(storeId);
  } catch {
    return [];
  }
}

export async function loadAllCheckOptions(combatants: Array<Combatant & { data: LivingEntity }>) {
  const optionsById: Record<string, InitiativeSkillOption[]> = {};
  for (const combatant of combatants) {
    if (combatant.type === 'CHARACTER' && isCharacter(combatant.data)) {
      const fromStats = optionsFromCharacterProfs(combatant.data.meta_data?.calculated_stats?.profs);
      if (fromStats.length) {
        optionsById[combatant._id] = fromStats;
        continue;
      }
    }
    optionsById[combatant._id] = await loadCheckOptions(combatant);
  }
  return optionsById;
}

export function defaultStatForCombatant(options: InitiativeSkillOption[], preferred: string) {
  if (options.some((option) => option.value === preferred)) return preferred;
  if (preferred.startsWith('SAVE_') && options.some((option) => option.value === 'SAVE_REFLEX')) return 'SAVE_REFLEX';
  if (options.some((option) => option.value === 'PERCEPTION')) return 'PERCEPTION';
  return options[0]?.value ?? null;
}

function sameDiceRollLog(a: DiceRollLog, b: DiceRollLog) {
  if (a.id && b.id) return a.id === b.id;
  return a.title === b.title && a.dc === b.dc && a.defaultStat === b.defaultStat;
}

function sameDiceRollLogEntry(a: DiceRollLogEntry, b: DiceRollLogEntry) {
  if (a.combatant_id && b.combatant_id) return a.combatant_id === b.combatant_id;
  return a.name === b.name && a.ally === b.ally && a.calculation === b.calculation;
}

export function diceEntryWasRolled(entry: DiceRollLogEntry) {
  return entry.total != null && Boolean(entry.outcome);
}

export function setDiceRollLogEntryNote(
  log: DiceRollLog[],
  round: DiceRollLog,
  entry: DiceRollLogEntry,
  note: string,
): DiceRollLog[] {
  const nextNote = note.trim() || undefined;
  return log.map((item) => {
    if (!sameDiceRollLog(item, round)) return item;
    return {
      ...item,
      entries: item.entries.map((current) => (
        sameDiceRollLogEntry(current, entry) ? { ...current, note: nextNote } : current
      )),
    };
  });
}
