import { convertToSize } from '@upload/foundry-utils';
import type { Creature } from '@schemas/content';
import type { VariableListStr, VariableProf, VariableStr } from '@schemas/variables';
import { pluralize, toLabel } from '@utils/strings';
import { getFinalProfValue } from '@variables/variable-helpers';
import {
  getAllAncestryTraitVariables,
  getAllArmorGroupVariables,
  getAllArmorVariables,
  getAllWeaponGroupVariables,
  getAllWeaponVariables,
  getVariable,
} from '@variables/variable-manager';
import { compileProficiencyType, variableToLabel } from '@variables/variable-utils';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type Phase1LinkedName = { name: string; href?: string };

export type Phase1ProfRow = {
  variableName: string;
  label: string;
  rank: string;
  value?: string;
  isDC?: boolean;
};

export type Phase1ProfGroup = {
  id: string;
  label: string;
  items: Phase1ProfRow[];
};

export type Phase1EntityDetails = {
  description: string;
  info: Array<{ label: string; value: string }>;
  languages: Phase1LinkedName[];
  traits: Phase1LinkedName[];
  rarity?: string;
  size: string;
  profGroups: Phase1ProfGroup[];
};

const INFO_FIELDS: Array<[string, string]> = [
  ['appearance', 'Appearance'],
  ['personality', 'Personality'],
  ['alignment', 'Alignment'],
  ['beliefs', 'Beliefs'],
  ['age', 'Age'],
  ['height', 'Height'],
  ['weight', 'Weight'],
  ['gender', 'Gender'],
  ['pronouns', 'Pronouns'],
  ['faction', 'Faction'],
  ['ethnicity', 'Ethnicity'],
  ['nationality', 'Nationality'],
  ['birthplace', 'Birthplace'],
];

export async function loadEntityDetails(combatant: Phase1EntityCombatant): Promise<Phase1EntityDetails> {
  const { entity, content, storeId, kind } = await preparePhase1Entity(combatant);
  const languages = (getVariable<VariableListStr>(storeId, 'LANGUAGE_IDS')?.value ?? []).map((langId) => {
    const language = content.languages.find((item) => `${item.id}` === langId);
    return {
      name: language?.name ?? 'Unknown',
      href: language?.id ? `link_language_${language.id}` : undefined,
    };
  });
  const traits = getAllAncestryTraitVariables(storeId).map((variable) => {
    const trait = content.traits.find((item) => item.id === variable.value);
    return {
      name: trait?.name ?? 'Unknown',
      href: trait?.id ? `link_trait_${trait.id}` : undefined,
    };
  });
  const rarity = kind === 'CREATURE' ? (entity as Creature).rarity : undefined;
  const size = toLabel(convertToSize(getVariable<VariableStr>(storeId, 'SIZE')?.value));
  const infoRecord = ((entity.details as { info?: Record<string, unknown> } | undefined)?.info) ?? {};
  const info = INFO_FIELDS.flatMap(([key, label]) => {
    const value = infoRecord[key];
    return typeof value === 'string' && value.trim() ? [{ label, value: value.trim() }] : [];
  });
  const description = ((entity.details as { description?: string } | undefined)?.description ?? '').trim();

  return {
    description,
    info,
    languages,
    traits,
    rarity: rarity && rarity !== 'COMMON' ? toLabel(rarity) : rarity === 'COMMON' ? 'Common' : undefined,
    size,
    profGroups: buildProfGroups(storeId),
  };
}

function buildProfGroups(storeId: string): Phase1ProfGroup[] {
  const lightBarding = compileProficiencyType(getVariable<VariableProf>(storeId, 'LIGHT_BARDING')?.value);
  const heavyBarding = compileProficiencyType(getVariable<VariableProf>(storeId, 'HEAVY_BARDING')?.value);
  const defenses: Phase1ProfRow[] = [];
  if (lightBarding !== 'U' || heavyBarding !== 'U') {
    defenses.push(profRow(storeId, 'LIGHT_BARDING', 'Light Barding'), profRow(storeId, 'HEAVY_BARDING', 'Heavy Barding'));
  }
  defenses.push(
    profRow(storeId, 'LIGHT_ARMOR', 'Light Armor'),
    profRow(storeId, 'MEDIUM_ARMOR', 'Medium Armor'),
    profRow(storeId, 'HEAVY_ARMOR', 'Heavy Armor'),
    profRow(storeId, 'UNARMORED_DEFENSE', 'Unarmored Defense'),
  );

  return [
    {
      id: 'attacks',
      label: 'Attacks',
      items: [
        profRow(storeId, 'SIMPLE_WEAPONS', 'Simple Weapons'),
        profRow(storeId, 'MARTIAL_WEAPONS', 'Martial Weapons'),
        profRow(storeId, 'ADVANCED_WEAPONS', 'Advanced Weapons'),
        profRow(storeId, 'UNARMED_ATTACKS', 'Unarmed Attacks'),
      ],
    },
    { id: 'defenses', label: 'Defenses', items: defenses },
    {
      id: 'spellcasting',
      label: 'Spellcasting',
      items: [
        profRow(storeId, 'SPELL_ATTACK', 'Spell Attack', { showValue: true }),
        profRow(storeId, 'SPELL_DC', 'Spell DC', { showValue: true, isDC: true }),
      ],
    },
    trainedGroup(storeId, 'weapons', 'Weapons', getAllWeaponVariables(storeId), true),
    trainedGroup(storeId, 'weapon-groups', 'Weapon Groups', getAllWeaponGroupVariables(storeId)),
    trainedGroup(storeId, 'armor', 'Armor', getAllArmorVariables(storeId)),
    trainedGroup(storeId, 'armor-groups', 'Armor Groups', getAllArmorGroupVariables(storeId)),
    { id: 'class-dc', label: 'Class DC', items: [profRow(storeId, 'CLASS_DC', 'Class DC', { showValue: true, isDC: true })] },
  ].filter((group) => group.items.length > 0);
}

function trainedGroup(storeId: string, id: string, label: string, variables: VariableProf[], usePlural = false): Phase1ProfGroup {
  return {
    id,
    label,
    items: variables
      .filter((variable) => compileProficiencyType(variable.value) !== 'U')
      .map((variable) => profRow(storeId, variable.name, usePlural ? pluralize(variableToLabel(variable)) : variableToLabel(variable))),
  };
}

function profRow(storeId: string, variableName: string, label: string, options?: { showValue?: boolean; isDC?: boolean }): Phase1ProfRow {
  return {
    variableName,
    label,
    rank: compileProficiencyType(getVariable<VariableProf>(storeId, variableName)?.value),
    value: options?.showValue ? getFinalProfValue(storeId, variableName, options.isDC) : undefined,
    isDC: options?.isDC,
  };
}
