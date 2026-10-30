import { parseIconValue } from '@common/IconDisplay';
import { compiledConditions } from '@conditions/condition-handler';
import { getJsonV4Content } from '@export/json/json-v4';
import type { Character, Combatant, Encounter, LivingEntity } from '@schemas/content';
import { sign } from '@utils/numbers';
import { useQueries, useQuery } from '@tanstack/react-query';
import { UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { phase1Request } from './phase1-api';
import { combatantDisplayName } from './phase1-initiative';
import { lookupMonsterArt } from './phase1-monster-image';
import { isContentStackOpen } from './phase1-content-links';
import { encounterDisplayName, encounterNamesMatch } from './phase1-encounter-title';
import { ProseMarkdown } from './phase1-markdown';
import { Phase1StatBlockCardsPacked } from './phase1-stat-block-cards-packed';

export type CampaignHomeNote = {
  index: number;
  name: string;
  shared?: boolean;
  markdown: string;
};

type StatBlockContent = Awaited<ReturnType<typeof getJsonV4Content>>;

type PcWindow = {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
};

const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;

type NoteWindow = CampaignHomeNote & {
  encounterId: number;
  encounterName: string;
  x: number;
  y: number;
  z: number;
};

type NoteHover = {
  note: CampaignHomeNote;
  encounterId: number;
  encounterName: string;
  x: number;
  y: number;
};

type RosterHover = {
  kind: 'allies' | 'enemies';
  encounterId: number;
  x: number;
  y: number;
};

function firstRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function speedText(data: StatBlockContent | undefined) {
  if (!data) return '—';
  const speeds = data.speeds.filter((item) => item.value.total !== 0 && item.value.value !== 0);
  if (speeds.length === 0) return '—';
  return speeds
    .map((item) => (item.name === 'SPEED' ? `${item.value.total}` : `${item.name.replace('SPEED_', '').slice(0, 3).toLowerCase()} ${item.value.total}`))
    .join(', ');
}

function prof(data: StatBlockContent | undefined, name: string) {
  const total = data?.proficiencies[name]?.total;
  return total == null || total === '' ? '—' : String(total);
}

function abilityMod(data: StatBlockContent | undefined, key: string) {
  const match = data ? Object.entries(data.attributes).find(([name]) => name.includes(key)) : undefined;
  if (!match) return '—';
  return sign(match[1].value);
}

function Portrait({ character }: { character: Character }) {
  const stored = parseIconValue(character.details?.image_url?.trim() ?? '');
  const src = stored.type === 'image' ? stored.value.trim() : '';
  if (src) {
    return <img src={src} alt='' className='h-6 w-6 shrink-0 border border-p1-border bg-p1-inset object-cover' />;
  }
  return (
    <span className='grid h-6 w-6 shrink-0 place-items-center border border-p1-pc/50 text-p1-pc'>
      <UserRound size={12} />
    </span>
  );
}

function encounterCounts(encounter: Encounter) {
  const list = encounter.combatants?.list ?? [];
  const allies = list.filter((combatant) => combatant.ally).length;
  return { total: list.length, allies, enemies: list.length - allies };
}

export function Phase1CampaignHome({ campaignId, players, encounters, notes = [], wide = false }: { campaignId: number; players: Character[]; encounters: Encounter[]; notes?: CampaignHomeNote[]; wide?: boolean }) {
  const navigate = useNavigate();
  const [windows, setWindows] = useState<PcWindow[]>([]);
  const [noteWindows, setNoteWindows] = useState<NoteWindow[]>([]);
  const [noteHover, setNoteHover] = useState<NoteHover | null>(null);
  const [rosterHover, setRosterHover] = useState<RosterHover | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const rosterTimer = useRef<number | null>(null);

  function showNoteHover(next: NoteHover) {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    setNoteHover(next);
  }

  function hideNoteHover() {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setNoteHover(null), 160);
  }

  function showRosterHover(next: RosterHover) {
    if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current);
    setRosterHover(next);
  }

  function hideRosterHover() {
    if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current);
    rosterTimer.current = window.setTimeout(() => setRosterHover(null), 160);
  }
  const statQueries = useQueries({
    queries: players.map((player) => ({
      queryKey: ['phase1-party-row', player.id],
      queryFn: () => getJsonV4Content(player),
      staleTime: 30_000,
    })),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isContentStackOpen()) return;
      const topNote = noteWindows.reduce<NoteWindow | null>((best, item) => (!best || item.z > best.z ? item : best), null);
      const topPc = windows.reduce<PcWindow | null>((best, item) => (!best || item.z > best.z ? item : best), null);
      if (topNote && (!topPc || topNote.z >= topPc.z)) {
        setNoteWindows((current) => current.filter((item) => !(item.encounterId === topNote.encounterId && item.index === topNote.index)));
        return;
      }
      if (!topPc) return;
      setWindows((current) => current.filter((item) => item.id !== topPc.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [windows, noteWindows]);

  function notesFor(encounter: Encounter) {
    return notes.filter((note) => encounterNamesMatch(note.name, encounter.name));
  }

  function lockNote(note: CampaignHomeNote, encounter: Encounter, x: number, y: number) {
    setNoteHover(null);
    setNoteWindows((current) => {
      const key = `${encounter.id}:${note.index}`;
      const z = current.reduce((max, item) => Math.max(max, item.z), 40) + 1;
      const existing = current.find((item) => `${item.encounterId}:${item.index}` === key);
      if (existing) return current.map((item) => (`${item.encounterId}:${item.index}` === key ? { ...item, z } : item));
      return [...current, { ...note, encounterId: encounter.id, encounterName: encounter.name, x, y, z }];
    });
  }

  function openPlayer(player: Character) {
    setWindows((current) => {
      const existing = current.find((item) => item.id === player.id);
      const z = current.reduce((max, item) => Math.max(max, item.z), 30) + 1;
      if (existing) return current.map((item) => (item.id === player.id ? { ...item, name: player.name, z } : item));
      const offset = current.length * 28;
      return [...current, { id: player.id, name: player.name, x: 72 + offset, y: 64 + offset, z }];
    });
  }

  return (
    <div className={wide ? 'flex h-full min-h-0 w-full flex-col' : 'mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6'}>
      <section className={wide ? 'min-h-0 w-full flex-1 overflow-auto py-2 pl-3 pr-10' : 'min-h-0 flex-1 overflow-auto py-2'}>
        <table className='w-full border-collapse text-xs'>
          <thead className='sticky top-0 z-[1] border-b border-p1-border bg-p1-header text-[10px] uppercase text-p1-faint'>
            <tr>
              {['Name', 'Ancestry', 'Class', 'Lvl', 'HP', 'AC', 'Fort', 'Ref', 'Will', 'Per', 'Spd', ...(wide ? ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha', 'Conditions'] : [])].map((label) => (
                <th key={label} className='whitespace-nowrap px-2 py-1.5 text-left font-medium'>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((player, index) => {
              const data = statQueries[index]?.data;
              const loading = statQueries[index]?.isLoading;
              const conditions = compiledConditions(player.details?.conditions ?? []);
              const currentHp = player.hp_current ?? data?.max_hp;
              return (
                <tr key={player.id} className='cursor-pointer border-b border-p1-border hover:bg-p1-hover' onClick={() => openPlayer(player)}>
                  <td className='px-2 py-1'>
                    <span className='flex items-center gap-2'>
                      <Portrait character={player} />
                      <span className='truncate font-semibold'>{player.name}</span>
                    </span>
                  </td>
                  <td className='whitespace-nowrap px-2 py-1 text-p1-muted'>{player.details?.ancestry?.name ?? '—'}</td>
                  <td className='whitespace-nowrap px-2 py-1 text-p1-muted'>{player.details?.class?.name ?? '—'}</td>
                  <td className='px-2 py-1'>{player.level ?? '—'}</td>
                  <td className='px-2 py-1'>
                    <span className='inline-flex min-w-14 items-center justify-center border border-p1-border bg-p1-raised px-1.5 py-0.5'>
                      {currentHp == null && !data ? '—' : `${currentHp ?? '—'}/${data?.max_hp ?? '—'}`}
                    </span>
                  </td>
                  <td className='px-2 py-1'>{loading && data == null ? '…' : data?.ac ?? '—'}</td>
                  <td className='px-2 py-1'>{prof(data, 'SAVE_FORT')}</td>
                  <td className='px-2 py-1'>{prof(data, 'SAVE_REFLEX')}</td>
                  <td className='px-2 py-1'>{prof(data, 'SAVE_WILL')}</td>
                  <td className='px-2 py-1'>{prof(data, 'PERCEPTION')}</td>
                  <td className='whitespace-nowrap px-2 py-1'>{loading && data == null ? '…' : speedText(data)}</td>
                  {wide && ABILITY_KEYS.map((key) => (
                    <td key={key} className='px-2 py-1 font-mono'>{abilityMod(data, key)}</td>
                  ))}
                  {wide && (
                    <td className='max-w-48 truncate px-2 py-1 text-p1-muted'>
                      {conditions.length === 0 ? '—' : conditions.map((item) => (item.value ? `${item.name} ${item.value}` : item.name)).join(', ')}
                    </td>
                  )}
                </tr>
              );
            })}
            {players.length === 0 ? (
              <tr>
                <td colSpan={wide ? 18 : 11} className='px-3 py-8 text-center text-sm text-p1-faint'>No one is in the party.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      <div className='h-px shrink-0 bg-p1-border' />
      <section className={wide ? 'min-h-0 flex-1 overflow-auto py-2 pl-3 pr-10' : 'min-h-0 flex-1 overflow-auto py-2'}>
        <table className='w-full border-collapse text-xs'>
          <thead className='sticky top-0 border-b border-p1-border bg-p1-header text-[10px] uppercase text-p1-faint'>
            <tr>
              <th className='px-2 py-1.5 text-left font-medium'>Encounter</th>
              <th className='px-2 py-1.5 text-left font-medium'>Notes</th>
              <th className='w-24 px-2 py-1.5 text-left font-medium'>Combatants</th>
              <th className='w-24 px-2 py-1.5 text-left font-medium'>Allies</th>
              <th className='w-24 px-2 py-1.5 text-left font-medium'>Enemies</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((encounter) => {
              const counts = encounterCounts(encounter);
              const matched = notesFor(encounter);
              return (
                <tr
                  key={encounter.id}
                  className='cursor-pointer border-b border-p1-border hover:bg-p1-hover'
                  onClick={() => navigate(`/phase1/campaign/${campaignId}/encounters/${encounter.id}`)}
                >
                  <td className='px-2 py-1 font-semibold'>{encounter.name}</td>
                  <td className='px-2 py-1'>
                    {matched.length === 0 ? <span className='text-p1-faint'>—</span> : (
                      <span className='flex flex-wrap gap-1'>
                        {matched.map((note) => (
                          <button
                            key={note.index}
                            type='button'
                            className='max-w-56 truncate border border-p1-border bg-p1-raised px-1.5 py-0.5 text-left text-p1-text hover:border-p1-accent'
                            onMouseEnter={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              showNoteHover({ note, encounterId: encounter.id, encounterName: encounter.name, x: rect.left, y: rect.bottom + 6 });
                            }}
                            onMouseLeave={hideNoteHover}
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              lockNote(note, encounter, Math.min(rect.left, window.innerWidth - 560), rect.bottom + 8);
                            }}
                          >
                            {encounterDisplayName(note.name)}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className='px-2 py-1'>{counts.total}</td>
                  <td
                    className='px-2 py-1'
                    onMouseEnter={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      showRosterHover({ kind: 'allies', encounterId: encounter.id, x: rect.left, y: rect.bottom + 6 });
                    }}
                    onMouseLeave={hideRosterHover}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {counts.allies}
                  </td>
                  <td
                    className='px-2 py-1'
                    onMouseEnter={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      showRosterHover({ kind: 'enemies', encounterId: encounter.id, x: rect.left, y: rect.bottom + 6 });
                    }}
                    onMouseLeave={hideRosterHover}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {counts.enemies}
                  </td>
                </tr>
              );
            })}
            {encounters.length === 0 ? (
              <tr>
                <td colSpan={5} className='px-3 py-8 text-center text-sm text-p1-faint'>No encounters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {rosterHover && (
        <RosterPreview
          hover={rosterHover}
          encounter={encounters.find((item) => item.id === rosterHover.encounterId)}
          players={players}
          onEnter={() => { if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current); }}
          onLeave={hideRosterHover}
        />
      )}
      {noteHover && !noteWindows.some((item) => item.index === noteHover.note.index && item.encounterId === noteHover.encounterId) && (
        <NotePreview hover={noteHover} campaignId={campaignId} onLock={() => lockNote(noteHover.note, encounters.find((item) => item.id === noteHover.encounterId)!, noteHover.x, noteHover.y)} onEnter={() => { if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current); }} onLeave={hideNoteHover} />
      )}
      {noteWindows.map((item) => (
        <NoteLockWindow
          key={`${item.encounterId}-${item.index}`}
          campaignId={campaignId}
          frame={item}
          onFocus={() => setNoteWindows((current) => {
            const z = current.reduce((max, entry) => Math.max(max, entry.z), 40) + 1;
            return current.map((entry) => (entry.encounterId === item.encounterId && entry.index === item.index ? { ...entry, z } : entry));
          })}
          onClose={() => setNoteWindows((current) => current.filter((entry) => !(entry.encounterId === item.encounterId && entry.index === item.index)))}
          onMove={(x, y) => setNoteWindows((current) => current.map((entry) => (entry.encounterId === item.encounterId && entry.index === item.index ? { ...entry, x, y } : entry)))}
        />
      ))}
      {windows.map((item) => (
        <PcStatWindow
          key={item.id}
          window={item}
          onFocus={() => setWindows((current) => {
            const z = current.reduce((max, entry) => Math.max(max, entry.z), 30) + 1;
            return current.map((entry) => (entry.id === item.id ? { ...entry, z } : entry));
          })}
          onClose={() => setWindows((current) => current.filter((entry) => entry.id !== item.id))}
          onMove={(x, y) => setWindows((current) => current.map((entry) => (entry.id === item.id ? { ...entry, x, y } : entry)))}
        />
      ))}
    </div>
  );
}

function PcStatWindow({ window: frame, onFocus, onClose, onMove }: { window: PcWindow; onFocus: () => void; onClose: () => void; onMove: (x: number, y: number) => void }) {
  const query = useQuery({
    queryKey: ['phase1-stat-block', 'character', String(frame.id)],
    retry: false,
    queryFn: async (): Promise<LivingEntity | null> => {
      try {
        return firstRecord(await phase1Request<Character | Character[]>('find-character', { id: frame.id }));
      } catch {
        return null;
      }
    },
  });
  const entity = query.data ?? null;
  const contentQuery = useQuery({
    queryKey: ['phase1-stat-block-content', entity?.id, 'character'],
    enabled: Boolean(entity),
    queryFn: () => getJsonV4Content(entity!),
  });

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    onFocus();
    const originX = frame.x;
    const originY = frame.y;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (ev: PointerEvent) => onMove(originX + ev.clientX - startX, originY + ev.clientY - startY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return createPortal(
    <div
      className='fixed flex max-h-[70vh] w-[min(920px,92vw)] flex-col border border-p1-border bg-p1-page text-p1-text shadow-2xl'
      style={{ left: frame.x, top: frame.y, zIndex: frame.z }}
      onPointerDown={onFocus}
    >
      <header className='flex cursor-grab items-center justify-between gap-2 border-b border-p1-border bg-p1-header px-2 py-1' onPointerDown={startDrag}>
        <h2 className='truncate text-sm font-semibold'>{frame.name}</h2>
        <button type='button' className='icon-button' title={`Close ${frame.name}`} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className='min-h-0 flex-1 overflow-auto p-2'>
        {query.isLoading || (entity && contentQuery.isLoading) ? <p className='text-xs italic text-p1-muted'>Loading…</p> : null}
        {!query.isLoading && !entity ? <p className='text-xs italic text-p1-muted'>Failed to find character #{frame.id}</p> : null}
        {entity && contentQuery.data ? <Phase1StatBlockCardsPacked entity={entity} data={contentQuery.data} /> : null}
      </div>
    </div>,
    document.body,
  );
}

function numericId(value: number | { id?: number } | null | undefined) {
  if (typeof value === 'number') return value;
  return value?.id;
}

function characterFor(combatant: Combatant, players: Character[]) {
  const id = numericId(combatant.character);
  return players.find((player) => player.id === id) ?? (combatant.data as Character | undefined);
}

function allyRows(encounter: Encounter | undefined, players: Character[]) {
  return (encounter?.combatants?.list ?? []).filter((combatant) => combatant.ally).map((combatant) => {
    const character = combatant.type === 'CHARACTER' ? characterFor(combatant, players) : undefined;
    return {
      id: combatant._id,
      name: character?.name ?? combatantDisplayName(combatant),
      ancestry: character?.details?.ancestry?.name ?? '—',
      background: character?.details?.background?.name ?? '—',
      className: character?.details?.class?.name ?? '—',
    };
  });
}

function enemyRows(encounter: Encounter | undefined) {
  return (encounter?.combatants?.list ?? []).filter((combatant) => !combatant.ally).map((combatant) => ({
    id: combatant._id,
    name: combatantDisplayName(combatant),
    level: combatant.hazard?.level ?? combatant.creature?.level ?? combatant.data?.level,
    artName: combatant.creature?.name ?? combatant.data?.name ?? combatantDisplayName(combatant),
    imageUrl: combatant.creature?.details?.image_url ?? combatant.data?.details?.image_url,
    creature: combatant.type === 'CREATURE',
  }));
}

function RosterArt({ name, imageUrl, creature }: { name: string; imageUrl?: string; creature: boolean }) {
  const stored = parseIconValue(imageUrl?.trim() ?? '');
  const portrait = stored.type === 'image' ? stored.value.trim() : '';
  const art = useQuery({
    queryKey: ['phase1-roster-art', name, portrait],
    queryFn: () => lookupMonsterArt(name, portrait || undefined, 'thumb'),
    enabled: creature && Boolean(name.trim() || portrait),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const src = creature ? art.data?.thumbSrc : portrait || undefined;
  if (src) return <img src={src} alt='' className='h-8 w-8 border border-p1-border bg-p1-inset object-cover' />;
  return <span className='grid h-8 w-8 place-items-center border border-p1-border bg-p1-inset text-p1-faint'>—</span>;
}

function RosterPreview({ hover, encounter, players, onEnter, onLeave }: { hover: RosterHover; encounter: Encounter | undefined; players: Character[]; onEnter: () => void; onLeave: () => void }) {
  const allies = hover.kind === 'allies' ? allyRows(encounter, players) : [];
  const enemies = hover.kind === 'enemies' ? enemyRows(encounter) : [];
  const left = Math.min(Math.max(8, hover.x), window.innerWidth - 420);
  const top = Math.min(hover.y, window.innerHeight - 240);
  return createPortal(
    <div
      className='fixed z-[80] max-h-72 w-[min(400px,92vw)] overflow-auto border border-p1-border bg-p1-page p-2 text-p1-text shadow-2xl'
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(event) => event.stopPropagation()}
    >
      <table className='w-full border-collapse text-xs'>
        <thead className='text-[10px] uppercase text-p1-faint'>
          <tr>
            {hover.kind === 'allies' ? (
              <>
                <th className='px-2 py-1 text-left font-medium'>Name</th>
                <th className='px-2 py-1 text-left font-medium'>Ancestry</th>
                <th className='px-2 py-1 text-left font-medium'>Background</th>
                <th className='px-2 py-1 text-left font-medium'>Class</th>
              </>
            ) : (
              <>
                <th className='px-2 py-1 text-left font-medium'>Art</th>
                <th className='px-2 py-1 text-left font-medium'>Name</th>
                <th className='px-2 py-1 text-left font-medium'>Level</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {hover.kind === 'allies' && allies.map((row) => (
            <tr key={row.id} className='border-t border-p1-border'>
              <td className='px-2 py-1 font-semibold'>{row.name}</td>
              <td className='px-2 py-1 text-p1-muted'>{row.ancestry}</td>
              <td className='px-2 py-1 text-p1-muted'>{row.background}</td>
              <td className='px-2 py-1 text-p1-muted'>{row.className}</td>
            </tr>
          ))}
          {hover.kind === 'enemies' && enemies.map((row) => (
            <tr key={row.id} className='border-t border-p1-border'>
              <td className='px-2 py-1'><RosterArt name={row.artName} imageUrl={row.imageUrl} creature={row.creature} /></td>
              <td className='px-2 py-1 font-semibold'>{row.name}</td>
              <td className='px-2 py-1'>{row.level ?? '—'}</td>
            </tr>
          ))}
          {(hover.kind === 'allies' ? allies : enemies).length === 0 ? (
            <tr>
              <td colSpan={hover.kind === 'allies' ? 4 : 3} className='px-2 py-3 text-p1-faint'>None.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

function NoteChrome({ campaignId, name, shared, markdown, encounterId, encounterName }: { campaignId: number; name: string; shared?: boolean; markdown: string; encounterId: number; encounterName: string }) {
  return (
    <>
      <p className='text-[10px] font-semibold uppercase tracking-[0.14em] text-p1-faint'>Campaign notes</p>
      <h2 className='mt-1 truncate text-lg font-semibold'>{encounterDisplayName(name)}</h2>
      <p className='mt-1 text-xs text-p1-faint'>{shared ? 'Shared with party' : 'Visible to the GM only'}</p>
      <Link to={`/phase1/campaign/${campaignId}/encounters/${encounterId}`} className='mt-1 block truncate text-xs text-p1-accent hover:underline' onClick={(event) => event.stopPropagation()}>
        See encounter: {encounterDisplayName(encounterName)}
      </Link>
      <div className='mt-3 border-t border-p1-border pt-3'>
        {markdown ? <ProseMarkdown className='max-w-none'>{markdown}</ProseMarkdown> : <p className='text-sm italic text-p1-faint'>This note is empty.</p>}
      </div>
    </>
  );
}

function NotePreview({ hover, campaignId, onLock, onEnter, onLeave }: { hover: NoteHover; campaignId: number; onLock: () => void; onEnter: () => void; onLeave: () => void }) {
  const left = Math.min(hover.x, window.innerWidth - 440);
  const top = Math.min(hover.y, window.innerHeight - 280);
  return createPortal(
    <div
      className='fixed z-[80] max-h-80 w-[min(420px,92vw)] overflow-auto border border-p1-border bg-p1-page p-4 text-p1-text shadow-2xl'
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(event) => { event.stopPropagation(); onLock(); }}
    >
      <NoteChrome campaignId={campaignId} name={hover.note.name} shared={hover.note.shared} markdown={hover.note.markdown} encounterId={hover.encounterId} encounterName={hover.encounterName} />
    </div>,
    document.body,
  );
}

function NoteLockWindow({ campaignId, frame, onFocus, onClose, onMove }: { campaignId: number; frame: NoteWindow; onFocus: () => void; onClose: () => void; onMove: (x: number, y: number) => void }) {
  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, a')) return;
    event.preventDefault();
    onFocus();
    const originX = frame.x;
    const originY = frame.y;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (ev: PointerEvent) => onMove(originX + ev.clientX - startX, originY + ev.clientY - startY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return createPortal(
    <div
      className='fixed flex max-h-[70vh] w-[min(720px,92vw)] flex-col border border-p1-border bg-p1-page text-p1-text shadow-2xl'
      style={{ left: frame.x, top: frame.y, zIndex: frame.z }}
      onPointerDown={onFocus}
    >
      <header className='flex cursor-grab items-center justify-end border-b border-p1-border bg-p1-header px-2 py-1' onPointerDown={startDrag}>
        <button type='button' className='icon-button' title='Close note' onClick={onClose}><X size={14} /></button>
      </header>
      <div className='min-h-0 flex-1 overflow-auto px-5 py-4'>
        <NoteChrome campaignId={campaignId} name={frame.name} shared={frame.shared} markdown={frame.markdown} encounterId={frame.encounterId} encounterName={frame.encounterName} />
      </div>
    </div>,
    document.body,
  );
}
