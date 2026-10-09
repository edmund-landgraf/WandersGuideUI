import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchContentAll, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import { fetchHazards } from '@content/hazards';
import type { Creature, Hazard, Trait } from '@schemas/content';
import { findCreatureTraits } from '@utils/creature';
import { getEntityLevel } from '@utils/entity-utils';
import { ChevronDown, Swords } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { hydrateCreatureForCombat } from './phase1-entity';
import { lookupMonsterArt, readArtPassword, unlockMonsterArt } from './phase1-monster-image';
import { ProseMarkdown } from './phase1-markdown';
import { Phase1PickerModal } from './phase1-picker-modal';

const EMPTY_CREATURES: Creature[] = [];
const ANY_CREATURE_TYPE = -10;

type CompanionTypeOption = { id: number; name: string };

export function SelectCompanionModal({
  onSelect,
  onClose,
}: {
  onSelect: (creature: Creature) => void;
  onClose: () => void;
}) {
  const [typeId, setTypeId] = useState<number | null>(null);
  const catalog = useQuery({
    queryKey: ['get-companions-data', { sources: getDefaultSourcesKey('PAGE') }],
    queryFn: async () => {
      const traits = await fetchContentAll<Trait>('trait', getDefaultSources('PAGE'));
      const creatures = await fetchContentAll<Creature>('creature', getDefaultSources('PAGE'));
      return { traits: traits ?? [], creatures: creatures ?? [] };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const types = useMemo<CompanionTypeOption[]>(() => {
    const companionTypes = (catalog.data?.traits ?? [])
      .filter((trait) => trait.meta_data?.companion_type_trait)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((trait) => ({ id: trait.id, name: trait.name }));
    return [...companionTypes, { id: ANY_CREATURE_TYPE, name: 'Any creature' }];
  }, [catalog.data]);
  const creatures = useMemo(() => {
    const all = (catalog.data?.creatures ?? [])
      .filter((creature) => creature.level !== -100)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (typeId == null || typeId === ANY_CREATURE_TYPE) return all;
    return all.filter((creature) => findCreatureTraits(creature).includes(typeId));
  }, [catalog.data, typeId]);

  if (typeId == null) {
    return (
      <Phase1PickerModal
        title='Create companion'
        titleId='select-companion-type-title'
        searchPlaceholder='Search companion types'
        items={types}
        getName={(item) => item.name}
        getKey={(item) => String(item.id)}
        loading={catalog.isLoading}
        error={catalog.isError ? (catalog.error instanceof Error ? catalog.error.message : 'Could not load companions.') : null}
        empty='No companion types found.'
        onClose={onClose}
        renderItem={(item) => (
          <button
            type='button'
            className='flex w-full items-center border-b border-p1-border px-4 py-3 text-left text-sm text-p1-text hover:bg-p1-hover'
            onClick={() => setTypeId(item.id)}
          >
            {item.name}
          </button>
        )}
      />
    );
  }

  const typeName = types.find((item) => item.id === typeId)?.name ?? 'Companion';
  return (
    <Phase1PickerModal
      title={typeName}
      titleId='select-companion-creature-title'
      searchPlaceholder='Search companions'
      items={creatures}
      getName={(creature) => creature.name}
      getKey={(creature) => String(creature.id)}
      matchesSearch={(creature, needle) =>
        creature.name.toLowerCase().includes(needle) || creature.details.description.toLowerCase().includes(needle)
      }
      loading={catalog.isLoading}
      error={catalog.isError ? (catalog.error instanceof Error ? catalog.error.message : 'Could not load companions.') : null}
      empty='No matching companions.'
      onClose={onClose}
      toolbar={
        <button type='button' className='mt-2 text-xs text-p1-accent-soft hover:underline' onClick={() => setTypeId(null)}>
          Back to types
        </button>
      }
      renderItem={(creature) => (
        <button
          type='button'
          className='flex w-full items-center gap-3 border-b border-p1-border px-3 py-2.5 text-left hover:bg-p1-hover'
          onClick={() => onSelect(creature)}
        >
          <CreatureThumb name={creature.name} />
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm text-p1-text'>{creature.name}</span>
            <span className='block text-[11px] uppercase tracking-wide text-p1-faint'>Level {getEntityLevel(creature)}</span>
          </span>
        </button>
      )}
    />
  );
}

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
          <CreatureThumb name={creature.name} />
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

const EMPTY_HAZARDS: Hazard[] = [];

export function SelectHazardModal({
  busy,
  onSelect,
  onClose,
}: {
  busy?: boolean;
  onSelect: (hazard: Hazard) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ['phase1-hazard-catalog', getDefaultSourcesKey('PAGE'), getDefaultSourcesKey('INFO')],
    queryFn: async () => {
      const hazards = await fetchHazards();
      return hazards.filter((hazard) => !hazard.deprecated).sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const items = catalog.data ?? EMPTY_HAZARDS;
  const selected = items.find((hazard) => hazard.id === selectedId) ?? null;

  useEffect(() => {
    if (!added) return;
    const timeout = window.setTimeout(() => setAdded(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [added]);

  function add(hazard: Hazard) {
    if (busy) return;
    onSelect(hazard);
    setAdded(hazard.name);
  }

  return (
    <Phase1PickerModal
      title='Select Hazard'
      titleId='select-hazard-title'
      searchPlaceholder='Search hazards'
      items={items}
      getName={(hazard) => hazard.name}
      getKey={(hazard) => String(hazard.id)}
      matchesSearch={(hazard, needle) =>
        hazard.name.toLowerCase().includes(needle) || hazard.details.description.toLowerCase().includes(needle)
      }
      loading={catalog.isLoading}
      error={catalog.isError ? (catalog.error instanceof Error ? catalog.error.message : 'Could not load hazards.') : null}
      empty='No matching hazards.'
      onClose={onClose}
      maxWidthClass='max-w-4xl'
      maxHeightClass='max-h-[min(86vh,760px)]'
      batchSize={16}
      toolbar={added ? <p className='mt-2 truncate text-xs text-emerald-300'>Added {added}</p> : undefined}
      renderItem={(hazard) => (
        <button
          type='button'
          className={`flex w-full items-center gap-3 border-b border-p1-border px-3 py-2.5 text-left hover:bg-p1-hover ${
            hazard.id === selectedId ? 'bg-p1-accent/[0.08]' : ''
          }`}
          onClick={() => setSelectedId(hazard.id)}
        >
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm text-p1-text'>{hazard.name}</span>
            <span className='block text-[11px] uppercase tracking-wide text-p1-faint'>
              {hazard.details.complexity === 'SIMPLE' ? 'Simple' : 'Complex'} · Level {hazard.level}
              {hazard.rarity !== 'COMMON' ? ` · ${labelize(hazard.rarity)}` : ''}
            </span>
          </span>
        </button>
      )}
      aside={<HazardPreview hazard={selected} busy={busy} onAdd={add} />}
    />
  );
}

function HazardPreview({
  hazard,
  busy,
  onAdd,
}: {
  hazard: Hazard | null;
  busy?: boolean;
  onAdd: (hazard: Hazard) => void;
}) {
  if (!hazard) {
    return (
      <div className='grid h-full place-items-center px-6 text-center text-sm text-p1-muted'>
        Choose a hazard to preview, then add it to the encounter.
      </div>
    );
  }
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
        <h3 className='text-xl font-semibold leading-tight'>{hazard.name}</h3>
        <p className='mt-1 text-sm text-p1-muted'>
          {hazard.details.complexity === 'SIMPLE' ? 'Simple' : 'Complex'} hazard · Level {hazard.level}
        </p>
        {hazard.details.stealth && (
          <p className='mt-3 text-xs text-p1-muted'><span className='font-semibold text-p1-text'>Stealth </span>{hazard.details.stealth}</p>
        )}
        {hazard.details.description && (
          <div className='mt-3'>
            <ProseMarkdown>{hazard.details.description}</ProseMarkdown>
          </div>
        )}
      </div>
      <div className='flex gap-2 border-t border-p1-border p-3'>
        <button
          type='button'
          className='inline-flex h-10 flex-1 items-center justify-center bg-p1-action text-sm font-bold italic text-p1-action-ink hover:bg-p1-action-hover disabled:opacity-50'
          disabled={busy}
          onClick={() => onAdd(hazard)}
        >
          Add hazard
        </button>
      </div>
    </div>
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
        <CreatureArt name={creature.name} />
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

function CreatureArt({ name }: { name: string }) {
  const art = useQuery({
    queryKey: ['phase1-creature-picker-art', name, 'full'],
    queryFn: () => lookupMonsterArt(name, undefined, 'full'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const src = art.data?.fullSrc;
  if (!src && !readArtPassword()) {
    return <ArtPasswordForm />;
  }
  if (!src) {
    return (
      <div className='grid h-40 w-full place-items-center border border-p1-border bg-p1-inset text-p1-faint'>
        <Swords size={28} />
      </div>
    );
  }
  return <img src={src} alt='' className='h-40 w-full border border-p1-border object-contain bg-p1-inset' />;
}

function ArtPasswordForm() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    const unlocked = await unlockMonsterArt(password);
    setPending(false);
    if (!unlocked) {
      setError('That password did not unlock art.');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['phase1-creature-picker-art'] });
    await queryClient.invalidateQueries({ queryKey: ['phase1-monster-art'] });
  }

  return (
    <form onSubmit={submit} className='grid gap-2 border border-p1-border bg-p1-inset p-3'>
      <p className='text-xs text-p1-muted'>Creature art is locked. Enter the art password to show it on this browser.</p>
      <input
        type='password'
        value={password}
        autoComplete='current-password'
        onChange={(event) => setPassword(event.target.value)}
        className='h-9 border border-p1-border bg-p1-surface px-2 text-sm text-p1-text'
        aria-label='Art password'
      />
      {error && <p className='text-xs text-red-300'>{error}</p>}
      <button
        type='submit'
        disabled={pending || !password.trim()}
        className='h-9 bg-p1-action text-sm font-bold italic text-p1-action-ink hover:bg-p1-action-hover disabled:opacity-50'
      >
        Unlock art
      </button>
    </form>
  );
}

function CreatureThumb({ name }: { name: string }) {
  const art = useQuery({
    queryKey: ['phase1-creature-picker-art', name],
    queryFn: () => lookupMonsterArt(name),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const src = art.data?.thumbSrc;
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
