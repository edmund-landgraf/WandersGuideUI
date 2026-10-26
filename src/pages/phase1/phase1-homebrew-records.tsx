import { ActionSymbol } from '@common/Actions';
import {
  deleteContent,
  upsertAbilityBlock,
  upsertAncestry,
  upsertArchetype,
  upsertBackground,
  upsertClass,
  upsertClassArchetype,
  upsertCreature,
  upsertItem,
  upsertLanguage,
  upsertSpell,
  upsertTrait,
  upsertVersatileHeritage,
} from '@content/content-creation';
import { fetchContentAll, resetContentStore } from '@content/content-store';
import type { AbilityBlock, AbilityBlockType, ContentPackage, ContentType, Item } from '@schemas/content';
import { toLabel } from '@utils/strings';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cloneDeep } from 'lodash-es';
import { useMemo, useState } from 'react';
import { useContentLinks } from './phase1-content-links';
import { createBlankPhase1Item, Phase1EditItemModal } from './phase1-edit-item-modal';
import { Phase1HomebrewRecordModal } from './phase1-homebrew-record-modal';
import { Phase1PickerModal } from './phase1-picker-modal';

export type BundleEntry = {
  key: string;
  id: number;
  name: string;
  kind: string;
  href: string;
  contentType: ContentType;
  abilityBlockType?: AbilityBlockType;
  level: number | null;
  rarity?: string;
  traits: number[];
  actions?: AbilityBlock['actions'];
  record: Record<string, unknown> & { id: number; name: string };
};

export const BUNDLE_SECTIONS: { id: string; label: string; kind: string; contentType: ContentType; abilityBlockType?: AbilityBlockType }[] = [
  { id: 'action', label: 'Actions', kind: 'Action', contentType: 'ability-block', abilityBlockType: 'action' },
  { id: 'feat', label: 'Feats', kind: 'Feat', contentType: 'ability-block', abilityBlockType: 'feat' },
  { id: 'item', label: 'Items', kind: 'Item', contentType: 'item' },
  { id: 'spell', label: 'Spells', kind: 'Spell', contentType: 'spell' },
  { id: 'trait', label: 'Traits', kind: 'Trait', contentType: 'trait' },
  { id: 'language', label: 'Languages', kind: 'Language', contentType: 'language' },
  { id: 'creature', label: 'Creatures', kind: 'Creature', contentType: 'creature' },
  { id: 'ancestry', label: 'Ancestries', kind: 'Ancestry', contentType: 'ancestry' },
  { id: 'heritage', label: 'Heritages', kind: 'Heritage', contentType: 'ability-block', abilityBlockType: 'heritage' },
  { id: 'sense', label: 'Senses', kind: 'Sense', contentType: 'ability-block', abilityBlockType: 'sense' },
  { id: 'physical-feature', label: 'Physical Features', kind: 'Physical Feature', contentType: 'ability-block', abilityBlockType: 'physical-feature' },
  { id: 'background', label: 'Backgrounds', kind: 'Background', contentType: 'background' },
  { id: 'class', label: 'Classes', kind: 'Class', contentType: 'class' },
  { id: 'class-feature', label: 'Class Features', kind: 'Class Feature', contentType: 'ability-block', abilityBlockType: 'class-feature' },
  { id: 'archetype', label: 'Archetypes', kind: 'Archetype', contentType: 'archetype' },
  { id: 'versatile-heritage', label: 'Versatile Heritages', kind: 'Versatile Heritage', contentType: 'versatile-heritage' },
  { id: 'class-archetype', label: 'Class Archetypes', kind: 'Class Archetype', contentType: 'class-archetype' },
  { id: 'mode', label: 'Modes', kind: 'Mode', contentType: 'ability-block', abilityBlockType: 'mode' },
];

export function bundleEntries(content: ContentPackage): BundleEntry[] {
  const rows: BundleEntry[] = [];
  const add = (sectionId: string, records: ReadonlyArray<{ id: number; name: string }>) => {
    const section = BUNDLE_SECTIONS.find((item) => item.id === sectionId);
    if (!section) return;
    for (const raw of records) {
      const record = raw as BundleEntry['record'];
      const level = numberField(record.level) ?? numberField(record.rank);
      rows.push({
        key: `${section.contentType}-${section.abilityBlockType ?? ''}-${record.id}`,
        id: record.id,
        name: record.name,
        kind: section.kind,
        href: `link_${section.abilityBlockType ?? section.contentType}_${record.id}`,
        contentType: section.contentType,
        abilityBlockType: section.abilityBlockType,
        level,
        rarity: typeof record.rarity === 'string' ? record.rarity : undefined,
        traits: Array.isArray(record.traits) ? record.traits.filter((id): id is number => typeof id === 'number') : [],
        actions: record.actions as AbilityBlock['actions'],
        record,
      });
    }
  };
  const blocks = (type: AbilityBlock['type']) => content.abilityBlocks.filter((block) => block.type === type);
  add('action', blocks('action'));
  add('feat', blocks('feat'));
  add('class-feature', blocks('class-feature'));
  add('heritage', blocks('heritage'));
  add('physical-feature', blocks('physical-feature'));
  add('sense', blocks('sense'));
  add('mode', blocks('mode'));
  add('ancestry', content.ancestries);
  add('background', content.backgrounds);
  add('class', content.classes);
  add('class-archetype', content.classArchetypes);
  add('archetype', content.archetypes);
  add('versatile-heritage', content.versatileHeritages);
  add('creature', content.creatures);
  add('item', content.items);
  add('language', content.languages);
  add('spell', content.spells);
  add('trait', content.traits);
  return rows.sort(byLevel);
}

export function BundleEditorColumn({
  sourceId,
  entries,
}: {
  sourceId: number;
  entries: BundleEntry[];
}) {
  const { open } = useContentLinks();
  const queryClient = useQueryClient();
  const [sectionId, setSectionId] = useState('item');
  const [query, setQuery] = useState('');
  const [editorId, setEditorId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const section = BUNDLE_SECTIONS.find((item) => item.id === sectionId) ?? BUNDLE_SECTIONS[2];
  const catalog = useQuery({
    queryKey: ['phase1-homebrew-import', section.contentType, section.abilityBlockType],
    enabled: importing,
    queryFn: async () => {
      const rows = await fetchContentAll<Record<string, unknown> & { id: number; name: string; type?: string }>(section.contentType);
      return section.abilityBlockType ? rows.filter((row) => row.type === section.abilityBlockType) : rows;
    },
  });
  const visible = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === section.kind && entry.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort(byLevel),
    [entries, section.kind, query]
  );

  async function refresh() {
    resetContentStore(false, true);
    setEditorId(null);
    await queryClient.invalidateQueries({ queryKey: ['phase1-homebrew-package', sourceId] });
    setBusy(false);
  }

  async function duplicate(record: Record<string, unknown> & { name?: string }) {
    setBusy(true);
    const source = cloneDeep(record);
    source.id = -1;
    source.name = `(Copy) ${String(source.name ?? 'Record')}`;
    source.content_source_id = sourceId;
    await saveRecord(section.contentType, source);
    await refresh();
  }

  return (
    <div className='grid min-h-0 grid-cols-[180px_minmax(0,1fr)] border-b border-p1-border lg:border-b-0 lg:border-r'>
      <div className='overflow-y-auto border-r border-p1-border py-2'>
        {BUNDLE_SECTIONS.map((item) => {
          const count = entries.filter((entry) => entry.kind === item.kind).length;
          return (
            <button
              key={item.id}
              type='button'
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-p1-hover ${sectionId === item.id ? 'bg-p1-hover text-p1-text' : 'text-p1-muted'}`}
              onClick={() => {
                setSectionId(item.id);
                setQuery('');
              }}
            >
              <span className='truncate'>{item.label}</span>
              {count > 0 && <span className='text-[10px] text-p1-accent'>{count}</span>}
            </button>
          );
        })}
      </div>
      <div className='flex min-h-0 flex-col'>
        <div className='flex flex-wrap items-center gap-2 border-b border-p1-border p-3'>
          <input
            className='settings-input h-9 min-w-0 flex-1 py-0'
            placeholder={`Search ${section.label.toLowerCase()}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type='button' className='toolbar-button toolbar-button-accent' disabled={busy} onClick={() => setEditorId(-1)}>
            Create {toLabel(section.abilityBlockType ?? section.contentType)}
          </button>
          <button type='button' className='toolbar-button' disabled={busy} onClick={() => setImporting(true)}>
            Import
          </button>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {visible.length === 0 && <p className='px-4 py-8 text-center text-sm italic text-p1-muted'>No records found!</p>}
          {visible.map((entry) => (
            <div key={entry.key} className='flex items-center gap-2 border-b border-p1-border px-3 py-2'>
              <button type='button' className='min-w-0 flex-1 text-left hover:text-p1-accent' disabled={busy} onClick={() => setEditorId(entry.id)}>
                <span className='block truncate text-sm'>{entry.name}</span>
                <span className='text-[10px] uppercase text-p1-faint'>
                  {entry.level != null ? `Lvl ${entry.level}` : 'No level'}
                  {entry.rarity ? ` · ${entry.rarity}` : ''}
                </span>
              </button>
              {entry.actions != null && <ActionSymbol cost={entry.actions} size='1.1rem' />}
              <button type='button' className='toolbar-button' onClick={() => open(entry.href)}>
                View
              </button>
              <button type='button' className='toolbar-button' disabled={busy} onClick={() => void duplicate(entry.record)}>
                Copy
              </button>
              <button
                type='button'
                className='toolbar-button'
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Delete “${entry.name}”?`)) return;
                  setBusy(true);
                  void deleteContent(entry.contentType, entry.id).then(() => refresh());
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
      {importing && (
        <Phase1PickerModal
          title={`Import ${toLabel(section.abilityBlockType ?? section.contentType)}`}
          titleId='homebrew-import-title'
          searchPlaceholder='Search catalog'
          items={catalog.data ?? []}
          getName={(row) => row.name}
          getKey={(row) => String(row.id)}
          loading={catalog.isLoading}
          empty='No matching records.'
          onClose={() => setImporting(false)}
          overlayClass='z-[120]'
          renderItem={(row) => (
            <button
              type='button'
              className='flex w-full border-b border-p1-border px-3 py-2 text-left text-sm hover:bg-p1-hover'
              onClick={() => {
                setImporting(false);
                void duplicate(row);
              }}
            >
              {row.name}
            </button>
          )}
        />
      )}
      {editorId != null && section.contentType === 'item' && (
        <Phase1EditItemModal
          title={editorId < 0 ? 'Create Item' : 'Edit Item'}
          item={
            editorId < 0
              ? { ...createBlankPhase1Item(), content_source_id: sourceId }
              : ((entries.find((entry) => entry.id === editorId && entry.contentType === 'item')?.record as Item | undefined) ?? createBlankPhase1Item())
          }
          onClose={() => setEditorId(null)}
          onSave={(next) => {
            setBusy(true);
            next.content_source_id = sourceId;
            void saveRecord('item', next).then(() => refresh());
          }}
        />
      )}
      {editorId != null && section.contentType !== 'item' && (
        <Phase1HomebrewRecordModal
          section={section}
          sourceId={sourceId}
          record={editorId < 0 ? null : (entries.find((entry) => entry.id === editorId && entry.kind === section.kind)?.record ?? null)}
          onClose={() => setEditorId(null)}
          onSave={(next) => {
            setBusy(true);
            void saveRecord(section.contentType, next).then(() => refresh());
          }}
        />
      )}
    </div>
  );
}

async function saveRecord(type: ContentType, record: object) {
  if (type === 'ability-block') return upsertAbilityBlock(record as never);
  if (type === 'spell') return upsertSpell(record as never);
  if (type === 'item') return upsertItem(record as never);
  if (type === 'trait') return upsertTrait(record as never);
  if (type === 'language') return upsertLanguage(record as never);
  if (type === 'creature') return upsertCreature(record as never);
  if (type === 'ancestry') return upsertAncestry(record as never);
  if (type === 'background') return upsertBackground(record as never);
  if (type === 'class') return upsertClass(record as never);
  if (type === 'archetype') return upsertArchetype(record as never);
  if (type === 'versatile-heritage') return upsertVersatileHeritage(record as never);
  if (type === 'class-archetype') return upsertClassArchetype(record as never);
  return null;
}

function byLevel(a: BundleEntry, b: BundleEntry) {
  if (a.level != null && b.level != null && a.level !== b.level) return a.level - b.level;
  return a.name.localeCompare(b.name);
}

function numberField(value: unknown) {
  return typeof value === 'number' ? value : null;
}
