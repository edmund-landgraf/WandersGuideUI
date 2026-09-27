import { getJsonV4Content } from '@export/json/json-v4';
import { isItemRangedWeapon, isItemWeapon } from '@items/inv-utils';
import { getWeaponStats, parseOtherDamage } from '@items/weapon-handler';
import type { Character, Item } from '@schemas/content';
import { getEntityLevel } from '@utils/entity-utils';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { compactLabels } from '@variables/variable-utils';
import { parseIconValue } from '@common/IconDisplay';

export const PC_STAT_BLOCKS_PER_PAGE = 6;
const CHARACTER_STORE = 'CHARACTER';

export type PcStatBlockCardModel = {
  id: string;
  name: string;
  portraitUrl: string | null;
  hasSheet: boolean;
  level?: number;
  ancestry?: string;
  heritage?: string;
  background?: string;
  className?: string;
  classDc?: string;
  heroPoints?: number;
  size?: string;
  playerName?: string;
  traits: string[];
  perception?: string;
  languages?: string;
  skills?: string;
  abilities?: string;
  ac?: string;
  fortitude?: string;
  reflex?: string;
  will?: string;
  hp?: string;
  speed?: string;
  melee: string[];
  ranged: string[];
  spells?: string;
};

type StatBlockContent = Awaited<ReturnType<typeof getJsonV4Content>>;
type WeaponStats = ReturnType<typeof getWeaponStats>;

function blankField(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return !trimmed || trimmed === '—' || trimmed === '-';
}

function profTotal(data: StatBlockContent, name: string): string | undefined {
  const total = data.proficiencies[name]?.total;
  if (total == null || total === '') return undefined;
  return String(total);
}

function formatHp(character: Character, maxHp: number): string {
  const current = character.hp_current ?? maxHp;
  const base = current !== maxHp ? `${current}/${maxHp}` : String(maxHp);
  const temp = character.hp_temp;
  if (temp && temp > 0) return `${base} (${temp} temp)`;
  return base;
}

function formatStrike(item: Item, stats: WeaponStats, equipped: boolean): string {
  const attack = sign(stats.attack_bonus.total[0]);
  const damageBonus = stats.damage.bonus.total > 0 ? `+${stats.damage.bonus.total}` : stats.damage.bonus.total < 0 ? String(stats.damage.bonus.total) : '';
  const other = parseOtherDamage(stats.damage.other).join('');
  const extra = stats.damage.extra ? ` + ${stats.damage.extra}` : '';
  const damage = `${stats.damage.dice}${stats.damage.die}${damageBonus} ${stats.damage.damageType}${other}${extra}`.trim();
  const flag = equipped ? 'equipped' : 'unequipped';
  return `${item.name} ${attack}, Damage ${damage} (${flag})`;
}

function formatSpells(data: StatBlockContent): string | undefined {
  const source = data.spell_sources[0];
  const parts: string[] = [];
  if (source) {
    parts.push(`DC ${source.stats.spell_dc.total}`);
    parts.push(`attack ${sign(source.stats.spell_attack.total[0])}`);
  } else if (data.innate_spells.length > 0) {
    const dc = data.proficiencies['INNATE_SPELL_DC']?.total;
    const attack = data.proficiencies['INNATE_SPELL_ATTACK']?.total;
    if (dc != null && dc !== '') parts.push(`DC ${String(dc).replace(/^DC\s*/i, '')}`);
    if (attack != null && attack !== '') parts.push(`attack ${attack}`);
  }
  const header = parts.join(', ');
  const cantripNames = data.spells.cantrips.slice(0, 8).map((spell) => spell.name).filter(Boolean);
  const spellNames = [
    ...data.spells.normal.map((spell) => spell.name),
    ...data.focus_spells.map((spell) => spell.name),
    ...data.innate_spells.map((entry) => entry.spell.name),
  ]
    .filter(Boolean)
    .slice(0, 8);
  const names: string[] = [];
  if (cantripNames.length) names.push(`Cantrips ${cantripNames.join(', ')}`);
  if (spellNames.length) names.push(spellNames.join(', '));
  if (!header && names.length === 0) return undefined;
  if (!names.length) return header;
  return header ? `${header}; ${names.join('; ')}` : names.join('; ');
}

export function characterToStatBlockCard(character: Character, data: StatBlockContent | null): PcStatBlockCardModel {
  const icon = parseIconValue(character.details?.image_url ?? '');
  const portraitUrl = icon.type === 'image' && icon.value ? icon.value : null;
  if (!data) {
    return {
      id: String(character.id),
      name: character.name,
      portraitUrl,
      hasSheet: false,
      traits: [],
      melee: [],
      ranged: [],
    };
  }

  const skills = Object.keys(data.proficiencies)
    .filter((name) => name.startsWith('SKILL_') && name !== 'SKILL_LORE____')
    .map((name) => {
      const total = data.proficiencies[name]?.total;
      if (total == null || total === '') return '';
      return `${toLabel(name)} ${total}`;
    })
    .filter(Boolean)
    .join(', ');

  const abilities = Object.keys(data.attributes)
    .map((name) => {
      const attr = data.attributes[name];
      const value = attr?.value;
      if (typeof value !== 'number') return '';
      return `${compactLabels(toLabel(name))} ${sign(value)}`;
    })
    .filter(Boolean)
    .join(', ');

  const speeds = data.speeds.filter((entry) => entry.value.total !== 0 && entry.value.value !== 0);
  const speed = speeds
    .map((entry) => (entry.name === 'SPEED' ? `${entry.value.total} ft` : `${entry.name.replace('SPEED_', '').toLowerCase()} ${entry.value.total} ft`))
    .join(', ');

  const seen = new Set<number>();
  const melee: string[] = [];
  const ranged: string[] = [];
  const inventoryWeapons = (character.inventory?.items ?? []).filter((inv) => isItemWeapon(inv.item));
  for (const inv of inventoryWeapons) {
    if (seen.has(inv.item.id)) continue;
    seen.add(inv.item.id);
    const stats = data.weapons?.find((weapon) => weapon.item.id === inv.item.id)?.stats ?? getWeaponStats(CHARACTER_STORE, inv.item);
    const line = formatStrike(inv.item, stats, Boolean(inv.is_equipped));
    if (isItemRangedWeapon(inv.item)) ranged.push(line);
    else melee.push(line);
  }
  for (const weapon of data.weapons ?? []) {
    if (!isItemWeapon(weapon.item) || seen.has(weapon.item.id)) continue;
    seen.add(weapon.item.id);
    const line = formatStrike(weapon.item, weapon.stats, true);
    if (isItemRangedWeapon(weapon.item)) ranged.push(line);
    else melee.push(line);
  }

  return {
    id: String(character.id),
    name: character.name,
    portraitUrl,
    hasSheet: true,
    level: getEntityLevel(character),
    ancestry: character.details?.ancestry?.name?.trim() || undefined,
    background: character.details?.background?.name?.trim() || undefined,
    className: character.details?.class?.name?.trim() || undefined,
    classDc: profTotal(data, 'CLASS_DC'),
    heroPoints: character.hero_points,
    size: data.size?.trim() || undefined,
    traits: data.character_traits.map((trait) => trait.name).filter(Boolean),
    perception: profTotal(data, 'PERCEPTION'),
    languages: data.languages.map((lang) => toLabel(lang)).filter(Boolean).join(', ') || undefined,
    skills: skills || undefined,
    abilities: abilities || undefined,
    ac: String(data.ac),
    fortitude: profTotal(data, 'SAVE_FORT'),
    reflex: profTotal(data, 'SAVE_REFLEX'),
    will: profTotal(data, 'SAVE_WILL'),
    hp: formatHp(character, data.max_hp),
    speed: speed || undefined,
    melee,
    ranged,
    spells: formatSpells(data),
  };
}
