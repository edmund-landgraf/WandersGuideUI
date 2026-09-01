import { applyConditions } from '@conditions/condition-handler';
import { COMMON_CORE_ID } from '@constants/data';
import {
  defineDefaultSources,
  fetchContentPackage,
  fetchContentSources,
  isContentPackageEmpty,
} from '@content/content-store';
import { applyEquipmentPenalties } from '@items/inv-utils';
import { addExtraItems, checkBulkLimit } from '@items/inv-handlers';
import { executeOperations } from '@operations/operations.main';
import { confirmHealth } from '@pages/character_sheet/entity-handler';
import type { Character, ContentPackage, OperationCharacterResultPackage } from '@schemas/content';
import { saveCalculatedStats } from '@variables/calculated-stats';
import { setVariable } from '@variables/variable-manager';
import { getFinalHealthValue, getHealthValueParts } from '@variables/variable-helpers';
import { convertToSetEntity, type SetterOrUpdater } from '@utils/type-fixing';
import { hashData } from '@utils/numbers';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { uniq } from 'lodash-es';
import { useEffect, useRef, useState } from 'react';
import { phase1Request } from './phase1-api';

function firstRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function sourceIds(character: Character | null) {
  return uniq([COMMON_CORE_ID, ...(character?.content_sources?.enabled ?? [])]);
}

function useDebouncedCharacter(character: Character | null) {
  const [debounced, setDebounced] = useState(character);
  const first = useRef(true);
  useEffect(() => {
    if (!character) return;
    if (first.current) {
      first.current = false;
      setDebounced(character);
      return;
    }
    const timer = window.setTimeout(() => setDebounced(character), 800);
    return () => window.clearTimeout(timer);
  }, [character]);
  return debounced;
}

function opsHash(character: Character | null | undefined) {
  if (!character) return 0;
  return hashData({
    id: character.id,
    campaign_id: character.campaign_id,
    user_id: character.user_id,
    level: character.level,
    inventory: character.inventory,
    spells: character.spells,
    operation_data: character.operation_data,
    details: {
      conditions: character.details?.conditions,
      ancestry: character.details?.ancestry,
      background: character.details?.background,
      class: character.details?.class,
      class_2: character.details?.class_2,
    },
    custom_operations: character.custom_operations,
    options: character.options,
    variants: character.variants,
    content_sources: character.content_sources,
    companions: character.companions,
    meta_data: {
      active_modes: character.meta_data?.active_modes,
      given_item_ids: character.meta_data?.given_item_ids,
      reset_hp: character.meta_data?.reset_hp,
    },
  });
}

function saveBody(characterId: number, row: Character) {
  return {
    id: characterId,
    name: row.name,
    level: row.level,
    experience: row.experience,
    hp_current: row.hp_current,
    hp_temp: row.hp_temp,
    hero_points: row.hero_points,
    stamina_current: row.stamina_current,
    resolve_current: row.resolve_current,
    inventory: row.inventory,
    notes: row.notes,
    details: row.details,
    roll_history: row.roll_history,
    custom_operations: row.custom_operations,
    meta_data: row.meta_data,
    options: row.options,
    variants: row.variants,
    content_sources: row.content_sources,
    operation_data: row.operation_data,
    spells: row.spells,
    companions: row.companions,
    campaign_id: row.campaign_id,
  };
}

export function usePhase1BuilderCharacter(characterId: number, seed?: Character | null) {
  const queryClient = useQueryClient();
  const [character, setCharacter] = useState<Character | null>(seed ?? null);
  const [results, setResults] = useState<OperationCharacterResultPackage | null>(null);
  const executing = useRef<number | null>(null);
  const saving = useRef(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const loaded = useRef(Boolean(seed));
  const skipSave = useRef(true);
  const characterRef = useRef(character);
  characterRef.current = character;
  const debounced = useDebouncedCharacter(character);
  const sources = sourceIds(character);

  useEffect(() => {
    if (seed?.id === characterId) {
      defineDefaultSources('PAGE', seed.content_sources?.enabled ?? []);
      loaded.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      const row = firstRecord(await phase1Request<Character | Character[]>('find-character', { id: characterId }));
      if (cancelled || !row) return;
      defineDefaultSources('PAGE', row.content_sources?.enabled ?? []);
      setCharacter(row);
      loaded.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // Seed is only used on mount so sheet re-renders do not wipe in-progress builder edits.
  }, [characterId]);

  const contentQuery = useQuery({
    queryKey: ['phase1-builder-content', sources],
    enabled: Boolean(character),
    queryFn: async () => {
      await fetchContentSources(sources);
      defineDefaultSources('BOTH', sources);
      const content = await fetchContentPackage(sources, { fetchSources: true, fetchCreatures: false });
      content.defaultSources = { PAGE: sources, INFO: sources };
      return content;
    },
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
  });

  const content = contentQuery.data ?? null;

  useEffect(() => {
    if (!debounced || !content || isContentPackageEmpty(content)) return;
    const hash = opsHash(debounced);
    if (executing.current === hash) return;
    executing.current = hash;
    void executeOperations<OperationCharacterResultPackage>({
      type: 'CHARACTER',
      data: { character: debounced, content, context: 'CHARACTER-BUILDER' },
    }).then((packageResults) => {
      if (executing.current !== hash) return;
      if (debounced.variants?.proficiency_without_level) {
        setVariable('CHARACTER', 'PROF_WITHOUT_LEVEL', true);
      }
      addExtraItems('CHARACTER', content.items, debounced, convertToSetEntity(setCharacter));
      checkBulkLimit('CHARACTER', debounced, convertToSetEntity(setCharacter), debounced.options?.ignore_bulk_limit !== true);
      applyEquipmentPenalties('CHARACTER', debounced);
      applyConditions('CHARACTER', debounced.details?.conditions ?? []);
      if (debounced.meta_data?.reset_hp !== false) {
        const { classHp } = getHealthValueParts('CHARACTER');
        const maxHealth = getFinalHealthValue('CHARACTER');
        confirmHealth(`${maxHealth}`, maxHealth, debounced, convertToSetEntity(setCharacter), classHp === 0);
      } else {
        confirmHealth(`${debounced.hp_current}`, getFinalHealthValue('CHARACTER'), debounced, convertToSetEntity(setCharacter));
      }
      saveCalculatedStats('CHARACTER', debounced, convertToSetEntity(setCharacter));
      // #region agent log
      {
        const heritageSection = packageResults.ancestrySectionResults?.find((s) => s.baseSource?.name === 'Heritage');
        const heritageResult = heritageSection?.baseResults?.[0];
        const sel = debounced.operation_data?.selections ?? {};
        fetch('http://127.0.0.1:7421/ingest/5bcbb1e6-5cc6-4f07-9ef3-8c7101fed88e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2c7b0'},body:JSON.stringify({sessionId:'b2c7b0',runId:'pre-fix',hypothesisId:'E',location:'phase1-builder-character.ts:execute',message:'ops package heritage',data:{sectionId:heritageSection?.baseSource?.id,sectionPrefix:`ancestry-section-${heritageSection?.baseSource?.id}`,heritageKeys:Object.entries(sel).filter(([k])=>k.includes('ancestry-section')||k.includes('3fd6a268')),selectedName:heritageResult?.result?.source?.name??null,optionCount:heritageResult?.selection?.options?.length??0,hasNodeValue:Boolean(heritageResult?.result?.source),allSelCount:Object.keys(sel).length},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      setResults(packageResults);
      executing.current = null;
    });
  }, [content, debounced]);

  useEffect(() => {
    if (!loaded.current || !debounced || !content || isContentPackageEmpty(content)) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    enqueueSave(saveBody(characterId, debounced));
  }, [characterId, content, debounced]);

  function enqueueSave(body: Record<string, unknown>) {
    // #region agent log
    {
      const od = body.operation_data as { selections?: Record<string, string> } | undefined;
      const sel = od?.selections ?? {};
      fetch('http://127.0.0.1:7421/ingest/5bcbb1e6-5cc6-4f07-9ef3-8c7101fed88e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2c7b0'},body:JSON.stringify({sessionId:'b2c7b0',runId:'pre-fix',hypothesisId:'D',location:'phase1-builder-character.ts:enqueueSave',message:'save payload selections',data:{heritageKeys:Object.entries(sel).filter(([k])=>k.includes('ancestry-section')||k.includes('3fd6a268')),selCount:Object.keys(sel).length,queued:saving.current},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    if (saving.current) {
      pending.current = body;
      return;
    }
    saving.current = true;
    void (async function flush(payload: Record<string, unknown>) {
      try {
        await phase1Request('update-character', payload);
        void queryClient.invalidateQueries({ queryKey: ['phase1-sheet', characterId] });
        void queryClient.invalidateQueries({ queryKey: ['phase1-characters'] });
      } catch (error) {
        console.error('Character save failed:', error);
      } finally {
        const next = pending.current;
        pending.current = null;
        if (next) {
          await flush(next);
        } else {
          saving.current = false;
        }
      }
    })(body);
  }

  function flushSave(row?: Character | null) {
    const next = row ?? characterRef.current;
    if (!loaded.current || !next) return;
    enqueueSave(saveBody(characterId, next));
  }

  useEffect(() => {
    return () => {
      const row = characterRef.current;
      if (!loaded.current || !row) return;
      void phase1Request('update-character', saveBody(characterId, row)).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['phase1-sheet', characterId] });
        void queryClient.invalidateQueries({ queryKey: ['phase1-characters'] });
      });
    };
  }, [characterId, queryClient]);

  return {
    character,
    setCharacter: setCharacter as SetterOrUpdater<Character | null>,
    flushSave,
    content,
    contentPending: contentQuery.isPending,
    contentError: contentQuery.isError,
    retryContent: () => contentQuery.refetch(),
    results,
    isLoading: !character || !results,
  };
}
