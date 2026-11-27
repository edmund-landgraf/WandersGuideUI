// Content package for the jsonV4 / pdfV2 compile bundle. Shared by
// wgui-export-character and wgui-export-character-slim.
import type { ContentSource } from '../_shared/content';
import { fetchData } from '../_shared/helpers.ts';

export const COMMON_CORE_ID = 3;

// Packages are request-scoped: retaining them by book list grows worker memory
// and can reuse rows fetched under another caller's visibility.
export async function loadContentPackage(client: Parameters<typeof fetchData>[0], enabled: number[]) {
  const ids = [...new Set([COMMON_CORE_ID, ...enabled])];

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
  ] = [
    await fetchData(client, 'ancestry', [bySource]),
    await fetchData(client, 'background', [bySource]),
    await fetchData(client, 'class', [bySource]),
    await fetchData(client, 'ability_block', [bySource]),
    await fetchData(client, 'item', [bySource]),
    await fetchData(client, 'language', [bySource]),
    await fetchData(client, 'spell', [bySource]),
    await fetchData(client, 'trait', [bySource]),
    await fetchData(client, 'creature', [bySource]),
    await fetchData(client, 'archetype', [bySource]),
    await fetchData(client, 'versatile_heritage', [bySource]),
    await fetchData(client, 'class_archetype', [bySource]),
    await fetchData<ContentSource>(client, 'content_source', [{ column: 'id', value: ids }]),
  ];

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
  return pkg;
}