export type TacticsSide = 'enemy' | 'ally';

export type TacticsCondition = { name: string; value?: number };

export type TacticsAbilityKind = 'strike' | 'area' | 'heal' | 'buff' | 'aid' | 'skill' | 'other';

export type TacticsAbility = {
  id: string;
  name: string;
  actions: number;
  actionsMax?: number;
  traits: string[];
  rangeFeet?: number;
  areaFeet?: number;
  areaShape?: string;
  attackBonus?: number;
  damage?: string;
  save?: 'fortitude' | 'reflex' | 'will';
  dc?: number;
  frequency?: string;
  usesMax?: number;
  description: string;
  kind: TacticsAbilityKind;
  agile: boolean;
  concentrate: boolean;
  concealed: boolean;
  hidden: boolean;
  fascinates: boolean;
};

export type TacticsCombatant = {
  id: string;
  name: string;
  side: TacticsSide;
  level?: number;
  size?: string;
  hpCurrent: number;
  hpMax: number;
  ac?: number;
  conditions: TacticsCondition[];
  perception?: number;
  fortitude?: number;
  reflex?: number;
  will?: number;
  speedFeet?: number;
  description?: string;
  abilities: TacticsAbility[];
};

export type TacticsSpend = { combatantId: string; abilityId: string; used: number };

export type TacticsChoice = {
  id: string;
  text: string;
  lines: string[];
  score: number;
  tip: string;
  abilityIds: string[];
  source: 'menu';
};

export type TacticsSnapshot = {
  snapshotId: string;
  campaignId: number;
  encounterId: number;
  round: number;
  enemyId: string;
  combatants: TacticsCombatant[];
  spends: TacticsSpend[];
  choices: TacticsChoice[];
};
