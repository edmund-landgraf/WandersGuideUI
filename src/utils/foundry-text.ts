import { getAllConditionNames } from '@conditions/condition-handler';
import { convertActionSymbolMarkup } from '@utils/actions';
import { toLabel } from '@utils/strings';

/**
 * Foundry leftover markup → standard Pathfinder 2e prose.
 *
 * [[Sickened]]                    → [sickened](link_condition_sickened)
 * [[Sickened]]{Sickened 1}        → [sickened 1](link_condition_sickened)
 * [Sickened]                      → sickened (then auto-linked)
 * @Check[fortitude|dc:14]         → DC 14 Fortitude
 * @Check[fortitude|dc:14|basic]   → DC 14 basic Fortitude
 * [[/br 1d4 #hours]]{1d4 hours}   → 1d4 hours
 * @UUID[Compendium....]{Sickened 1} → sickened 1
 */
export const FOUNDRY_2E_STYLE_KEY = {
  condition: 'lowercase (sickened 1) — books never Title Case conditions',
  check: 'DC {n} {basic?} {Fortitude|Reflex|Will|Skill}',
  roll: 'bare dice + unit (1d4 hours)',
} as const;

const AON_ORIGIN = 'https://2e.aonprd.com';

export function toStandard2eProse(text: string): string {
  if (!text) return text;
  let out = convertActionSymbolMarkup(text);
  out = unescapeWikiBrackets(out);
  out = convertHtmlAnchors(out);
  out = convertUuidEnrichers(out);
  out = convertCheckEnrichers(out);
  out = convertInlineRolls(out);
  out = convertWikiLinks(out);
  out = convertBareConditionBrackets(out);
  out = collapseDoubleParens(out);
  out = resolveAonLinksInMarkdown(out);
  out = toWgMarkdownLinks(out);
  out = formatPaizoEntryProse(out);
  return out;
}

const PAIZO_ACTION_GLYPHS: Record<string, string> = {
  'free action': '`action_symbol_5`',
  reaction: '`action_symbol_4`',
  'one action': '`action_symbol_1`',
  '1 action': '`action_symbol_1`',
  'two actions': '`action_symbol_2`',
  '2 actions': '`action_symbol_2`',
  'three actions': '`action_symbol_3`',
  '3 actions': '`action_symbol_3`',
};

const PAIZO_CLAUSE_LABELS = ['Frequency', 'Trigger', 'Requirements', 'Effect', 'Duration', 'Range', 'Area', 'Targets', 'Cost', 'Defense'];

/** Plain "Activate—Name (two actions, concentrate)." prose → Paizo stat-block labels. */
export function formatPaizoEntryProse(text: string): string {
  if (!text || /\*\*Activate\*\*/.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((block) => block.split('\n').map(formatPaizoLine).join('\n'))
    .join('\n\n');
}

function formatPaizoLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('**')) return line;

  const activate = trimmed.match(/^Activate\s*[—–-]\s*(.+)$/i);
  if (activate) return formatActivate(activate[1]);

  const labeled = trimmed.match(/^(Passive|Special|Critical Success|Success|Failure|Critical Failure)\s*:\s*([\s\S]+)$/i);
  if (labeled) return `**${titleLabel(labeled[1])}** ${labeled[2].trim()}`;
  return line;
}

function formatActivate(body: string): string {
  const linked = body.match(/^\[([^\]]+)\]\(([^)]+)\)\s*(?:\(([^)]+)\))?(?:[.;]\s*([\s\S]*))?$/);
  if (linked) {
    return finishActivate(`[${linked[1]}](${linked[2]})`, linked[3] ?? '', linked[4] ?? '');
  }
  const named = body.match(/^([^(.;]+?)(?:\s*\(([^)]+)\))?(?:[.;]\s*([\s\S]*))?$/);
  const name = (named?.[1] ?? body).trim().replace(/[.;]$/, '');
  return finishActivate(name, named?.[2] ?? '', named?.[3] ?? '');
}

function finishActivate(name: string, paren: string, restText: string): string {
  const { symbols, traits } = splitActionTraits(paren);
  const rest = formatClauses(restText);
  const head = ['**Activate**', symbols, name, traits ? `(${traits})` : ''].filter(Boolean).join(' ');
  return rest ? `${head}; ${rest}` : head;
}

function splitActionTraits(paren: string): { symbols: string; traits: string } {
  const symbols: string[] = [];
  const traits: string[] = [];
  for (const part of paren.split(',').map((item) => item.trim()).filter(Boolean)) {
    const glyph = PAIZO_ACTION_GLYPHS[part.toLowerCase()];
    if (glyph) symbols.push(glyph);
    else traits.push(part.toLowerCase());
  }
  return { symbols: symbols.join(' '), traits: traits.join(', ') };
}

function formatClauses(rest: string): string {
  const pattern = new RegExp(`(?:^|\\.\\s+)(${PAIZO_CLAUSE_LABELS.join('|')})\\s*:?\\s+`, 'gi');
  return rest
    .trim()
    .replace(pattern, (_match, label: string, offset: number) => {
      const prefix = offset === 0 ? '' : '; ';
      return `${prefix}**${titleLabel(label)}** `;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function titleLabel(label: string): string {
  return label
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Markdown `[name](link_type_id)` → `[name](<link_type_id>)` so underscores in WG hrefs survive CommonMark. */
export function toWgMarkdownLinks(text: string): string {
  if (!text) return text;
  // `[[label](link_type_id)]` is an unresolved WG wiki wrapper around a real content link.
  let out = text.replace(/\[\[([^\]]+)\]\((?:<)?(link_[^)\s>]+)(?:>)?\)\]/g, '[$1](<$2>)');
  out = out.replace(/\[([^\]]+)\]\((?:<)?(link_[^)\s>]+)(?:>)?\)/g, '[$1](<$2>)');
  return out;
}

/** Turn AoN-relative hrefs (`Conditions.aspx?ID=36`, `/Spells.aspx?ID=1`) into absolute URLs. */
export function resolveAonHref(href?: string | null): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('link_') || trimmed.startsWith('#') || trimmed.startsWith('mailto:')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//') && /aonprd\.com/i.test(trimmed)) return `https:${trimmed}`;
  if (/^\/?[A-Za-z][\w-]*\.aspx(?:[?#].*)?$/i.test(trimmed)) {
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${AON_ORIGIN}${path}`;
  }
  return trimmed;
}

export function isAonConditionHref(href?: string | null): boolean {
  return /conditions\.aspx/i.test(href ?? '');
}

export function autoLinkConditions(text: string, blacklist: string[] = []): string {
  if (!text) return text;
  const conditions = conditionNames()
    .filter((name) => !blacklist.includes(name) && name !== 'persistent damage')
    .sort((a, b) => b.length - a.length);
  if (conditions.length === 0) return text;

  const names = conditions.map(escapeRegex).join('|');
  let out = unescapeWikiBrackets(text);
  // `[[Concealed]]` is skipped by the bare-word pass (`(?<!\[)`), so resolve wiki wrappers first.
  out = out.replace(new RegExp(`\\[\\[\\s*(${names})(?:\\s+(\\d+))?\\s*\\]\\]`, 'gi'), (_full, name: string, value?: string) =>
    conditionMarkdownLink(name, value)
  );
  out = out.replace(new RegExp(`(?<!\\[)\\b(${names})\\b(?!\\])`, 'gi'), (match) => conditionMarkdownLink(match));
  out = out.replace(/persistent (\w*?\s|)damage/gi, (match) => `[${match}](link_condition_persistent~damage)`);
  return out;
}

/** Traits with a Wanderer's Guide entry. Rarity words such as Uncommon are not traits. */
const KNOWN_TRAIT_LINKS: Record<string, number> = {
  concentrate: 1432,
  manipulate: 1433,
  cantrip: 1858,
  general: 1437,
  occult: 1514,
};

const PROSE_TRAIT_NAMES = ['concentrate', 'manipulate'];

export function knownTraitHref(label: string): string | null {
  const id = KNOWN_TRAIT_LINKS[label.trim().toLowerCase()];
  return id ? `link_trait_${id}` : null;
}

export function autoLinkKnownTraits(text: string): string {
  if (!text) return text;
  const names = PROSE_TRAIT_NAMES.map(escapeRegex).join('|');
  return text.replace(new RegExp(`(?<!\\[)\\b(${names})\\b(?!\\])`, 'gi'), (match) => {
    const href = knownTraitHref(match);
    return href ? `[${match}](${href})` : match;
  });
}

function convertHtmlAnchors(text: string): string {
  return text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_full, href: string, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, '').trim();
    if (!label) return inner;
    return `[${label}](${href.trim()})`;
  });
}

function resolveAonLinksInMarkdown(text: string): string {
  return text.replace(/\]\(([^)]+)\)/g, (_full, href: string) => `](${resolveAonHref(href) ?? href})`);
}

function convertUuidEnrichers(text: string): string {
  return text.replace(/@(?:UUID|Compendium)\[([^\]]+)\](?:\{([^}]+)\})?/g, (_full, path: string, display?: string) => {
    const raw = (display ?? path.split('.').pop() ?? path).trim();
    return styleConditionOrPlain(raw);
  });
}

function convertCheckEnrichers(text: string): string {
  return text.replace(/@Check\[([^\]]+)\]/g, (_full, body: string) => formatCheck(body));
}

function convertInlineRolls(text: string): string {
  return text.replace(/\[\[\/(?:b?r)\s*([^\]]+)\]\](?:\{([^}]+)\})?/gi, (_full, inner: string, display?: string) => {
    if (display?.trim()) return display.trim();
    const dice = inner.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/i)?.[1];
    const flavor = inner.match(/#([a-z0-9 ]+)/i)?.[1]?.trim();
    if (dice && flavor) return `${dice} ${flavor}`;
    return dice ?? inner.trim();
  });
}

function unescapeWikiBrackets(text: string): string {
  return text
    .replace(/\\\[\\\[([^\]]+)\\\]\\\]/g, '[[$1]]')
    .replace(/&(?:#0*91|#x0*5b|lsqb|lbrack);/gi, '[')
    .replace(/&(?:#0*93|#x0*5d|rsqb|rbrack);/gi, ']');
}

function convertWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]/][^\]]*)\]\](?:\{([^}]+)\})?/g, (full, inner: string, display?: string) => {
    if (inner.includes('](')) return full;
    return styleConditionOrPlain((display ?? inner).trim());
  });
}

function convertBareConditionBrackets(text: string): string {
  return text.replace(/(?<!\[)\[([^\]\[\n]+)\](?!\()/g, (full, inner: string) => {
    const styled = asStandardCondition(inner);
    return styled ?? full;
  });
}

function collapseDoubleParens(text: string): string {
  return text.replace(/\(\(([^()\n]+)\)\)/g, '($1)');
}

function formatCheck(body: string): string {
  const parts = body.split('|').map((part) => part.trim()).filter(Boolean);
  let type = '';
  let dc = '';
  let basic = false;

  for (const part of parts) {
    const [key, ...rest] = part.split(':');
    const value = rest.join(':').trim();
    const keyLower = key.toLowerCase();
    if (keyLower === 'type' && value) type = value;
    else if (keyLower === 'dc' && value) dc = value;
    else if (keyLower === 'basic') basic = value !== 'false';
    else if (!value && keyLower === 'basic') basic = true;
    else if (!value && !type) type = key;
  }

  const label = toLabel(type.replace(/_/g, ' '));
  const basicBit = basic ? 'basic ' : '';
  if (dc && label) return `DC ${dc} ${basicBit}${label}`.replace(/\s+/g, ' ').trim();
  if (label) return `${basicBit}${label}`.trim();
  return body;
}

function conditionMarkdownLink(name: string, value?: string): string {
  const lower = name.toLowerCase();
  const label = value ? `${lower} ${value}` : lower;
  return `[${label}](link_condition_${lower.replace(/ /g, '~')})`;
}

function styleConditionOrPlain(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^([A-Za-z][A-Za-z\- ]*?)(?:\s+(\d+))?$/);
  if (!match) return trimmed;
  const name = match[1].trim();
  if (!conditionNameSet().has(name.toLowerCase())) return trimmed;
  return conditionMarkdownLink(name, match[2]);
}

function asStandardCondition(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([A-Za-z][A-Za-z\- ]*?)(?:\s+(\d+))?$/);
  if (!match) return null;
  const name = match[1].trim().toLowerCase();
  if (!conditionNameSet().has(name)) return null;
  return match[2] ? `${name} ${match[2]}` : name;
}

function conditionNames(): string[] {
  return getAllConditionNames();
}

function conditionNameSet(): Set<string> {
  return new Set(conditionNames());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turn HTML / broken pipe tables into GFM so remark-gfm can render them. */
export function normalizeMarkdownTables(text: string): string {
  if (!text) return text;
  let out = text.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/p>\s*<p\b[^>]*>/gi, '\n');
  out = out.replace(/<\/?p\b[^>]*>/gi, '\n');
  out = out.replace(/<table\b[\s\S]*?<\/table>/gi, (html) => htmlTableToGfm(html));
  return isolatePipeTables(out);
}

function htmlTableToGfm(html: string): string {
  const rows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((match) => {
    const cells = [...match[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) =>
      cell[1]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&mdash;|&#8212;/gi, '—')
        .replace(/&ndash;|&#8211;/gi, '–')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim()
    );
    return cells;
  }).filter((row) => row.length > 0);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
  const header = padded[0];
  const divider = header.map(() => '---');
  const body = padded.slice(1);
  const lines = [`| ${header.join(' | ')} |`, `| ${divider.join(' | ')} |`, ...body.map((row) => `| ${row.join(' | ')} |`)];
  return `\n\n${lines.join('\n')}\n\n`;
}

function isPipeRow(line: string): boolean {
  return /^\|.+\|\s*$/.test(line.trim());
}

function isDelimiterRow(line: string): boolean {
  return /^\|[\s\-:|]+\|\s*$/.test(line.trim());
}

function flushPipeTable(rows: string[]): string[] {
  if (rows.length === 0) return [];
  const cells = rows[0].split('|').filter((part) => part.trim() !== '');
  if (rows.length === 1 || !isDelimiterRow(rows[1])) {
    rows = [rows[0], `| ${cells.map(() => '---').join(' | ')} |`, ...rows.slice(1)];
  }
  return ['', ...rows, ''];
}

function isolatePipeTables(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let rows: string[] = [];

  const flush = () => {
    if (rows.length === 0) return;
    const block = flushPipeTable(rows);
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    if (out[out.length - 1] === '') out.push(...block.slice(1));
    else out.push(...block);
    rows = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (isPipeRow(trimmed)) {
      rows.push(trimmed);
      continue;
    }
    if (rows.length > 0 && trimmed === '') continue;
    flush();
    out.push(raw);
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
