// Content package for the jsonV4 / pdfV2 compile bundle. Shared by
// wgui-export-character and wgui-export-character-slim.
import type { ContentSource } from '../_shared/content';
import { fetchData } from '../_shared/helpers.ts';
import { collectSlimCatalogPages } from './slim-catalog.ts';

export const COMMON_CORE_ID = 3;

// Packages are request-scoped: retaining them by book list grows worker memory
// and can reuse rows fetched under another caller's visibility.
export async function loadContentPackage(client: Parameters<typeof fetchData>[0], enabled: number[], mode: 'full' | 'slim' = 'full') {
  const ids = [...new Set([COMMON_CORE_ID, ...enabled])];

  async function read<T = Record<string, any>>(table: Parameters<typeof fetchData>[1], column = 'content_source_id'): Promise<T[]> {
    if (mode === 'full') return fetchData<T>(client, table, [{ column, value: ids }]);
    // Use the same RLS-scoped client and enabled-source filter as fetchData.
    // Small keyset pages bound transient response size; keep all rule rows.
    const rows = await collectSlimCatalogPages(async (afterId, limit) => {
      let query = client.from(table).select().in(column, ids);
      if (afterId !== null) query = query.gt('id', afterId);
      const { data, error } = await query.order('id', { ascending: true }).limit(limit);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error(`Invalid query result for ${table}`);
      return data as { id: number; search_tsv?: unknown }[];
    });
    return rows as unknown as T[];
  }
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
    await read('ancestry'),
    await read('background'),
    await read('class'),
    await read('ability_block'),
    await read('item'),
    await read('language'),
    await read('spell'),
    await read('trait'),
    await read('creature'),
    await read('archetype'),
    await read('versatile_heritage'),
    await read('class_archetype'),
    await read<ContentSource>('content_source', 'id'),
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