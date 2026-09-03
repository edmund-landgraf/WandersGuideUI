import { FTC, importFromFTC } from '@import/ftc/import-from-ftc';
import { getFileContents } from '@import/json/import-from-json';
import { hideNotification, showNotification } from '@mantine/notifications';
import { Character } from '@schemas/content';
import { lengthenLabels } from '@variables/variable-utils';

export type PathbuilderImportSource = number | { id?: number; file?: File; json?: unknown };

export type PathbuilderImportOptions = {
  /** Mantine toasts. Phase 1 should pass false and use its own status. */
  notify?: boolean;
};

const SKILL_KEYS: Record<string, string> = {
  acrobatics: 'Acrobatics',
  arcana: 'Arcana',
  athletics: 'Athletics',
  crafting: 'Crafting',
  deception: 'Deception',
  diplomacy: 'Diplomacy',
  intimidation: 'Intimidation',
  medicine: 'Medicine',
  nature: 'Nature',
  occultism: 'Occultism',
  performance: 'Performance',
  religion: 'Religion',
  society: 'Society',
  stealth: 'Stealth',
  survival: 'Survival',
  thievery: 'Thievery',
};

/** Pathbuilder CUP / pre-remaster names → Wanderer's Guide content names. */
const NAME_ALIASES: Record<string, string> = {
  'magic missile': 'Force Barrage',
  'ray of frost': 'Frostbite',
};

function aliasName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return NAME_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export async function importFromPathbuilder(
  source: PathbuilderImportSource,
  options: PathbuilderImportOptions = {}
): Promise<Character | null> {
  const notify = options.notify !== false;
  const label =
    typeof source === 'number'
      ? `importing-${source}`
      : source.id != null
        ? `importing-${source.id}`
        : source.file
          ? `importing-${source.file.name}`
          : 'importing-pathbuilder';

  if (notify) {
    showNotification({
      id: label,
      title: 'Importing character',
      message: 'This may take a minute...',
      autoClose: false,
      withCloseButton: false,
      loading: true,
    });
  }

  try {
    const payload = await resolvePathbuilderPayload(source);
    const build = extractBuild(payload);
    const ftc = convertPathbuilderToFTC(build);
    const character = await importFromFTC(ftc);

    if (!character) {
      throw new Error('Could not create a character from this Pathbuilder data.');
    }

    if (notify) {
      hideNotification(label);
      showNotification({
        title: 'Success',
        message: `Imported "${character.name}"`,
        icon: null,
        autoClose: 3000,
      });
    }
    return character;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error importing from Pathbuilder';
    if (notify) {
      hideNotification(label);
      showNotification({
        title: 'Import failed',
        message,
        color: 'red',
        icon: null,
        autoClose: false,
      });
      return null;
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

async function resolvePathbuilderPayload(source: PathbuilderImportSource): Promise<unknown> {
  if (typeof source === 'number') {
    return fetchPathbuilderJson(source);
  }
  if (source.json !== undefined) {
    return source.json;
  }
  if (source.file) {
    const contents = await getFileContents(source.file);
    try {
      return JSON.parse(contents);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
  }
  if (source.id != null) {
    return fetchPathbuilderJson(source.id);
  }
  throw new Error('Enter a Pathbuilder JSON ID or upload an Export JSON file.');
}

async function fetchPathbuilderJson(id: number): Promise<unknown> {
  if (!Number.isFinite(id) || id < 1) {
    throw new Error('Enter a valid Pathbuilder JSON ID.');
  }

  let res: Response;
  try {
    res = await fetch(`https://pathbuilder2e.com/json.php?id=${id}`);
  } catch {
    throw new Error(
      'Could not reach Pathbuilder. If the browser blocked the request (CORS), export JSON from Pathbuilder and import the file instead.'
    );
  }

  if (!res.ok) {
    throw new Error(`Pathbuilder returned HTTP ${res.status}.`);
  }

  try {
    return await res.json();
  } catch {
    throw new Error('Pathbuilder returned invalid JSON.');
  }
}

function extractBuild(payload: unknown): Record<string, any> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid Pathbuilder JSON.');
  }
  const obj = payload as Record<string, any>;
  if (obj.success === false) {
    throw new Error('Pathbuilder did not find that JSON ID.');
  }
  if (obj.build && typeof obj.build === 'object') {
    return obj.build;
  }
  if (typeof obj.name === 'string' && (obj.class || obj.ancestry)) {
    return obj;
  }
  throw new Error('File is not a Pathbuilder character export. Use Export JSON from Pathbuilder 2e.');
}

export function convertPathbuilderToFTC(build: Record<string, any>): FTC {
  const level = typeof build.level === 'number' && build.level > 0 ? build.level : 1;
  const breakdown = build.abilities?.breakdown ?? {};

  function convertAttributes(attributes: string[] | undefined, boostLevel: number) {
    return (
      attributes?.map((attr) => ({
        name: lengthenLabels(attr.charAt(0).toUpperCase() + attr.slice(1).toLowerCase()),
        level: boostLevel,
      })) ?? []
    );
  }

  const ftc = {
    version: '1.0' as const,
    data: {
      class: build.class || 'RANDOM',
      background: build.background || 'RANDOM',
      ancestry: build.ancestry || 'RANDOM',
      name: build.name || 'Unknown Wanderer',
      level,
      experience: 0,
      content_sources: 'ALL' as const,
      selections: [
        ...convertAttributes(breakdown.ancestryFree, 1),
        ...convertAttributes(breakdown.ancestryBoosts, 1),
        ...convertAttributes(breakdown.backgroundBoosts, 1),
        ...convertAttributes(breakdown.classBoosts, 1),
        ...convertAttributes(breakdown.mapLevelledBoosts?.['1'], 1),
        ...convertAttributes(breakdown.mapLevelledBoosts?.['5'], 5),
        ...convertAttributes(breakdown.mapLevelledBoosts?.['10'], 10),
        ...convertAttributes(breakdown.mapLevelledBoosts?.['15'], 15),
        ...convertAttributes(breakdown.mapLevelledBoosts?.['20'], 20),
        ...convertFeats(build.feats, level),
        ...convertLores(build.lores),
        ...convertSkills(build.proficiencies),
        ...convertSpecials(build.specials),
        ...(build.heritage
          ? [
              {
                name: aliasName(String(build.heritage)),
                level: 1,
              },
            ]
          : []),
      ],
      items: convertItems(build),
      coins: {
        cp: build.money?.cp ?? 0,
        sp: build.money?.sp ?? 0,
        gp: build.money?.gp ?? 0,
        pp: build.money?.pp ?? 0,
      },
      spells: [...convertSpells(build.spellCasters), ...convertFocusSpells(build)],
      conditions: [],
      hp: undefined,
      temp_hp: undefined,
      hero_points: undefined,
      stamina: undefined,
      resolve: undefined,
      info: {
        notes: undefined,
        appearance: undefined,
        personality: undefined,
        alignment: build.alignment,
        beliefs: build.deity,
        age: build.age != null ? String(build.age) : undefined,
        height: undefined,
        weight: undefined,
        gender: build.gender,
        pronouns: undefined,
        faction: undefined,
        reputation: undefined,
        ethnicity: undefined,
        nationality: undefined,
        birthplace: undefined,
        organized_play_id: undefined,
      },
    },
  } satisfies FTC;

  return ftc;
}

function convertFeats(feats: unknown, characterLevel: number): { name: string; level: number }[] {
  if (!Array.isArray(feats)) return [];
  return feats
    .map((record) => {
      if (!Array.isArray(record) || typeof record[0] !== 'string' || !record[0].trim()) return null;
      return {
        name: aliasName(record[0]),
        level: inferFeatLevel(record, characterLevel),
      };
    })
    .filter((row): row is { name: string; level: number } => row != null);
}

function inferFeatLevel(record: unknown[], characterLevel: number): number {
  const listed = record[3];
  if (typeof listed === 'number' && listed > 0) return listed;
  const category = typeof record[2] === 'string' ? record[2] : '';
  if (/heritage/i.test(category) || /ancestry/i.test(category)) return 1;
  if (/skill feat/i.test(category)) return 2;
  if (/class feat/i.test(category)) return 2;
  if (/general feat/i.test(category)) return 3;
  return characterLevel > 1 ? 1 : characterLevel;
}

function convertLores(lores: unknown): { name: string; level: number }[] {
  if (!Array.isArray(lores)) return [];
  return lores
    .map((record) => {
      if (!Array.isArray(record) || typeof record[0] !== 'string' || !record[0].trim()) return null;
      const loreName = record[0].toLowerCase().endsWith(' lore') ? record[0] : `${record[0]} Lore`;
      return { name: aliasName(loreName), level: 1 };
    })
    .filter((row): row is { name: string; level: number } => row != null);
}

function convertSkills(proficiencies: Record<string, number> | undefined): { name: string; level: number }[] {
  if (!proficiencies) return [];
  const rows: { name: string; level: number }[] = [];
  for (const [key, value] of Object.entries(proficiencies)) {
    const name = SKILL_KEYS[key];
    if (!name) continue;
    if (typeof value === 'number' && value >= 2) {
      rows.push({ name, level: 1 });
    }
  }
  return rows;
}

function convertSpecials(specials: unknown): { name: string; level: number }[] {
  if (!Array.isArray(specials)) return [];
  return specials
    .map((entry) => {
      const name = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? String((entry as any).name ?? '') : '';
      if (!name.trim()) return null;
      return { name: aliasName(name), level: 1 };
    })
    .filter((row): row is { name: string; level: number } => row != null);
}

function convertItems(build: Record<string, any>): { name: string; level?: number }[] {
  const items: { name: string; level?: number }[] = [];

  if (Array.isArray(build.equipment)) {
    for (const row of build.equipment) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0].trim()) continue;
      items.push({ name: aliasName(row[0]), level: undefined });
    }
  }

  for (const list of [build.weapons, build.armor]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const name = typeof entry?.name === 'string' ? entry.name : '';
      if (!name.trim()) continue;
      items.push({ name: aliasName(name), level: undefined });
    }
  }

  return items;
}

function convertSpells(spellCasters: unknown): { name: string; rank: number; source: string }[] {
  if (!Array.isArray(spellCasters)) return [];
  const extracted: { name: string; rank: number; source: string }[] = [];

  for (const caster of spellCasters) {
    const source = typeof caster?.name === 'string' ? caster.name : 'Spell';
    for (const groupKey of ['spells', 'prepared'] as const) {
      const groups = caster?.[groupKey];
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const rank = typeof group?.spellLevel === 'number' ? group.spellLevel : 0;
        const list = group?.list;
        if (!Array.isArray(list)) continue;
        for (const spellName of list) {
          if (typeof spellName !== 'string' || !spellName.trim()) continue;
          extracted.push({ name: aliasName(spellName), rank, source });
        }
      }
    }
    const focusLists = [caster?.focusSpells, caster?.focus, caster?.focusCantrips];
    for (const list of focusLists) {
      pushNamedSpells(extracted, list, source, 0);
    }
  }

  return extracted;
}

function convertFocusSpells(build: Record<string, any>): { name: string; rank: number; source: string }[] {
  const extracted: { name: string; rank: number; source: string }[] = [];
  const focus = build.focus;
  if (!focus) {
    pushNamedSpells(extracted, build.focusSpells, 'Focus', 0);
    return extracted;
  }

  if (Array.isArray(focus)) {
    pushNamedSpells(extracted, focus, 'Focus', 0);
    return extracted;
  }

  if (typeof focus === 'object') {
    for (const [tradition, block] of Object.entries(focus as Record<string, any>)) {
      const source = tradition || 'Focus';
      if (Array.isArray(block)) {
        pushNamedSpells(extracted, block, source, 0);
        continue;
      }
      if (!block || typeof block !== 'object') continue;
      pushNamedSpells(extracted, block.focusSpells, source, 1);
      pushNamedSpells(extracted, block.focusCantrips, source, 0);
      pushNamedSpells(extracted, block.list, source, 0);
    }
  }

  return extracted;
}

function pushNamedSpells(
  into: { name: string; rank: number; source: string }[],
  list: unknown,
  source: string,
  defaultRank: number
) {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) {
      into.push({ name: aliasName(entry), rank: defaultRank, source });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const name = typeof (entry as any).name === 'string' ? (entry as any).name : typeof (entry as any).spellName === 'string' ? (entry as any).spellName : '';
      if (!name.trim()) continue;
      const rank = typeof (entry as any).spellLevel === 'number' ? (entry as any).spellLevel : defaultRank;
      into.push({ name: aliasName(name), rank, source });
    }
  }
}
