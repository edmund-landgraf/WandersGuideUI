import { useQuery } from '@tanstack/react-query';
import { fetchContentAll, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import { isSpellVisible } from '@content/content-hidden';
import type { Spell } from '@schemas/content';
import { BookOpen, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActionSymbol } from '@common/Actions';
import { Phase1PickerModal } from './phase1-picker-modal';
import { heightenRanksFor, isWitchFamiliarSource, spellbookEntriesForSource, spellFitsSlot, type Phase1SpellbookEntry, type Phase1SpellManageMode } from './phase1-spells';
import { ProseMarkdown } from './phase1-markdown';

const EMPTY_SPELLS: Spell[] = [];
const TRADITIONS = ['arcane', 'divine', 'occult', 'primal'] as const;
const RANK_FILTERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type SpellbookAssign = { slotId: string; rank: number };

export function Phase1SpellbookModal({
  sourceName,
  sourceType,
  manageMode = 'LIST-ONLY',
  tradition,
  list,
  assign,
  busy,
  onAdd,
  onRemove,
  onPick,
  onApplyFont,
  onClose,
  initialAdding = false,
}: {
  sourceName: string;
  sourceType?: string;
  manageMode?: Phase1SpellManageMode;
  tradition?: string;
  list: Array<{ spell_id: number; rank: number; source: string }>;
  assign?: SpellbookAssign | null;
  busy?: boolean;
  onAdd: (spell: Spell, rank: number) => Promise<void>;
  onRemove: (spellId: number, rank: number) => Promise<void>;
  onPick?: (entry: Phase1SpellbookEntry) => Promise<void>;
  onApplyFont?: (choice: 'heal' | 'harm') => Promise<void>;
  onClose: () => void;
  initialAdding?: boolean;
}) {
  const slotsOnly = manageMode === 'SLOTS-ONLY';
  const familiar = isWitchFamiliarSource({ name: sourceName, type: sourceType });
  const [adding, setAdding] = useState(initialAdding || slotsOnly);
  const [preview, setPreview] = useState<Phase1SpellbookEntry | null>(null);
  const lockTradition = manageMode === 'SLOTS-ONLY' || (manageMode === 'LIST-ONLY' && sourceName !== 'RITUALS');
  const [traditionFilter, setTraditionFilter] = useState<string | null>(lockTradition ? (tradition?.toLowerCase() || null) : null);
  const [rankFilter, setRankFilter] = useState<number[]>([]);
  const catalog = useQuery({
    queryKey: ['phase1-spell-catalog', getDefaultSourcesKey('PAGE')],
    queryFn: async () => {
      const spells = await fetchContentAll<Spell>('spell', getDefaultSources('PAGE'));
      return (spells ?? [])
        .filter((spell) => isSpellVisible('CHARACTER', spell))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const items = useMemo(() => {
    let entries = spellbookEntriesForSource(list, sourceName, catalog.data ?? EMPTY_SPELLS, []);
    if (traditionFilter) {
      entries = entries.filter((entry) => entry.spell.traditions.some((item) => item.toLowerCase() === traditionFilter));
    }
    if (rankFilter.length) {
      entries = entries.filter((entry) => rankFilter.includes(entry.rank));
    }
    if (!assign) return entries;
    return [...entries].sort((a, b) => {
      const aFit = spellFitsSlot(a.spell, assign.rank, a.rank) ? 0 : 1;
      const bFit = spellFitsSlot(b.spell, assign.rank, b.rank) ? 0 : 1;
      return aFit - bFit || a.rank - b.rank || a.spell.name.localeCompare(b.spell.name);
    });
  }, [assign, catalog.data, list, rankFilter, sourceName, traditionFilter]);

  return (
    <>
      {!adding && <Phase1PickerModal
        title={assign ? `Prepare ${sourceName} · Rank ${assign.rank === 0 ? 'Cantrip' : assign.rank}` : sourceName === 'RITUALS' ? 'Rituals' : familiar ? `${sourceName} Familiar` : `${sourceName} Spellbook`}
        titleId='phase1-spellbook-title'
        searchPlaceholder={familiar ? 'Search your familiar' : 'Search your spellbook'}
        items={items}
        getName={(entry) => entry.spell.name}
        getKey={(entry) => entry.key}
        matchesSearch={(entry, needle) =>
          [entry.spell.name, entry.spell.description, ...entry.spell.traditions].join(' ').toLowerCase().includes(needle)
        }
        loading={catalog.isLoading}
        error={catalog.isError ? (catalog.error instanceof Error ? catalog.error.message : 'Could not load spells.') : null}
        empty={familiar ? 'No spells in the familiar yet. Add patron, lesson, or other spells from the catalog.' : 'No spells in this book yet. Add any spell from the catalog.'}
        onClose={() => {
          if (!adding) onClose();
        }}
        maxWidthClass='max-w-3xl'
        toolbar={
          <div className='mt-2 space-y-2'>
            <TraditionFilter value={traditionFilter} onChange={setTraditionFilter} />
            <RankFilter value={rankFilter} onChange={setRankFilter} />
            {onApplyFont && (
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-[11px] text-p1-muted'>Divine Font</span>
                <div className='flex border border-p1-border' role='radiogroup' aria-label='Divine Font'>
                  <button type='button' className='h-7 px-2.5 text-[10px] font-semibold hover:bg-p1-hover' disabled={busy} onClick={() => void onApplyFont('heal')}>Heal</button>
                  <button type='button' className='h-7 border-l border-p1-border px-2.5 text-[10px] font-semibold hover:bg-p1-hover' disabled={busy} onClick={() => void onApplyFont('harm')}>Harm</button>
                </div>
                <span className='text-[10px] text-p1-faint'>Fills empty ranked slots with Heal or Harm.</span>
              </div>
            )}
            <div className='flex items-center justify-between gap-2'>
              <p className='text-[11px] text-p1-muted'>
                {sourceName === 'RITUALS'
                  ? 'Click a ritual for details. Use Add spell to write another into this list.'
                  : manageMode === 'LIST-ONLY'
                    ? 'This is your repertoire. Use Add spell to learn another. Click a spell for details.'
                    : familiar
                      ? 'This list is the familiar. Patron and lesson spells can be any tradition. Click to prepare an empty slot.'
                      : 'Click a spell to prepare it in an empty slot of that rank. Right-click to remove from the book.'}
              </p>
              <button
                type='button'
                className='inline-flex h-8 shrink-0 items-center gap-1 border border-p1-accent/40 px-2.5 text-[11px] font-semibold text-p1-accent-soft hover:bg-p1-accent/10'
                onClick={() => setAdding(true)}
              >
                <Plus size={12} />
                Add spell
              </button>
            </div>
          </div>
        }
        renderItem={(entry) => {
          const fits = assign ? spellFitsSlot(entry.spell, assign.rank, entry.rank) : true;
          return (
            <div
              className={`flex w-full items-center gap-2 border-b border-p1-border px-4 py-2.5 ${fits ? '' : 'opacity-60'}`}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!busy) void onRemove(entry.spell.id, entry.rank);
              }}
            >
              <button
                type='button'
                className='flex min-w-0 flex-1 items-center gap-2 text-left hover:text-p1-text'
                disabled={busy}
                onClick={() => {
                  if (onPick) void onPick(entry);
                  else setPreview(entry);
                }}
              >
                <ActionSymbol cost={entry.spell.cast} />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>{entry.spell.name}</span>
                  <span className='mt-0.5 block truncate text-[9px] uppercase text-p1-faint'>
                    {entry.cantrip ? 'Cantrip' : `Rank ${entry.rank}`}
                    {entry.spell.traditions.length ? ` · ${entry.spell.traditions.join(', ')}` : ''}
                    {assign && !fits ? ' · prepares its own rank' : ''}
                  </span>
                </span>
              </button>
              <button
                type='button'
                className='icon-button shrink-0'
                title='Remove from spellbook'
                disabled={busy}
                onClick={() => void onRemove(entry.spell.id, entry.rank)}
              >
                <X size={14} />
              </button>
            </div>
          );
        }}
      />}
      {adding && (
        <SelectCatalogSpellModal
          busy={busy}
          traditionFilter={traditionFilter}
          preferRank={assign?.rank}
          title={slotsOnly
            ? (assign ? `Prepare ${sourceName} · Rank ${assign.rank === 0 ? 'Cantrip' : assign.rank}` : `Prepare ${sourceName}`)
            : 'Add any spell'}
          onClose={() => {
            if (initialAdding || slotsOnly) onClose();
            else setAdding(false);
          }}
          onAdd={async (spell, rank) => {
            await onAdd(spell, rank);
            if (!slotsOnly) setAdding(false);
          }}
        />
      )}
      {preview && (
        <SpellbookPreview entry={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}

function SelectCatalogSpellModal({
  busy,
  traditionFilter,
  preferRank,
  title = 'Add any spell',
  onAdd,
  onClose,
}: {
  busy?: boolean;
  traditionFilter?: string | null;
  preferRank?: number;
  title?: string;
  onAdd: (spell: Spell, rank: number) => Promise<void>;
  onClose: () => void;
}) {
  const [heighten, setHeighten] = useState<Spell | null>(null);
  const [tradition, setTradition] = useState<string | null>(traditionFilter ?? null);
  const [rankFilter, setRankFilter] = useState<number[]>([]);
  const catalog = useQuery({
    queryKey: ['phase1-spell-catalog', getDefaultSourcesKey('PAGE')],
    queryFn: async () => {
      const spells = await fetchContentAll<Spell>('spell', getDefaultSources('PAGE'));
      return (spells ?? [])
        .filter((spell) => isSpellVisible('CHARACTER', spell))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const items = useMemo(() => {
    let spells = catalog.data ?? EMPTY_SPELLS;
    if (tradition) {
      spells = spells.filter((spell) => spell.traditions.some((item) => item.toLowerCase() === tradition));
    }
    if (rankFilter.length) {
      spells = spells.filter((spell) => rankFilter.includes(spell.rank));
    }
    if (preferRank != null) {
      spells = spells.filter((spell) => spellFitsSlot(spell, preferRank));
    }
    return spells;
  }, [catalog.data, preferRank, rankFilter, tradition]);

  async function choose(spell: Spell) {
    if (busy) return;
    if (preferRank != null) {
      await onAdd(spell, preferRank);
      return;
    }
    if (spell.rank === 0 || spell.rank === 10) {
      await onAdd(spell, spell.rank);
      return;
    }
    setHeighten(spell);
  }

  return (
    <>
      <Phase1PickerModal
        title={title}
        titleId='phase1-add-spell-title'
        searchPlaceholder='Search the catalog'
        items={items}
        getName={(spell) => spell.name}
        getKey={(spell) => String(spell.id)}
        matchesSearch={(spell, needle) =>
          [spell.name, spell.description, ...spell.traditions].join(' ').toLowerCase().includes(needle)
        }
        loading={catalog.isLoading}
        error={catalog.isError ? (catalog.error instanceof Error ? catalog.error.message : 'Could not load spells.') : null}
        empty='No matching spells.'
        onClose={onClose}
        maxWidthClass='max-w-2xl'
        overlayClass='z-[110]'
        toolbar={
          <div className='mt-2 space-y-2'>
            <TraditionFilter value={tradition} onChange={setTradition} />
            <RankFilter value={rankFilter} onChange={setRankFilter} />
            <p className='text-[11px] text-p1-muted'>
              {preferRank != null
                ? 'Click a spell to prepare it in this slot.'
                : 'Click a spell to add it. Ranked spells will ask which rank to write in.'}
            </p>
          </div>
        }
        renderItem={(spell) => (
          <button
            type='button'
            className='flex w-full items-center gap-2 border-b border-p1-border px-4 py-2.5 text-left hover:bg-p1-hover disabled:opacity-50'
            disabled={busy}
            onClick={() => void choose(spell)}
          >
            <ActionSymbol cost={spell.cast} />
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-medium'>{spell.name}</span>
              <span className='mt-0.5 block truncate text-[9px] uppercase text-p1-faint'>
                {spell.rank === 0 ? 'Cantrip' : `Rank ${spell.rank}`}
                {spell.traditions.length ? ` · ${spell.traditions.join(', ')}` : ''}
              </span>
            </span>
            <span className='shrink-0 text-[10px] font-semibold text-p1-accent-soft'>{preferRank != null ? 'Prepare' : 'Add'}</span>
          </button>
        )}
      />
      {heighten && (
        <HeightenRankModal
          spell={heighten}
          busy={busy}
          onClose={() => setHeighten(null)}
          onConfirm={async (rank) => {
            await onAdd(heighten, rank);
            setHeighten(null);
          }}
        />
      )}
    </>
  );
}

function RankFilter({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  function toggle(rank: number) {
    onChange(value.includes(rank) ? value.filter((item) => item !== rank) : [...value, rank].sort((a, b) => a - b));
  }
  return (
    <div className='flex flex-wrap gap-1' role='group' aria-label='Filter by rank'>
      <button
        type='button'
        className={`h-6 px-2 text-[10px] font-semibold ${!value.length ? 'bg-p1-accent text-p1-accent-ink' : 'border border-p1-border text-p1-muted hover:bg-p1-hover'}`}
        onClick={() => onChange([])}
      >
        All ranks
      </button>
      {RANK_FILTERS.map((rank) => {
        const active = value.includes(rank);
        return (
          <button
            key={rank}
            type='button'
            aria-pressed={active}
            className={`h-6 min-w-6 px-2 text-[10px] font-semibold ${active ? 'bg-p1-accent text-p1-accent-ink' : 'border border-p1-border text-p1-muted hover:bg-p1-hover'}`}
            onClick={() => toggle(rank)}
          >
            {rank === 0 ? 'Cantrip' : rank}
          </button>
        );
      })}
    </div>
  );
}

function TraditionFilter({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  return (
    <div className='flex flex-wrap gap-1' role='group' aria-label='Filter by tradition'>
      <button
        type='button'
        className={`h-6 px-2 text-[10px] font-semibold ${!value ? 'bg-p1-accent text-p1-accent-ink' : 'border border-p1-border text-p1-muted hover:bg-p1-hover'}`}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {TRADITIONS.map((item) => (
        <button
          key={item}
          type='button'
          className={`h-6 px-2 text-[10px] font-semibold capitalize ${value === item ? 'bg-p1-accent text-p1-accent-ink' : 'border border-p1-border text-p1-muted hover:bg-p1-hover'}`}
          onClick={() => onChange(value === item ? null : item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function HeightenRankModal({
  spell,
  busy,
  onConfirm,
  onClose,
}: {
  spell: Spell;
  busy?: boolean;
  onConfirm: (rank: number) => Promise<void>;
  onClose: () => void;
}) {
  const ranks = heightenRanksFor(spell);
  return (
    <div className='fixed inset-0 z-[120] grid place-items-center bg-black/60 p-5' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' className='w-full max-w-sm border border-p1-border bg-p1-surface p-4 shadow-2xl'>
        <h3 className='text-sm font-semibold'>Add {spell.name} at rank</h3>
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {ranks.map((rank) => (
            <button
              key={rank}
              type='button'
              disabled={busy}
              className='h-8 min-w-8 border border-p1-border px-2 text-xs font-semibold hover:border-p1-accent/50 hover:bg-p1-hover disabled:opacity-50'
              onClick={() => void onConfirm(rank)}
            >
              {rank}
            </button>
          ))}
        </div>
        <button type='button' className='mt-4 text-xs text-p1-muted hover:text-p1-text' onClick={onClose}>Cancel</button>
      </section>
    </div>
  );
}

function SpellbookPreview({ entry, onClose }: { entry: Phase1SpellbookEntry; onClose: () => void }) {
  const spell = entry.spell;
  return (
    <div className='fixed inset-0 z-[110] grid place-items-center bg-black/60 p-5' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' className='flex max-h-[min(80vh,720px)] w-full max-w-2xl flex-col border border-p1-border bg-p1-surface shadow-2xl'>
        <header className='flex items-start gap-3 border-b border-p1-border px-4 py-3'>
          <BookOpen size={16} className='mt-1 text-p1-accent' />
          <div className='min-w-0 flex-1'>
            <h3 className='text-lg font-semibold'>{spell.name}</h3>
            <p className='text-[11px] uppercase text-p1-muted'>{entry.cantrip ? 'Cantrip' : `Rank ${entry.rank}`}</p>
          </div>
          <button type='button' className='icon-button' onClick={onClose} title='Close'><X size={16} /></button>
        </header>
        <div className='min-h-0 overflow-y-auto px-4 py-3'>
          <ProseMarkdown>{spell.description}</ProseMarkdown>
        </div>
      </section>
    </div>
  );
}
