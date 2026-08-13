import { getAllConditionNames } from '@conditions/condition-handler';
import { toLabel } from '@utils/strings';

/**
 * Foundry leftover markup → standard Pathfinder 2e prose.
 *
 * [[Sickened]]                    → sickened
 * [[Sickened]]{Sickened 1}        → sickened 1
 * [Sickened]                      → sickened
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
  let out = text;
  out = convertHtmlAnchors(out);
  out = convertUuidEnrichers(out);
  out = convertCheckEnrichers(out);
  out = convertInlineRolls(out);
  out = convertWikiLinks(out);
  out = convertBareConditionBrackets(out);
  out = collapseDoubleParens(out);
  out = resolveAonLinksInMarkdown(out);
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

  const conditionRegex = new RegExp(`(?<!\\[)\\b(${conditions.map(escapeRegex).join('|')})\\b(?!\\])`, 'gi');
  let out = text.replace(conditionRegex, (match) => `[${match.toLowerCase()}](link_condition_${match.toLowerCase().replace(/ /g, '~')})`);
  out = out.replace(/persistent (\w*?\s|)damage/gi, (match) => `[${match}](link_condition_persistent~damage)`);
  return out;
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

function convertWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]/][^\]]*)\]\](?:\{([^}]+)\})?/g, (full, inner: string, display?: string) => {
    if (inner.includes('](')) return full;
    return styleConditionOrPlain((display ?? inner).trim());
  });
}

function convertBareConditionBrackets(text: string): string {
  return text.replace(/\[([^\]\n]+)\](?!\()/g, (full, inner: string) => {
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

function styleConditionOrPlain(text: string): string {
  return asStandardCondition(text) ?? text;
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
