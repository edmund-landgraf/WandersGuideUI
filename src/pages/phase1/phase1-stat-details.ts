import { collectEntitySenses } from '@content/collect-content';
import { getAcParts } from '@items/armor-handler';
import { getBestArmor } from '@items/inv-utils';
import type { AbilityBlock, SenseWithRange } from '@schemas/content';
import type { AttributeValue, VariableAttr, VariableBool, VariableListStr, VariableNum, VariableProf } from '@schemas/variables';
import { displayResistWeak, getResistWeaks } from '@utils/resist-weaks';
import { displaySense } from '@utils/senses';
import { toLabel } from '@utils/strings';
import {
  getBonusText,
  getFinalAcValue,
  getFinalHealthValue,
  getFinalProfValue,
  getFinalVariableValue,
  getHealthValueParts,
  getProfValueParts,
  getSpeedValue,
  getVariableBreakdown,
} from '@variables/variable-helpers';
import {
  getAllSpeedVariables,
  getVariable,
  getVariableBonuses,
  getVariableHistory,
} from '@variables/variable-manager';
import {
  compileProficiencyType,
  compactLabels,
  isProficiencyValue,
  proficiencyTypeToLabel,
  variableToLabel,
} from '@variables/variable-utils';
import type { Phase1SkillBreakdownTerm, Phase1SkillTimelineItem } from './phase1-skills';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type Phase1StatKey =
  | 'hp'
  | 'resist'
  | 'perception'
  | 'speed'
  | 'ac'
  | 'fortitude'
  | 'reflex'
  | 'will'
  | 'classDc'
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export type Phase1BreakdownInfix = { kind: 'text'; text: string } | { kind: 'index'; index: number };

export type Phase1Breakdown = {
  finalLabel: string;
  prefix?: string;
  terms: Phase1SkillBreakdownTerm[];
  conditionals: Array<{ text: string; source: string }>;
  infix?: Phase1BreakdownInfix[];
};

export type Phase1StatItem = { name: string; href?: string };

export type Phase1ActiveGroup = {
  id: string;
  label: string;
  description?: string;
  items: Phase1StatItem[];
  emptyText: string;
};

export type Phase1StatSection = {
  id: string;
  label: string;
  value?: string;
  description?: string;
  items?: Phase1StatItem[];
  groups?: Phase1ActiveGroup[];
  breakdown?: Phase1Breakdown;
  timeline?: Phase1SkillTimelineItem[];
  inlineDetails?: boolean;
};

export type Phase1AttributeTable = {
  columns: string[];
  rows: Array<{ source: string; values: Array<number | null | 'partial'> }>;
  totals: Array<{ value: number; partial?: boolean }>;
};

export type Phase1StatDetail = {
  title: string;
  badge?: string;
  description: string;
  accordionDescription?: boolean;
  defaultOpen?: string;
  groups?: Phase1ActiveGroup[];
  table?: Phase1AttributeTable;
  sections: Phase1StatSection[];
};

export type Phase1StatDetails = Record<Phase1StatKey, Phase1StatDetail>;

const ATTR_KEYS = [
  ['strength', 'ATTRIBUTE_STR', 'Strength'],
  ['dexterity', 'ATTRIBUTE_DEX', 'Dexterity'],
  ['constitution', 'ATTRIBUTE_CON', 'Constitution'],
  ['intelligence', 'ATTRIBUTE_INT', 'Intelligence'],
  ['wisdom', 'ATTRIBUTE_WIS', 'Wisdom'],
  ['charisma', 'ATTRIBUTE_CHA', 'Charisma'],
] as const;

const SAVE_KEYS = [
  ['fortitude', 'SAVE_FORT', 'Fortitude'],
  ['reflex', 'SAVE_REFLEX', 'Reflex'],
  ['will', 'SAVE_WILL', 'Will'],
] as const;

export async function loadEntityStatDetails(combatant: Phase1EntityCombatant): Promise<Phase1StatDetails> {
  const { entity, content, storeId } = await preparePhase1Entity(combatant);
  const armor = getBestArmor(storeId, entity.inventory);
  const armorName = armor?.item.name ?? 'Unarmored';
  const senses = collectEntitySenses(storeId, content.abilityBlocks as AbilityBlock[]);
  const precise = mergeSenses(senses.precise, getVariable<VariableListStr>(storeId, 'SENSES_PRECISE')?.value ?? []);
  const imprecise = mergeSenses(senses.imprecise, getVariable<VariableListStr>(storeId, 'SENSES_IMPRECISE')?.value ?? []);
  const vague = mergeSenses(senses.vague, getVariable<VariableListStr>(storeId, 'SENSES_VAGUE')?.value ?? []);
  const perception = buildProfSection(storeId, 'PERCEPTION', 'Perception');
  const perceptionRank = getVariable<VariableProf>(storeId, 'PERCEPTION');
  const attributeSections = ATTR_KEYS.map(([id, variableName, label]) => buildAttributeSection(storeId, id, variableName, label));
  const saveSections = SAVE_KEYS.map(([id, variableName, label]) => buildProfSection(storeId, variableName, label));
  const classDc = buildProfSection(storeId, 'CLASS_DC', 'Class DC', true);
  const classDcRank = getVariable<VariableProf>(storeId, 'CLASS_DC');
  const attributeTable = buildAttributeTable(storeId);
  const hp = buildHealthSection(storeId);
  const ac = buildAcSection(storeId, armorName, armor?.item);
  const speedSections = getAllSpeedVariables(storeId)
    .map((variable) => buildSpeedSection(storeId, variable, entity))
    .filter((section): section is Phase1StatSection => Boolean(section));

  const details = {
    hp: {
      title: 'Hit Points',
      description: 'Hit Points measure how much punishment you can take before falling unconscious or dying. Your maximum Hit Points come from your class, ancestry, Constitution, and other bonuses.',
      defaultOpen: 'max-hp',
      sections: [hp],
    },
    resist: {
      title: 'Resistances & Weaknesses',
      description: '',
      groups: [
        resistGroup('resistances', 'Resistances', getResistWeaks(storeId, 'RESISTANCES'), RESIST_DESCRIPTION, 'No resistances found.'),
        resistGroup('weaknesses', 'Weaknesses', getResistWeaks(storeId, 'WEAKNESSES'), WEAK_DESCRIPTION, 'No weaknesses found.'),
        resistGroup('immunities', 'Immunities', (getVariable<VariableListStr>(storeId, 'IMMUNITIES')?.value ?? []).map((value) => displayResistWeak(storeId, value)), IMMUNE_DESCRIPTION, 'No immunities found.'),
      ],
      sections: [],
    },
    perception: {
      title: 'Perception',
      badge: perceptionRank ? proficiencyTypeToLabel(compileProficiencyType(perceptionRank.value)) : undefined,
      description: "An individual's Perception measures their ability to notice things, search for what's hidden, and tell whether something about a situation is suspicious.",
      accordionDescription: true,
      defaultOpen: 'senses',
      sections: [
        {
          id: 'senses',
          label: 'Senses',
          groups: [
            senseGroup('precise', 'Precise', precise, 'No precise senses found.'),
            senseGroup('imprecise', 'Imprecise', imprecise, 'No imprecise senses found.'),
            senseGroup('vague', 'Vague', vague, 'No vague senses found.'),
          ],
        },
        { id: 'description', label: 'Description', description: "An individual's Perception measures their ability to notice things, search for what's hidden, and tell whether something about a situation is suspicious." },
        { id: 'breakdown', label: 'Breakdown', inlineDetails: true, breakdown: perception.breakdown },
        { id: 'timeline', label: 'Timeline', inlineDetails: true, timeline: perception.timeline },
      ],
    },
    speed: {
      title: speedSections.length > 1 ? 'Speeds' : 'Speed',
      description: 'Speed is the distance an individual can move using a single action, measured in feet. There are various kinds of speeds, allowing one to easily fly, swim, or dig, but the most common speed is for walking normally. Penalties to a speed can decrease it to a minimum of 5 feet.',
      defaultOpen: speedSections[0]?.id,
      sections: speedSections,
    },
    ac: {
      title: `AC: ${armorName}`,
      description: 'Armor Class represents how difficult this individual is to hit and damage in combat. This metric is the combination of their ability to dodge, their natural toughness, and the protection provided by their armor.',
      accordionDescription: true,
      defaultOpen: 'breakdown',
      sections: [
        { id: 'description', label: 'Description', description: 'Armor Class represents how difficult this individual is to hit and damage in combat. This metric is the combination of their ability to dodge, their natural toughness, and the protection provided by their armor.' },
        { id: 'breakdown', label: 'Breakdown', inlineDetails: true, breakdown: ac.breakdown },
      ],
    },
    classDc: {
      title: 'Class DC',
      badge: classDcRank ? proficiencyTypeToLabel(compileProficiencyType(classDcRank.value)) : undefined,
      description: "A class DC sets the difficulty for certain abilities granted by your character's class.",
      accordionDescription: true,
      defaultOpen: 'breakdown',
      sections: [
        { id: 'description', label: 'Description', description: "A class DC sets the difficulty for certain abilities granted by your character's class." },
        { id: 'breakdown', label: 'Breakdown', inlineDetails: true, breakdown: classDc.breakdown },
        { id: 'timeline', label: 'Timeline', inlineDetails: true, timeline: classDc.timeline },
      ],
    },
    fortitude: saveDetail('Fortitude', SAVE_DESCRIPTIONS.fortitude, saveSections[0], saveRank(storeId, 'SAVE_FORT')),
    reflex: saveDetail('Reflex', SAVE_DESCRIPTIONS.reflex, saveSections[1], saveRank(storeId, 'SAVE_REFLEX')),
    will: saveDetail('Will', SAVE_DESCRIPTIONS.will, saveSections[2], saveRank(storeId, 'SAVE_WILL')),
    strength: attributeDetail('Strength', ATTR_DESCRIPTIONS.strength, 'strength', attributeSections, attributeTable),
    dexterity: attributeDetail('Dexterity', ATTR_DESCRIPTIONS.dexterity, 'dexterity', attributeSections, attributeTable),
    constitution: attributeDetail('Constitution', ATTR_DESCRIPTIONS.constitution, 'constitution', attributeSections, attributeTable),
    intelligence: attributeDetail('Intelligence', ATTR_DESCRIPTIONS.intelligence, 'intelligence', attributeSections, attributeTable),
    wisdom: attributeDetail('Wisdom', ATTR_DESCRIPTIONS.wisdom, 'wisdom', attributeSections, attributeTable),
    charisma: attributeDetail('Charisma', ATTR_DESCRIPTIONS.charisma, 'charisma', attributeSections, attributeTable),
  } satisfies Phase1StatDetails;

  return details;
}

export type Phase1StatTarget = Phase1StatKey | { variableName: string; isDC?: boolean };

export async function loadStatTarget(combatant: Phase1EntityCombatant, stat: Phase1StatTarget): Promise<Phase1StatDetail> {
  if (typeof stat === 'object') return loadProfDetail(combatant, stat.variableName, stat.isDC);
  const details = await loadEntityStatDetails(combatant);
  return details[stat];
}

export async function loadProfDetail(combatant: Phase1EntityCombatant, variableName: string, isDC = false): Promise<Phase1StatDetail> {
  const { storeId } = await preparePhase1Entity(combatant);
  return buildProfDetail(storeId, variableName, isDC);
}

export function buildProfDetail(storeId: string, variableName: string, isDC = false): Phase1StatDetail {
  const variable = getVariable<VariableProf>(storeId, variableName);
  const label = variable ? variableToLabel(variable) : toLabel(variableName);
  return saveDetail(label, profDescription(variableName), buildProfSection(storeId, variableName, label, isDC), saveRank(storeId, variableName));
}

function saveRank(storeId: string, variableName: string) {
  const variable = getVariable<VariableProf>(storeId, variableName);
  return variable ? proficiencyTypeToLabel(compileProficiencyType(variable.value)) : undefined;
}

function saveDetail(title: string, description: string, section: Phase1StatSection, badge?: string): Phase1StatDetail {
  return {
    title,
    badge,
    description,
    accordionDescription: true,
    defaultOpen: 'breakdown',
    sections: [
      { id: 'description', label: 'Description', description },
      { id: 'breakdown', label: 'Breakdown', inlineDetails: true, breakdown: section.breakdown },
      { id: 'timeline', label: 'Timeline', inlineDetails: true, timeline: section.timeline },
    ],
  };
}

function attributeDetail(title: string, description: string, defaultOpen: string, sections: Phase1StatSection[], table: Phase1AttributeTable): Phase1StatDetail {
  return { title: `Attribute: ${title}`, description, defaultOpen, table, sections };
}

function buildProfSection(storeId: string, variableName: string, label: string, isDC = false): Phase1StatSection {
  const variable = getVariable<VariableProf>(storeId, variableName);
  const rank = variable ? compileProficiencyType(variable.value) : 'U';
  const rankLabel = proficiencyTypeToLabel(rank);
  const parts = getProfValueParts(storeId, variableName);
  const modifier = parseSigned(getFinalProfValue(storeId, variableName, isDC));
  const terms: Phase1SkillBreakdownTerm[] = [];

  if (parts) {
    terms.push({ label: `${rankLabel} proficiency`, value: parts.profValue, detail: `You're ${rankLabel.toLowerCase()} in this proficiency, resulting in a ${signedText(parts.profValue)} bonus.` });
    const profWithoutLevel = Boolean(getVariable<VariableBool>(storeId, 'PROF_WITHOUT_LEVEL')?.value);
    terms.push({
      label: 'Level',
      value: parts.level,
      detail: profWithoutLevel
        ? rank === 'U'
          ? "Because you're untrained in this proficiency, you have a -2 modifier because of your variant rule."
          : `Even though you're ${rankLabel.toLowerCase()} in this proficiency, you don't add your level because of your variant rule.`
        : rank === 'U'
          ? "Because you're untrained in this proficiency, you don't add your level."
          : `Because you're ${rankLabel.toLowerCase()} in this proficiency, you add your level.`,
    });
    if (parts.attributeMod !== null) {
      const attribute = toLabel(variable?.value.attribute ?? 'Associated attribute');
      terms.push({ label: `${attribute} modifier`, value: parts.attributeMod, detail: `This proficiency is associated with ${attribute}, so you add your ${attribute} modifier.` });
    }
    pushBonusTerms(terms, parts.breakdown.bonuses);
  }

  const finalLabel = isDC ? String(modifier) : signedText(modifier);

  return {
    id: label.toLowerCase().replace(/\s+/g, '-'),
    label,
    value: isDC ? finalLabel : signedText(modifier),
    breakdown: {
      finalLabel,
      prefix: isDC ? '10 + ' : undefined,
      terms,
      conditionals: parts?.breakdown.conditionals ?? [],
    },
    timeline: variableTimeline(storeId, variableName),
  };
}

function buildSpeedSection(storeId: string, variable: VariableNum, entity: Parameters<typeof getSpeedValue>[2]): Phase1StatSection | null {
  const breakdown = getVariableBreakdown(storeId, variable.name);
  const finalData = getSpeedValue(storeId, variable, entity);
  if (finalData.value === 0) return null;

  const terms: Phase1SkillBreakdownTerm[] = [
    { label: 'Base speed', value: finalData.value, detail: 'This is your base value in the speed.' },
  ];
  pushBonusTerms(terms, breakdown.bonuses);

  return {
    id: variable.name,
    label: variable.name === 'SPEED' ? 'Normal' : toLabel(variable.name.replace('SPEED_', '')),
    value: `${finalData.total} feet`,
    breakdown: {
      finalLabel: String(finalData.total),
      terms,
      conditionals: breakdown.conditionals,
    },
    timeline: variableTimeline(storeId, variable.name),
  };
}

function buildHealthSection(storeId: string): Phase1StatSection {
  const parts = getHealthValueParts(storeId);
  const maxHp = getFinalHealthValue(storeId);
  const terms: Phase1SkillBreakdownTerm[] = [
    { label: 'Class HP per level', value: parts.classHp, detail: 'This is the base hit points from your class. You gain this amount every level.' },
    { label: 'Constitution modifier', value: parts.conMod, detail: 'You add your Constitution modifier to the hit points you gain every level.' },
    { label: 'Level', value: parts.level, detail: 'This is your current level.' },
    { label: 'Ancestry HP', value: parts.ancestryHp, detail: 'This is the base hit points from your ancestry. You gain this amount once at level 1.' },
  ];
  if (parts.bonusHp > 0 && parts.breakdown.bonusValue === 0) {
    terms.push({ label: 'Bonus HP', value: parts.bonusHp, detail: "This is additional hit points you've gained from various sources." });
  }
  pushBonusTerms(terms, parts.breakdown.bonuses);

  const infix: Phase1BreakdownInfix[] = [
    { kind: 'text', text: `${maxHp} = (` },
    { kind: 'index', index: 0 },
    { kind: 'text', text: ' + ' },
    { kind: 'index', index: 1 },
    { kind: 'text', text: ') × ' },
    { kind: 'index', index: 2 },
    { kind: 'text', text: ' + ' },
    { kind: 'index', index: 3 },
  ];
  for (let index = 4; index < terms.length; index += 1) {
    infix.push({ kind: 'text', text: ' + ' }, { kind: 'index', index });
  }

  return {
    id: 'max-hp',
    label: 'Maximum HP',
    value: String(maxHp),
    breakdown: { finalLabel: String(maxHp), terms, conditionals: parts.breakdown.conditionals, infix },
  };
}

function buildAcSection(storeId: string, armorName: string, item: Parameters<typeof getAcParts>[1]): Phase1StatSection {
  const parts = getAcParts(storeId, item);
  const acBonus = getVariableBreakdown(storeId, 'AC_BONUS');
  const total = getFinalAcValue(storeId, item);
  const terms: Phase1SkillBreakdownTerm[] = [
    { label: 'Proficiency', value: parts.profBonus, detail: `Your proficiency bonus from wearing ${armorName}.` },
    { label: 'Dexterity modifier', value: parts.dexBonus, detail: "Your Armor Class is associated with the Dexterity attribute, so you add your Dexterity modifier (with a maximum benefit determined by the armor's Dex Cap)." },
    { label: 'Armor bonus', value: parts.armorBonus, detail: "The item bonus provided by the armor you're wearing." },
  ];
  if (acBonus.baseValue !== 0) {
    terms.push({ label: 'Base modifier', value: acBonus.baseValue, detail: 'An additional base modifier adjusting your Armor Class.' });
  }
  pushBonusTerms(terms, acBonus.bonuses);

  return {
    id: 'ac',
    label: 'Armor Class',
    value: String(total),
    breakdown: { finalLabel: String(total), prefix: '10 + ', terms, conditionals: acBonus.conditionals },
  };
}

function buildAttributeSection(storeId: string, id: string, variableName: string, label: string): Phase1StatSection {
  const total = getFinalVariableValue(storeId, variableName).total;
  const history = getVariableHistory(storeId, variableName).map((entry) => {
    const from = formatAttributeValue(entry.from);
    const to = formatAttributeValue(entry.to);
    if (from === to) return null;
    return { type: 'ADJUSTMENT' as const, title: from ? `${from} to ${to}` : to, description: `From ${entry.source}`, timestamp: entry.timestamp };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const bonuses = getVariableBonuses(storeId, variableName).map((bonus) => ({
    type: 'BONUS' as const,
    title: getBonusText(bonus),
    description: `From ${bonus.source}`,
    timestamp: bonus.timestamp,
  }));

  return {
    id,
    label,
    value: signedText(total),
    timeline: [...history, ...bonuses].sort((a, b) => a.timestamp - b.timestamp),
  };
}

function senseGroup(id: string, label: string, senses: SenseWithRange[], emptyText: string): Phase1ActiveGroup {
  return {
    id,
    label,
    description: SENSE_DESCRIPTIONS[id],
    emptyText,
    items: senses.map((sense) => ({
      name: displaySense(sense).trim(),
      href: sense.sense?.id && String(sense.sense.id).length < 10 ? `link_sense_${sense.sense.id}` : undefined,
    })),
  };
}

function mergeSenses(collected: SenseWithRange[], raw: string[]): SenseWithRange[] {
  if (raw.length <= collected.length) return collected;
  const extras = raw
    .map((value) => {
      const parts = value.split(',');
      const senseName = toLabel(parts[0]);
      const range = parts.length > 1 ? (parts[parts.length - 1] ?? '').trim() : '';
      const existing = collected.find((sense) => sense.senseName.toLowerCase() === senseName.toLowerCase());
      return existing ?? { senseName, range, sense: undefined };
    })
    .filter((item) => item.senseName);
  const seen = new Set<string>();
  return extras.filter((item) => {
    const key = `${item.senseName.toLowerCase()}:${item.range}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resistGroup(id: string, label: string, values: string[], description: string, emptyText: string): Phase1ActiveGroup {
  return {
    id,
    label,
    description,
    emptyText,
    items: values.map((name) => ({ name })),
  };
}

function buildAttributeTable(storeId: string): Phase1AttributeTable {
  const attributes = ATTR_KEYS.map(([, variableName, label]) => ({
    variableName,
    label,
    variable: getVariable<VariableAttr>(storeId, variableName),
  }));
  const sourceRecords: Record<string, Array<number | null | 'partial'>> = {};
  for (const [attrIndex, attribute] of attributes.entries()) {
    for (const record of getVariableHistory(storeId, attribute.variableName)) {
      if (!sourceRecords[record.source]) sourceRecords[record.source] = Array(attributes.length).fill(null);
      const to = record.to as AttributeValue;
      const from = (record.from as AttributeValue | null) ?? null;
      const existing = sourceRecords[record.source][attrIndex];
      const existingNum = existing === 'partial' || existing == null ? 0 : existing;
      sourceRecords[record.source][attrIndex] = existingNum + (to.value > (from?.value ?? 0) ? 1 : -1);
      if (!from?.partial && to.partial) sourceRecords[record.source][attrIndex] = 'partial';
    }
  }
  const sources = Object.keys(sourceRecords).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const ordered = [...sources.filter((source) => !source.toLowerCase().trim().startsWith('attribute')), ...sources.filter((source) => source.toLowerCase().trim().startsWith('attribute'))];
  return {
    columns: attributes.map((attribute) => compactLabels(attribute.label)),
    rows: ordered.map((source) => ({ source, values: sourceRecords[source] })),
    totals: attributes.map((attribute) => ({ value: attribute.variable?.value.value ?? 0, partial: Boolean(attribute.variable?.value.partial) })),
  };
}

function variableTimeline(storeId: string, variableName: string): Phase1SkillTimelineItem[] {
  const history = getVariableHistory(storeId, variableName).map((entry) => {
    const from = isProficiencyValue(entry.from) ? proficiencyTypeToLabel(compileProficiencyType(entry.from)) : stringifyHistoryValue(entry.from);
    const to = isProficiencyValue(entry.to) ? proficiencyTypeToLabel(compileProficiencyType(entry.to)) : stringifyHistoryValue(entry.to);
    if (from === to) return null;
    return { type: 'ADJUSTMENT' as const, title: from && from !== to ? `${from} to ${to}` : to, description: `From ${entry.source}`, timestamp: entry.timestamp };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const bonuses = getVariableBonuses(storeId, variableName).map((bonus) => ({
    type: 'BONUS' as const,
    title: getBonusText(bonus),
    description: `From ${bonus.source}`,
    timestamp: bonus.timestamp,
  }));
  return [...history, ...bonuses].sort((a, b) => a.timestamp - b.timestamp);
}

function pushBonusTerms(terms: Phase1SkillBreakdownTerm[], bonuses: Map<string, { value: number; composition: Array<{ amount: number; source: string }> }>) {
  for (const [label, bonus] of bonuses.entries()) {
    terms.push({
      label,
      value: bonus.value,
      detail: label.startsWith('untyped ') ? 'All untyped modifiers are combined.' : `Your ${label}. Use the greatest from the following:`,
      sources: bonus.composition,
    });
  }
}

function formatAttributeValue(value: unknown) {
  if (value && typeof value === 'object' && 'value' in value) {
    const attr = value as AttributeValue;
    return signedText(Number(attr.value));
  }
  return stringifyHistoryValue(value);
}

function stringifyHistoryValue(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && 'value' in value) return String((value as { value: unknown }).value ?? '');
  return '';
}

function signedText(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}

function parseSigned(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

const ATTR_DESCRIPTIONS = {
  strength: "Strength measures your character's physical power. Strength is important if your character plans to engage in hand-to-hand combat. Your Strength modifier gets added to melee damage rolls and determines how much your character can carry.",
  dexterity: "Dexterity measures your character's agility, balance, and reflexes. Dexterity is important if your character plans to make attacks with ranged weapons or use stealth to surprise foes. Your Dexterity modifier is also added to your character's AC and Reflex saving throws.",
  constitution: "Constitution measures your character's health and stamina. Constitution is important for all characters, especially those who fight in close range. Your Constitution modifier is added to your Hit Points and Fortitude saving throws.",
  intelligence: "Intelligence measures how well your character can learn and reason. A high Intelligence allows your character to analyze situations and understand patterns, and it means they can become trained in additional skills and might be able to master additional languages.",
  wisdom: "Wisdom measures your character's common sense, awareness, and intuition. High Wisdom helps your character detect hidden things and resist mental effects. Your Wisdom modifier is added to your Perception and Will saving throws.",
  charisma: "Charisma measures your character's personal magnetism and strength of personality. A high Charisma modifier helps you build relationships and influence the thoughts and moods of others with social skills.",
};

function profDescription(variableName: string) {
  if (variableName.startsWith('SKILL_LORE_')) return PROF_DESCRIPTIONS.SKILL_LORE;
  return PROF_DESCRIPTIONS[variableName] ?? 'No description available for this proficiency.';
}

const PROF_DESCRIPTIONS: Record<string, string> = {
  CLASS_DC: "A class DC sets the difficulty for certain abilities granted by your character's class.",
  SPELL_ATTACK: 'Some spells require you to succeed at a spell attack roll to affect the target. This is usually because they require you to precisely aim a ray or otherwise make an accurate attack. A spell attack roll is compared to the target\'s AC. Spell attack rolls benefit from any bonuses or penalties to attack rolls, including your multiple attack penalty, but not any special benefits or penalties that apply only to weapon or unarmed attacks. Spell attacks don\'t deal any damage beyond what\'s listed in the spell description.',
  SPELL_DC: 'Many times, instead of requiring you to make a spell attack roll, the spells you cast will require those within the area or targeted by the spell to attempt a saving throw against your spell DC to determine how the spell affects them.',
  LIGHT_ARMOR: 'Made from supple and thin materials, light armor favors agile adventurers since it offers some protection without sacrificing much mobility.',
  MEDIUM_ARMOR: 'Medium armor offers more protection than light armor, but it also impairs movement more.',
  HEAVY_ARMOR: 'Of all the armor categories, heavy armor offers the best protection. These suits of armor cover the entire body and are designed to stop a wide range of attacks.',
  UNARMORED_DEFENSE: "Clothing or simple robes offer little protection, but they don't hinder your movement.",
  LIGHT_BARDING: 'Made from supple and thin materials, light barding favors agile companions since it offers some protection without sacrificing much mobility.',
  HEAVY_BARDING: 'Of all forms of barding, heavy barding offers the best protection for companions. These suits of armor cover the entire body and are designed to stop a wide range of attacks.',
  SIMPLE_WEAPONS: 'These weapons are basic armaments that most characters can wield effectively, regardless of their class or skill level.',
  MARTIAL_WEAPONS: 'These weapons typically offer higher damage outputs and more diverse combat features but require further training.',
  ADVANCED_WEAPONS: 'These weapons are rare and exotic, and they often have special abilities that set them apart from other weapons.',
  UNARMED_ATTACKS: 'Almost all characters start out trained in unarmed attacks. You can Strike with your fist or another body part, calculating your attack and damage rolls in the same way you would with a weapon. Unarmed attacks can belong to a weapon group, and they might have weapon traits. However, unarmed attacks aren\'t weapons, and effects and abilities that work with weapons never work with unarmed attacks unless they specifically say so.',
  SKILL_LORE: 'You have specialized information on a narrow topic. Lore features many subcategories. The GM determines what other subcategories they\'ll allow as Lore skills, though these categories are always less broad than any of the other skills that allow you to Recall Knowledge.',
};

const SAVE_DESCRIPTIONS = {
  fortitude: "A Fortitude saving throw is used when your character's health or vitality is under attack, such as from poison or disease.",
  reflex: 'A Reflex saving throw is called for when your character must dodge away from danger, usually something that affects a large area, such as the scorching blast of a fireball spell.',
  will: "A Will saving throw is often your defense against spells and effects that target your character's mind, such as a charm or confusion spell.",
};

const SENSE_DESCRIPTIONS: Record<string, string> = {
  precise: 'A precise sense is one that can be used to perceive the world in nuanced detail. The only way to target a creature without having drawbacks is to use a precise sense. You can usually detect a creature automatically with a precise sense unless that creature is hiding or obscured by the environment, in which case you can use the Seek basic action to better detect the creature.',
  imprecise: "An imprecise sense can't detect the full range of detail that a precise sense can. You can usually sense a creature automatically with an imprecise sense, but it has the hidden condition instead of the observed condition. It might be undetected by you if it's using Stealth or is in an environment that distorts the sense. In those cases, you have to use the Seek basic action to detect the creature. At best, an imprecise sense can be used to make an undetected creature merely hidden — it can't make the creature observed.",
  vague: "A vague sense is one that can alert you that something is there but isn't useful for zeroing in on it to determine exactly what it is. At best, a vague sense can be used to detect the presence of an unnoticed creature, making it undetected. Even then, the vague sense isn't sufficient to make the creature hidden or observed.",
};

const RESIST_DESCRIPTION = 'If you have resistance to a type of damage, each time you take that type of damage, reduce the amount of damage you take by the listed number (to a minimum of 0 damage). A single effect can activate more than one resistance at a time, but subtracts each of the subject\'s resistances only once. If the subject has more than one resistance to the same damage type, they apply only one, usually the highest. For a resistance to a category including multiple damage types, like resistance to physical damage, to spells, or to all damage, if the subject is taking damage of multiple types included in the category, the subject can choose which damage type to use the resistance against.';
const WEAK_DESCRIPTION = 'If you have a weakness to a certain type of damage, that type of damage is extra effective against you. Whenever you would take that type of damage, increase the amount of damage by the value of the weakness. For instance, if you are dealt 2d6 fire damage and have weakness 5 to fire, you take 2d6+5 fire damage. A single effect can activate more than one weakness at a time, but adds each of the subject\'s weaknesses only once. Some weaknesses can apply when a creature wouldn\'t normally take damage, as determined by the GM.';
const IMMUNE_DESCRIPTION = "When you have immunity to a specific type of damage, you ignore all damage of that type. If you have immunity to a specific condition or type of effect, you can't be affected by that condition or any effect of that type. You can still be targeted by an ability that includes an effect or condition you are immune to; you just don't apply that particular effect or condition. If you have immunity to effects with a certain trait (such as death effects, poison, or disease), you are unaffected by effects with that trait.";
