// Content package for the jsonV4 / pdfV2 compile bundle. Shared by
// wgui-export-character and wgui-export-character-slim.
import type { ContentSource } from '../_shared/content';
import { fetchData } from '../_shared/helpers.ts';

export const COMMON_CORE_ID = 3;

const packageCache = new Map<string, Record<string, unknown>>();

function sourceKey(ids: number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join(',');
}

export async function loadContentPackage(client: Parameters<typeof fetchData>[0], enabled: number[]) {
  const ids = [...new Set([COMMON_CORE_ID, ...enabled])];
  const key = sourceKey(ids);
  const cached = packageCache.get(key);
  if (cached) return cached;

  const bySource = { column: 'content_source_id', value: ids };
  const [
    ancestries,
    backgrounds,
    classes,
    abilityBlocks,
    items,
    languages,
    spells,
    traits,
    creatures,
    archetypes,
    versatileHeritages,
    classArchetypes,
    sources,
  ] = await Promise.all([
    fetchData(client, 'ancestry', [bySource]),
    fetchData(client, 'background', [bySource]),
    fetchData(client, 'class', [bySource]),
    fetchData(client, 'ability_block', [bySource]),
    fetchData(client, 'item', [bySource]),
    fetchData(client, 'language', [bySource]),
    fetchData(client, 'spell', [bySource]),
    fetchData(client, 'trait', [bySource]),
    fetchData(client, 'creature', [bySource]),
    fetchData(client, 'archetype', [bySource]),
    fetchData(client, 'versatile_heritage', [bySource]),
    fetchData(client, 'class_archetype', [bySource]),
    fetchData<ContentSource>(client, 'content_source', [{ column: 'id', value: ids }]),
  ]);

  const pkg = {
    ancestries,
    backgrounds,
    classes,
    abilityBlocks,
    items,
    languages,
    spells,
    traits,
    creatures,
    archetypes,
    versatileHeritages,
    classArchetypes,
    sources,
    lookupTraits: traits,
    defaultSources: { PAGE: ids, INFO: ids },
  };
  packageCache.set(key, pkg);
  return pkg;
}