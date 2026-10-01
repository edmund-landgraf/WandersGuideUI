import { fetchContentSources, getDefaultSources, getDefaultSourcesKey } from './content-store';
import { makeRequest } from '@requests/request-manager';
import { Hazard, HazardSchema, SourceValue } from '@schemas/content';
import { z } from 'zod';

async function resolveHazardSources(sources?: SourceValue): Promise<number[]> {
  if (Array.isArray(sources)) return [...new Set(sources)].sort((a, b) => a - b);

  const scopes = sources ? [sources] : [getDefaultSources('INFO'), getDefaultSources('PAGE')];
  const sourceLists = await Promise.all(scopes.map((scope) => fetchContentSources(scope)));
  return [...new Set(sourceLists.flat().map((source) => source.id))].sort((a, b) => a - b);
}

export function getHazardQueryKey(id?: number, sourceId?: number) {
  return sourceId === undefined
    ? ['find-hazard', id, getDefaultSourcesKey('INFO'), getDefaultSourcesKey('PAGE')]
    : ['find-hazard', id, sourceId];
}

/** Read hazard rows through the creature endpoint without entering the creature cache. */
export async function fetchHazards(sources?: SourceValue): Promise<Hazard[]> {
  const sourceIds = await resolveHazardSources(sources);
  if (sourceIds.length === 0) return [];
  const result = await makeRequest<unknown>('find-creature', { type: 'hazard', content_sources: sourceIds }, false);
  if (result == null) throw new Error('Could not load hazards.');
  return z.array(HazardSchema).parse(result);
}
