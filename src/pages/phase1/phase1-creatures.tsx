import { useQuery } from '@tanstack/react-query';
import { fetchContentAll, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import type { Creature } from '@schemas/content';
import { getEntityLevel } from '@utils/entity-utils';
import { ChevronDown, Swords } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { hydrateCreatureForCombat } from './phase1-entity';
import { lookupMonsterArt } from './phase1-monster-image';
import { ProseMarkdown } from './phase1-markdown';
import { Phase1PickerModal } from './phase1-picker-modal';

const EMPTY_CREATURES: Creature[] = [];

export function SelectCreatureModal({
  busy,
  onSelect,
  onClose,
}: {
  busy?: boolean;
  onSelect: (creature: Creature, ally: boolean) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ally, setAlly] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const catalog = useQuery({
    queryKey: ['phase1-creature-catalog', getDefaultSourcesKey('PAGE')],
    queryFn: async () => {
      const creatures = await fetchContentAll<Creature>('creature', getDefaultSources('PAGE'));
      return (creatures ?? [])
        .filter((creature) => creature.level !== -100 && !creature.deprecated)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const items = catalog.data ?? EMPTY_CREATURES;
  const selected = items.find((creature) => creature.id === selectedId) ?? null;

  useEffect(() => {
    if (!added) return;
    const timeout = window.setTimeout(() => setAdded(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [added]);

  async function add(creature: Creature, adjustment?: 'ELITE' | 'WEAK') {
    if (busy || adding) return;
    setAdding(true);
    try {
      const next = await hydrateCreature(creature, adjustment);
      onSelect(next, ally);
      setAdded(next.name);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Phase1PickerModal
      title='Select Creature'
      titleId='select-creature-title'
      searchPlaceholder='Search creatures'
      items={items}
      getName={(creature) => creature.name}
      getKey={(creature) => String(creature.id)}
      matchesSearch={(creature, needle) =>
        creature.name.toLowerCase().includes(needle) || creature.details.description.toLowerCase().includes(needle)
      }
      loading={catalog.isLoading}
      error={catalog.isError ? (catalog.error instanceof Error ? catalog.error.message : 'Could not load creatures.') : null}
      empty='No matching creatures.'
      onClose={onClose}
      maxWidthClass='max-w-4xl'
      maxHeightClass='max-h-[min(86vh,760px)]'
      batchSize={16}
      toolbar={
        <div className='mt-2 flex items-center gap-2'>
          <div className='flex border border-p1-border' role='group' aria-label='Combatant side'>
            <SideButton active={!ally} onClick={() => setAlly(false)}>
              Enemy
            </SideButton>
            <SideButton active={ally} onClick={() => setAlly(true)}>
              Ally
            </SideButton>
          </div>
          {added && <span className='truncate text-xs text-emerald-300'>Added {added}</span>}
        </div>
      }
      renderItem={(creature) => (
        <button
          type='button'
          className={`flex w-full items-center gap-3 border-b border-p1-border px-3 py-2.5 text-left hover:bg-p1-hover ${
            creature.id === selectedId ? 'bg-p1-accent/[0.08]' : ''
          }`}
          onClick={() => setSelectedId(creature.id)}
        >
          <CreatureThumb src={creature.details.image_url} name={creature.name} />
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm text-p1-text'>{creature.name}</span>
            <span className='block text-[11px] uppercase tracking-wide text-p1-faint'>
              Level {getEntityLevel(creature)}
              {creature.rarity !== 'COMMON' ? ` · ${labelize(creature.rarity)}` : ''}
            </span>
          </span>
        </button>
      )}
      aside={<CreaturePreview creature={selected} busy={busy || adding} ally={ally} onAdd={add} />}
    />
  );
}

function CreaturePreview({
  creature,
  busy,
  ally,
  onAdd,
}: {
  creature: Creature | null;
  busy?: boolean;
  ally: boolean;
  onAdd: (creature: Creature, adjustment?: 'ELITE' | 'WEAK') => void;
}) {
  if (!creature) {
    return (
      <div className='grid h-full place-items-center px-6 text-center text-sm text-p1-muted'>
        Choose a creature to preview, then add it as an {ally ? 'ally' : 'enemy'}.
      </div>
    );
  }

  const stats = creature.meta_data?.calculated_stats;
  const description = creature.details.description.trim();

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
        <CreatureArt name={creature.name} fallback={creature.details.image_url} />
        <div className='mt-3 flex flex-wrap items-end gap-x-3 gap-y-1'>
          <h3 className='text-xl font-semibold leading-tight'>{creature.name}</h3>
          <span className='text-sm text-p1-muted'>Level {getEntityLevel(creature)}</span>
          {creature.rarity !== 'COMMON' && (
            <span className='border border-p1-border bg-p1-hover px-2 py-0.5 text-[10px] font-semibold uppercase text-p1-text'>
              {labelize(creature.rarity)}
            </span>
          )}
        </div>
        {stats && (
          <p className='mt-2 text-xs text-p1-muted'>
            {stats.hp_max != null && <>{stats.hp_max} HP</>}
            {stats.hp_max != null && stats.ac != null && <span className='px-1.5 text-p1-faint'>|</span>}
            {stats.ac != null && <>{stats.ac} AC</>}
          </p>
        )}
        {description && (
          <div className='mt-3'>
            <ProseMarkdown>{description}</ProseMarkdown>
          </div>
        )}
      </div>
      <div className='flex items-center justify-end gap-2 border-t border-p1-border px-4 py-3'>
        <AddCreatureButtons disabled={busy} onAdd={() => onAdd(creature)} onElite={() => onAdd(creature, 'ELITE')} onWeak={() => onAdd(creature, 'WEAK')} />
      </div>
    </div>
  );
}

function CreatureArt({ name, fallback }: { name: string; fallback?: string }) {
  const art = useQuery({
    queryKey: ['phase1-creature-picker-art', name, fallback],
    queryFn: () => lookupMonsterArt(name, fallback),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const src = art.data?.thumbSrc || fallback;
  if (!src) {
    return (
      <div className='grid h-40 w-full place-items-center border border-p1-border bg-p1-inset text-p1-faint'>
        <Swords size={28} />
      </div>
    );
  }
  return <img src={src} alt='' className='h-40 w-full border border-p1-border object-contain bg-p1-inset' />;
}

function CreatureThumb({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className='grid h-9 w-9 shrink-0 place-items-center border border-p1-border bg-p1-inset text-p1-faint' aria-hidden>
        <Swords size={14} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=''
      title={name}
      className='h-9 w-9 shrink-0 border border-p1-border object-contain bg-p1-inset'
      onError={() => setFailed(true)}
    />
  );
}

function AddCreatureButtons({
  disabled,
  onAdd,
  onElite,
  onWeak,
}: {
  disabled?: boolean;
  onAdd: () => void;
  onElite: () => void;
  onWeak: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={menuRef} className='relative flex'>
      <button type='button' className='toolbar-button border-p1-accent/40 text-p1-accent-soft' disabled={disabled} onClick={onAdd}>
        Add
      </button>
      <button
        type='button'
        className='toolbar-button border-l-0 border-p1-accent/40 px-2 text-p1-accent-soft'
        disabled={disabled}
        aria-haspopup='menu'
        aria-expanded={open}
        title='Elite or Weak'
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <div role='menu' className='absolute bottom-full right-0 z-10 mb-1 min-w-36 border border-p1-border bg-p1-surface py-1 shadow-2xl'>
          <button
            type='button'
            role='menuitem'
            className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
            onClick={() => {
              setOpen(false);
              onElite();
            }}
          >
            Add Elite
          </button>
          <button
            type='button'
            role='menuitem'
            className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
            onClick={() => {
              setOpen(false);
              onWeak();
            }}
          >
            Add Weak
          </button>
        </div>
      )}
    </div>
  );
}

function SideButton({ children, active, onClick }: { children: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 px-3 text-[11px] font-semibold uppercase ${
        active ? 'bg-p1-accent text-p1-accent-ink' : 'bg-transparent text-p1-muted hover:text-p1-text'
      }`}
    >
      {children}
    </button>
  );
}

function labelize(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

async function hydrateCreature(creature: Creature, adjustment?: 'ELITE' | 'WEAK') {
  return hydrateCreatureForCombat(creature, adjustment);
}
