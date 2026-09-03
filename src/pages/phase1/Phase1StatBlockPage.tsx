import { fetchContentById } from '@content/content-store';
import { getJsonV4Content } from '@export/json/json-v4';
import type { Character, Creature, LivingEntity } from '@schemas/content';
import { setPageTitle } from '@utils/document-change';
import { isCharacter } from '@utils/type-fixing';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Phase1CssThemeToggle } from './Phase1CssThemeToggle';
import { Phase1ThemeToggle } from './Phase1ThemeToggle';
import { phase1Request } from './phase1-api';
import { Phase1StatBlockView } from './phase1-stat-block';
import { Phase1StatBlockCards } from './phase1-stat-block-cards';
import { Phase1StatBlockCardsV1 } from './phase1-stat-block-cards-v1';
import {
  isWideStatBlockLayout,
  persistStatBlockLayout,
  readStoredStatBlockLayout,
  STAT_BLOCK_LAYOUT_OPTIONS,
  type StatBlockLayout,
} from './phase1-stat-block-layout';

function firstRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function Phase1StatBlockPage() {
  const { type, id } = useParams();
  const kind = type === 'creature' ? 'creature' : 'character';
  const [layout, setLayout] = useState<StatBlockLayout>(() => readStoredStatBlockLayout());

  const query = useQuery({
    queryKey: ['phase1-stat-block', kind, id],
    enabled: Boolean(id),
    retry: false,
    queryFn: async (): Promise<LivingEntity | null> => {
      if (!id) return null;
      if (kind === 'character') {
        try {
          return firstRecord(await phase1Request<Character | Character[]>('find-character', { id }));
        } catch {
          return null;
        }
      }
      const numericId = Number(id);
      if (!Number.isFinite(numericId)) return null;
      return (await fetchContentById<Creature>('creature', numericId)) ?? null;
    },
  });

  const entity = query.data ?? null;

  const contentQuery = useQuery({
    queryKey: ['phase1-stat-block-content', entity?.id, entity ? (isCharacter(entity) ? 'character' : 'creature') : null],
    enabled: Boolean(entity),
    queryFn: () => getJsonV4Content(entity!),
  });

  useEffect(() => {
    setPageTitle(entity ? `${entity.name} - Stat Block` : 'Stat Block');
  }, [entity]);

  return (
    <div className='stat-block-page min-h-screen bg-p1-page text-p1-text'>
      <div className='stat-block-chrome sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-p1-border bg-p1-header px-4 py-2'>
        <div className='phase1-theme-switch stat-block-layout-switch' role='radiogroup' aria-label='Stat block layout'>
          {STAT_BLOCK_LAYOUT_OPTIONS.map(({ id: optionId, label }) => (
            <button
              key={optionId}
              type='button'
              role='radio'
              aria-checked={layout === optionId}
              className={layout === optionId ? 'is-active' : undefined}
              onClick={() => {
                setLayout(optionId);
                persistStatBlockLayout(optionId);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <Phase1CssThemeToggle />
        <Phase1ThemeToggle />
      </div>
      <main className={isWideStatBlockLayout(layout) ? 'mx-auto max-w-[86rem] overflow-x-auto px-4 py-6' : 'mx-auto max-w-3xl px-4 py-6'}>
        {query.isLoading || (entity && contentQuery.isLoading) ? <p className='text-sm italic text-p1-muted'>Loading…</p> : null}
        {!query.isLoading && !entity ? (
          <p className='text-center text-sm italic text-p1-muted'>
            Failed to find {kind} with ID #{id}
          </p>
        ) : null}
        {entity && contentQuery.data ? (
          layout === 'experimental' ? (
            <Phase1StatBlockCards entity={entity} data={contentQuery.data} />
          ) : layout === 'board-v1' ? (
            <Phase1StatBlockCardsV1 entity={entity} data={contentQuery.data} />
          ) : (
            <Phase1StatBlockView entity={entity} data={contentQuery.data} />
          )
        ) : null}
      </main>
    </div>
  );
}
