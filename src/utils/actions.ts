import { ActionCost } from '@schemas/content';

/** Glyph ids used by the old ActionIcons font and `action_symbol_N` rich text. */
export type ActionGlyphId = 1 | 2 | 3 | 4 | 5;

type ActionGlyphEntry = {
  id: ActionGlyphId;
  cost: Exclude<ActionCost, null>;
  label: string;
  aliases: string[];
};

/**
 * Standard PF2e action-cost key.
 * Maps canonical costs, leftover prose ("Single Action"), digits from the old
 * ActionIcons font, and common unicode stand-ins to the 2e glyph.
 */
export const ACTION_GLYPH_KEY: Record<ActionGlyphId, ActionGlyphEntry> = {
  1: {
    id: 1,
    cost: 'ONE-ACTION',
    label: 'Single Action',
    aliases: ['1', 'one-action', 'one action', 'single action', 'single-action', '◆'],
  },
  2: {
    id: 2,
    cost: 'TWO-ACTIONS',
    label: 'Two Actions',
    aliases: ['2', 'two-actions', 'two-action', 'two actions', 'two action', '◆◆'],
  },
  3: {
    id: 3,
    cost: 'THREE-ACTIONS',
    label: 'Three Actions',
    aliases: ['3', 'three-actions', 'three-action', 'three actions', 'three action', '◆◆◆'],
  },
  4: {
    id: 4,
    cost: 'FREE-ACTION',
    label: 'Free Action',
    aliases: ['4', 'free-action', 'free action', '◇'],
  },
  5: {
    id: 5,
    cost: 'REACTION',
    label: 'Reaction',
    aliases: ['5', 'reaction', '⤾', '↩', '⟳', '⤴', '↻'],
  },
};

const ACTION_GLYPH_LOOKUP = (() => {
  const map = new Map<string, ActionGlyphEntry>();
  for (const entry of Object.values(ACTION_GLYPH_KEY)) {
    map.set(entry.cost, entry);
    map.set(String(entry.id), entry);
    map.set(`action_symbol_${entry.id}`, entry);
    map.set(entry.label, entry);
    for (const alias of entry.aliases) {
      map.set(alias, entry);
    }
  }
  return map;
})();

function normalizeActionGlyphInput(value: string): string {
  return value
    .replace(/^`+|`+$/g, '')
    .replace(/^\[|\]$/g, '')
    .trim()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function resolveActionGlyph(value: string | number | null | undefined): ActionGlyphEntry | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const direct = ACTION_GLYPH_LOOKUP.get(raw) ?? ACTION_GLYPH_LOOKUP.get(raw.toUpperCase());
  if (direct) return direct;

  const normalized = normalizeActionGlyphInput(raw);
  return ACTION_GLYPH_LOOKUP.get(normalized) ?? ACTION_GLYPH_LOOKUP.get(normalized.toUpperCase()) ?? null;
}

export function actionCostToSpokenLabel(cost: ActionCost | string | null | undefined): string {
  const glyph = resolveActionGlyph(cost);
  if (glyph) return glyph.label;
  if (!cost) return '';
  return String(cost).toLowerCase().replaceAll('-', ' ');
}

/** Pull leftover "Single Action" / unicode glyph labels out of an ability name. */
export function stripActionCostLabels(name: string): { name: string; cost: ActionCost } {
  if (!name) return { name: '', cost: null };

  let text = name;
  let cost: ActionCost = null;

  const apply = (pattern: RegExp, next: Exclude<ActionCost, null>) => {
    const match = new RegExp(pattern.source, pattern.flags);
    if (!match.test(text)) return;
    cost = cost ?? next;
    text = text.replace(new RegExp(pattern.source, pattern.flags), ' ');
  };

  apply(/\[(?:one|1)[- ]actions?\]/gi, 'ONE-ACTION');
  apply(/\[(?:two|2)[- ]actions?\]/gi, 'TWO-ACTIONS');
  apply(/\[(?:three|3)[- ]actions?\]/gi, 'THREE-ACTIONS');
  apply(/\[(?:free)[- ]actions?\]/gi, 'FREE-ACTION');
  apply(/\[(?:reaction|r)\]/gi, 'REACTION');
  apply(/\b(?:single|one)[- ]actions?\b/gi, 'ONE-ACTION');
  apply(/\btwo[- ]actions?\b/gi, 'TWO-ACTIONS');
  apply(/\bthree[- ]actions?\b/gi, 'THREE-ACTIONS');
  apply(/\bfree[- ]actions?\b/gi, 'FREE-ACTION');
  apply(/[◆]{3}/g, 'THREE-ACTIONS');
  apply(/[◆]{2}/g, 'TWO-ACTIONS');
  apply(/◆/g, 'ONE-ACTION');
  apply(/◇/g, 'FREE-ACTION');
  apply(/[⤾↩⟳⤴↻]/g, 'REACTION');

  return { name: text.replace(/\s+/g, ' ').trim(), cost };
}

export function abilityNameAndCost(
  name: string,
  cost?: ActionCost | string | null
): { name: string; cost: ActionCost } {
  const stripped = stripActionCostLabels(name);
  const resolved = resolveActionGlyph(cost ?? undefined);
  return { name: stripped.name, cost: resolved?.cost ?? stripped.cost };
}

export function convertCastToActionCost(cast: string): ActionCost | string {
  if (cast === '1') {
    return 'ONE-ACTION';
  } else if (cast === '2') {
    return 'TWO-ACTIONS';
  } else if (cast === '3') {
    return 'THREE-ACTIONS';
  } else if (cast === 'reaction') {
    return 'REACTION';
  } else if (cast === 'free') {
    return 'FREE-ACTION';
  } else if (cast === '1 or 2' || cast === '1 to 2') {
    return 'ONE-TO-TWO-ACTIONS';
  } else if (cast === '2 or 3' || cast === '2 to 3') {
    return 'TWO-TO-THREE-ACTIONS';
  } else if (cast === '1 to 3') {
    return 'ONE-TO-THREE-ACTIONS';
  } else if (cast === '2 to 2 rounds') {
    return 'TWO-TO-TWO-ROUNDS';
  } else if (cast === '2 to 3 rounds') {
    return 'TWO-TO-THREE-ROUNDS';
  } else if (cast === '3 to 2 rounds') {
    return 'THREE-TO-TWO-ROUNDS';
  } else if (cast === '3 to 3 rounds') {
    return 'THREE-TO-THREE-ROUNDS';
  } else {
    return cast;
  }
}

export function actionCostToLabel(cost: ActionCost | string, alt?: boolean): string {
  let result = '';
  switch (cost) {
    case 'ONE-ACTION':
      result = '◆';
      break;
    case 'TWO-ACTIONS':
      result = '◆◆';
      break;
    case 'THREE-ACTIONS':
      result = '◆◆◆';
      break;
    case 'REACTION':
      result = '⤾';
      break;
    case 'FREE-ACTION':
      result = '◇';
      break;
    case 'ONE-TO-TWO-ACTIONS':
      result = '◆ - ◆◆';
      break;
    case 'TWO-TO-THREE-ACTIONS':
      result = '◆◆ - ◆◆◆';
      break;
    case 'ONE-TO-THREE-ACTIONS':
      result = '◆ - ◆◆◆';
      break;
    case 'TWO-TO-TWO-ROUNDS':
      result = '◆◆ - 2 rounds';
      break;
    case 'TWO-TO-THREE-ROUNDS':
      result = '◆◆ - 3 rounds';
      break;
    case 'THREE-TO-TWO-ROUNDS':
      result = '◆◆◆ - 2 rounds';
      break;
    case 'THREE-TO-THREE-ROUNDS':
      result = '◆◆◆ - 3 rounds';
      break;
    default:
      result = cost ?? '';
      break;
  }
  if (alt) {
    result = result.replaceAll('◆', '>');
    result = result.replaceAll('◇', 'free');
    result = result.replaceAll('⤾', 'reaction');
  }
  return result;
}

export function findActions(text: string): ActionCost[] {
  const regex = /cost="([^"]*)"/g;
  return Array.from(text.matchAll(regex), (m) => m[1]) as ActionCost[];
}

export function actionCostToRichTextInsert(cost: ActionCost | string): string {
  let result = '';
  switch (cost) {
    case 'ONE-ACTION':
      result = '`action_symbol_1`';
      break;
    case 'TWO-ACTIONS':
      result = '`action_symbol_2`';
      break;
    case 'THREE-ACTIONS':
      result = '`action_symbol_3`';
      break;
    case 'REACTION':
      result = '`action_symbol_5`';
      break;
    case 'FREE-ACTION':
      result = '`action_symbol_4`';
      break;
    case 'ONE-TO-TWO-ACTIONS':
      result = '`action_symbol_1` - `action_symbol_2`';
      break;
    case 'TWO-TO-THREE-ACTIONS':
      result = '`action_symbol_2` - `action_symbol_3`';
      break;
    case 'ONE-TO-THREE-ACTIONS':
      result = '`action_symbol_1` - `action_symbol_3`';
      break;
    case 'TWO-TO-TWO-ROUNDS':
      result = '`action_symbol_2` - 2 rounds';
      break;
    case 'TWO-TO-THREE-ROUNDS':
      result = '`action_symbol_2` - 3 rounds';
      break;
    case 'THREE-TO-TWO-ROUNDS':
      result = '`action_symbol_3` - 2 rounds';
      break;
    case 'THREE-TO-THREE-ROUNDS':
      result = '`action_symbol_3` - 3 rounds';
      break;
    default:
      result = cost ?? '';
      break;
  }
  return result;
}
