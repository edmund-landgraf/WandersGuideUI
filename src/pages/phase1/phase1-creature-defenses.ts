import { notePageToMarkdown, sourceImportPages } from '@pages/character_sheet/panels/gm-notes';
import type { Creature } from '@schemas/content';
import type { Operation, OperationAddBonusToValue, OperationAdjValue } from '@schemas/operations';
import { createDefaultOperation } from '@operations/operation-utils';
import { sign } from '@utils/numbers';
import { CleaningUtils } from '@ai/cleaning/CleaningUtils';

export type ParsedMonsterDefenses = {
  hp?: number;
  ac?: number;
  fort?: number;
  reflex?: number;
  will?: number;
  perception?: number;
};

const aonCache = new Map<string, ParsedMonsterDefenses | null>();
const pageCache = new Map<string, string | null>();

export function hasDefenseOperations(creature: Creature) {
  const ops = creature.operations ?? [];
  return ops.some((op) => {
    if (op.type !== 'adjValue' && op.type !== 'addBonusToValue') return false;
    const variable = (op.data as { variable?: string }).variable;
    return variable === 'MAX_HEALTH_BONUS' || variable === 'AC_BONUS' || variable === 'SAVE_FORT' || variable === 'SAVE_REFLEX' || variable === 'SAVE_WILL';
  });
}

export function hasUsefulCalculatedStats(stats?: { hp_max?: number; ac?: number } | null) {
  return Boolean(stats && ((typeof stats.hp_max === 'number' && stats.hp_max > 0) || (typeof stats.ac === 'number' && stats.ac > 10)));
}

export function creatureDefenseScore(creature: Creature) {
  let score = 0;
  if (hasDefenseOperations(creature)) score += 6;
  if (hasUsefulCalculatedStats(creature.meta_data?.calculated_stats)) score += 4;
  score += Math.min(creature.operations?.length ?? 0, 40) / 10;
  score += Math.min(creature.abilities_base?.length ?? 0, 20) / 20;
  return score;
}

export function creatureStatBlockText(creature: Creature) {
  const notes = sourceImportPages(creature.notes)
    .map((page) => notePageToMarkdown(page.contents))
    .filter(Boolean)
    .join('\n');
  return [creature.details?.description ?? '', notes].filter((part) => part.trim()).join('\n');
}

export function catalogCreatureName(name: string) {
  return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

export function parseMonsterDefenses(text: string): ParsedMonsterDefenses {
  const t = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return {};
  const capture = (re: RegExp) => {
    const match = t.match(re);
    if (!match) return undefined;
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    hp: capture(/\b(?:hit points|hp)\b[^0-9]{0,24}(\d{1,4})\b/i) ?? capture(/\b(\d{1,4})\s*(?:hit points|hp)\b/i),
    ac: capture(/\b(?:armor class|ac)\b[^0-9]{0,12}(\d{1,3})\b/i),
    fort: capture(/\b(?:fortitude|fort\.?)\b[^+\-\d]{0,10}([+-]?\d{1,2})\b/i),
    reflex: capture(/\b(?:reflex|ref\.?)\b[^+\-\d]{0,10}([+-]?\d{1,2})\b/i),
    will: capture(/\bwill\b[^+\-\d]{0,10}([+-]?\d{1,2})\b/i),
    perception: capture(/\bperception\b[^+\-\d]{0,10}([+-]?\d{1,2})\b/i),
  };
}

function hasParsedDefenses(parsed: ParsedMonsterDefenses) {
  return parsed.hp != null || parsed.ac != null || parsed.fort != null || parsed.reflex != null || parsed.will != null;
}

export function applyDefenses(creature: Creature, parsed: ParsedMonsterDefenses): Creature {
  if (!hasParsedDefenses(parsed)) return creature;
  const ops: Operation[] = [...(creature.operations ?? [])];
  if (parsed.ac != null) {
    ops.push({
      ...createDefaultOperation<OperationAdjValue>('adjValue'),
      data: { variable: 'AC_BONUS', value: parsed.ac - 10 },
    });
  }
  if (parsed.hp != null) {
    ops.push({
      ...createDefaultOperation<OperationAdjValue>('adjValue'),
      data: { variable: 'MAX_HEALTH_BONUS', value: parsed.hp },
    });
  }
  const save = (variable: string, value?: number) => {
    if (value == null) return;
    ops.push({
      ...createDefaultOperation<OperationAddBonusToValue>('addBonusToValue'),
      data: { variable, text: '', value: `${sign(value)}` },
    });
  };
  save('SAVE_FORT', parsed.fort);
  save('SAVE_REFLEX', parsed.reflex);
  save('SAVE_WILL', parsed.will);
  save('PERCEPTION', parsed.perception);

  const prof = (total?: number) => (total == null ? undefined : { total, type: 'U' as const });
  return {
    ...creature,
    operations: ops,
    hp_current: creature.hp_current && creature.hp_current > 1 ? creature.hp_current : parsed.hp ?? creature.hp_current,
    meta_data: {
      ...creature.meta_data,
      calculated_stats: {
        ...creature.meta_data?.calculated_stats,
        hp_max: parsed.hp ?? creature.meta_data?.calculated_stats?.hp_max,
        ac: parsed.ac ?? creature.meta_data?.calculated_stats?.ac,
        profs: {
          ...creature.meta_data?.calculated_stats?.profs,
          ...(parsed.fort != null ? { SAVE_FORT: prof(parsed.fort)! } : {}),
          ...(parsed.reflex != null ? { SAVE_REFLEX: prof(parsed.reflex)! } : {}),
          ...(parsed.will != null ? { SAVE_WILL: prof(parsed.will)! } : {}),
          ...(parsed.perception != null ? { PERCEPTION: prof(parsed.perception)! } : {}),
        },
      },
    },
  };
}

export function applyParsedDefenses(creature: Creature): Creature {
  if (hasDefenseOperations(creature) || hasUsefulCalculatedStats(creature.meta_data?.calculated_stats)) return creature;
  return applyDefenses(creature, parseMonsterDefenses(creatureStatBlockText(creature)));
}

function sourceUrls(creature: Creature) {
  const text = creatureStatBlockText(creature);
  return [...text.matchAll(/https?:\/\/[^\s)\]>'"]+/gi)].map((match) => match[0].replace(/[.,;]+$/, ''));
}

async function fetchAoNDefenses(name: string, level?: number): Promise<ParsedMonsterDefenses | null> {
  const key = `${name.toLowerCase()}|${level ?? ''}`;
  if (aonCache.has(key)) return aonCache.get(key) ?? null;
  try {
    const response = await fetch('https://elasticsearch.aonprd.com/aon-test/_search', {
      method: 'POST',
      headers: { accept: '*/*', 'content-type': 'application/json' },
      body: JSON.stringify({
        query: {
          bool: {
            must: [{ match_phrase: { name } }],
            filter: [{ term: { category: 'creature' } }],
            must_not: [{ term: { exclude_from_search: true } }],
          },
        },
        size: 8,
        _source: ['name', 'hp', 'ac', 'fortitude_save', 'reflex_save', 'will_save', 'perception', 'level', 'category'],
      }),
    });
    if (!response.ok) {
      aonCache.set(key, null);
      return null;
    }
    const data = await response.json() as {
      hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
    };
    const hits = (data.hits?.hits ?? []).map((hit) => hit._source ?? {});
    const exact = hits.filter((hit) => String(hit.name ?? '').toLowerCase() === name.toLowerCase());
    const pool = exact.length ? exact : hits;
    const match = (level != null ? pool.find((hit) => hit.level === level) : undefined) ?? pool[0];
    if (!match) {
      aonCache.set(key, null);
      return null;
    }
    const parsed: ParsedMonsterDefenses = {
      hp: typeof match.hp === 'number' ? match.hp : undefined,
      ac: typeof match.ac === 'number' ? match.ac : undefined,
      fort: typeof match.fortitude_save === 'number' ? match.fortitude_save : undefined,
      reflex: typeof match.reflex_save === 'number' ? match.reflex_save : undefined,
      will: typeof match.will_save === 'number' ? match.will_save : undefined,
      perception: typeof match.perception === 'number' ? match.perception : undefined,
    };
    const result = hasParsedDefenses(parsed) ? parsed : null;
    aonCache.set(key, result);
    return result;
  } catch {
    aonCache.set(key, null);
    return null;
  }
}

async function fetchPageDefenses(url: string): Promise<ParsedMonsterDefenses | null> {
  if (!import.meta.env.VITE_FIRECRAWL_KEY) return null;
  if (pageCache.has(url)) {
    const cached = pageCache.get(url);
    return cached ? parseMonsterDefenses(cached) : null;
  }
  try {
    const markdown = await CleaningUtils.fetchPageText(url);
    pageCache.set(url, markdown);
    const parsed = parseMonsterDefenses(markdown);
    return hasParsedDefenses(parsed) ? parsed : null;
  } catch {
    pageCache.set(url, null);
    return null;
  }
}

export async function fillMissingDefenses(creature: Creature): Promise<Creature> {
  if (hasDefenseOperations(creature) || hasUsefulCalculatedStats(creature.meta_data?.calculated_stats)) return creature;
  let next = applyParsedDefenses(creature);
  if (hasDefenseOperations(next) || hasUsefulCalculatedStats(next.meta_data?.calculated_stats)) return next;

  const aon = await fetchAoNDefenses(catalogCreatureName(creature.name), creature.level);
  if (aon) return applyDefenses(next, aon);

  for (const url of sourceUrls(creature)) {
    if (!/aonprd\.com|demiplane\.com/i.test(url)) continue;
    const parsed = await fetchPageDefenses(url);
    if (parsed) return applyDefenses(next, parsed);
  }
  return next;
}
