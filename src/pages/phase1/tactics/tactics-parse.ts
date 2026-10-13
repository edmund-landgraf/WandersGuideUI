import type { TacticsAbility, TacticsAbilityKind } from './tactics-types';

const ACTION_COUNTS: Record<string, number> = {
  'FREE-ACTION': 0,
  REACTION: 0,
  'ONE-ACTION': 1,
  'TWO-ACTIONS': 2,
  'THREE-ACTIONS': 3,
  'ONE-TO-TWO-ACTIONS': 1,
  'ONE-TO-THREE-ACTIONS': 1,
  'TWO-TO-THREE-ACTIONS': 2,
};

const ACTION_MAX: Record<string, number> = {
  'ONE-TO-TWO-ACTIONS': 2,
  'ONE-TO-THREE-ACTIONS': 3,
  'TWO-TO-THREE-ACTIONS': 3,
};

export function actionCount(actions: string | null | undefined, description: string): number {
  if (actions && ACTION_COUNTS[actions] != null) return ACTION_COUNTS[actions];
  const prose = `${actions ?? ''} ${description}`.toLowerCase();
  if (/\b(three-actions|three actions|3 actions)\b/.test(prose)) return 3;
  if (/\b(two-actions|two actions|2 actions)\b/.test(prose)) return 2;
  const glyphs = (description.match(/\[\[(one-action|two-actions|three-actions)\]\]/gi) ?? []);
  if (glyphs.some((glyph) => /three/i.test(glyph))) return 3;
  if (glyphs.some((glyph) => /two/i.test(glyph))) return 2;
  if (glyphs.length > 0) return 1;
  return 1;
}

function feetAfter(text: string, label: RegExp): number | undefined {
  const match = text.match(label);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function usesFromFrequency(frequency: string | null | undefined): number | undefined {
  if (!frequency) return undefined;
  const text = frequency.toLowerCase();
  if (/at[- ]will|unlimited/.test(text)) return undefined;
  const count = text.match(/(\d+)\s*(?:time|use)/);
  if (count) return Number(count[1]);
  if (/once|1\/day|per day|per hour|per minute/.test(text)) return 1;
  return undefined;
}

export function parseAbility(input: {
  id: string | number;
  name: string;
  actions?: string | null;
  traits?: string[];
  frequency?: string | null;
  description?: string | null;
}): TacticsAbility {
  const description = input.description ?? '';
  const blob = `${input.name}\n${description}\n${(input.traits ?? []).join(' ')}`.toLowerCase();
  const areaShape = blob.match(/\b(burst|emanation|cone|line)\b/)?.[1];
  const rangeFeet =
    feetAfter(blob, /range\s+(\d+)\s*(?:feet|ft)/) ??
    feetAfter(blob, /(\d+)\s*(?:-| )?feet range/) ??
    feetAfter(description, /(\d+)\s*(?:feet|ft)/i);
  const areaFeet = areaShape ? feetAfter(blob, new RegExp(`(\\d+)\\s*(?:-| )?(?:foot|feet|ft)[\\s-]*${areaShape}`)) ?? feetAfter(blob, new RegExp(`${areaShape}[^\\d]{0,12}(\\d+)`)) : undefined;
  const attack = description.match(/(?:strike|attack)[^\n+]{0,40}\+\s*(\d+)/i) ?? description.match(/\+\s*(\d+)/);
  const damage = description.match(/(\d+d\d+(?:\s*\+\s*\d+)?\s+[a-z]+)/i)?.[1];
  const saveName = blob.match(/\b(fortitude|reflex|will)\b/)?.[1] as TacticsAbility['save'] | undefined;
  const dc = Number(blob.match(/\bdc\s+(\d+)/)?.[1]);
  const kind = classify(blob, Boolean(areaShape));
  return {
    id: String(input.id),
    name: input.name,
    actions: actionCount(input.actions, description),
    actionsMax: input.actions ? ACTION_MAX[input.actions] : undefined,
    traits: input.traits ?? [],
    rangeFeet: kind === 'strike' || kind === 'skill' ? rangeFeet : rangeFeet,
    areaFeet,
    areaShape,
    attackBonus: attack ? Number(attack[1]) : undefined,
    damage,
    save: saveName,
    dc: Number.isFinite(dc) ? dc : undefined,
    frequency: input.frequency ?? undefined,
    usesMax: usesFromFrequency(input.frequency),
    description,
    kind,
    agile: /\bagile\b/.test(blob),
    concentrate: /\bconcentrate\b/.test(blob),
    concealed: /\bconcealed\b/.test(blob),
    hidden: /\bhidden\b/.test(blob),
    fascinates: /\bfascinat/.test(blob),
  };
}

function classify(blob: string, area: boolean): TacticsAbilityKind {
  if (/\baid\b/.test(blob) && !/\brecall knowledge\b/.test(blob)) return 'aid';
  if (/\b(heal|healing)\b/.test(blob) && !/\bdamage\b/.test(blob)) return 'heal';
  if (area) return 'area';
  if (/\b(demoralize|grapple|trip|shove|disarm)\b/.test(blob)) return 'skill';
  if (/\bstrike\b/.test(blob) || /\battack\b/.test(blob)) return 'strike';
  if (/\b(while adjacent|adjacent to an ally|\+\d status|\bbuff\b|bonus to)/.test(blob)) return 'buff';
  if (/\b(ally|allies)\b/.test(blob) && /\b(bonus|circumstance|status)\b/.test(blob)) return 'buff';
  return 'other';
}
