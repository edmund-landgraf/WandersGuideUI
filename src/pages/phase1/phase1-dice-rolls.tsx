import { GiDiceTwentyFacesTwenty } from '@common/game-icons-inline';
import type {
  Combatant,
  DiceRollLog,
  DiceRollLogEntry,
  LivingEntity,
} from '@schemas/content';
import { ChevronsUpDown, Eraser, History, ChevronDown, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from './phase1-campaign-settings';
import { toLabel } from '@utils/strings';
import {
  DICE_NOTE_PREVIEW_LIMIT,
  DICE_OUTCOME_LEGEND,
  checkStatLabel,
  defaultStatForCombatant,
  diceEntryWasRolled,
  loadAllCheckOptions,
  outcomeLabel,
  outcomeRowClass,
  previewDiceNote,
} from './phase1-dice-check';
import type { InitiativeRollChoice, InitiativeSkillOption } from './phase1-initiative';

export function DiceRollColorKey() {
  const [open, setOpen] = useState(false);
  return (
    <div className='border-b border-p1-border bg-p1-surface'>
      <button
        type='button'
        className='flex w-full items-center gap-2 px-5 py-2 text-left text-[11px] uppercase tracking-wide text-p1-faint hover:text-p1-muted'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Color key
        <span className='normal-case tracking-normal text-p1-faint'>PF2e degrees of success</span>
        <ChevronDown size={14} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className='space-y-2 px-5 pb-3'>
          <p className='text-xs leading-5 text-p1-muted'>
            Remaster still uses four degrees, not only a natural 1 or 20. Beating or missing the DC by 10 changes the degree; a 20 steps it up and a 1 steps it down.
          </p>
          <div className='flex flex-col gap-1.5'>
            {DICE_OUTCOME_LEGEND.map((item) => (
              <div key={item.outcome} className={`flex items-baseline gap-3 border border-p1-border px-2 py-1.5 ${item.className}`}>
                <span className='shrink-0 text-xs font-semibold text-p1-text'>{item.label}</span>
                <span className='text-[11px] text-p1-muted'>{item.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DiceCheckRollModal({
  combatants,
  defaultStat,
  title,
  dc,
  onConfirm,
  onClose,
}: {
  combatants: Array<Combatant & { data: LivingEntity }>;
  defaultStat: string;
  title: string;
  dc: number;
  onConfirm: (rollBonuses: Map<string, InitiativeRollChoice>) => void;
  onClose: () => void;
}) {
  const [optionsById, setOptionsById] = useState<Record<string, InitiativeSkillOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(combatants.map((combatant) => [combatant._id, defaultStat]))
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAllCheckOptions(combatants)
      .then((loaded) => {
        if (cancelled) return;
        setOptionsById(loaded);
        setSelected((current) => {
          const next = { ...current };
          for (const combatant of combatants) {
            const options = loaded[combatant._id] ?? [];
            const preferred = current[combatant._id] ?? defaultStat;
            next[combatant._id] = defaultStatForCombatant(options, preferred);
          }
          return next;
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [combatants, defaultStat]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const rollBonuses = useMemo(() => {
    const bonuses = new Map<string, InitiativeRollChoice>();
    for (const combatant of combatants) {
      const value = selected[combatant._id];
      const option = value ? (optionsById[combatant._id] ?? []).find((item) => item.value === value) : undefined;
      bonuses.set(combatant._id, option ? { bonus: option.num, source: toLabel(option.value) } : null);
    }
    return bonuses;
  }, [combatants, optionsById, selected]);

  return createPortal(
    <div
      data-entity-modal
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='dice-check-roll-title'
        className='flex max-h-[min(82vh,640px)] w-full max-w-md flex-col border border-p1-border bg-p1-surface shadow-2xl'
      >
        <header className='flex items-start gap-3 border-b border-p1-border px-4 py-3'>
          <div className='min-w-0 flex-1'>
            <h2 id='dice-check-roll-title' className='text-lg font-semibold'>
              Assign check skills
            </h2>
            <p className='mt-1 text-sm text-p1-muted'>
              {title.trim() || checkStatLabel(defaultStat)} vs DC {dc}. Change a bonus before rolling. Skip means a natural d20 (no bonus).
            </p>
          </div>
          <button type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
          {loading && <p className='py-8 text-center text-sm text-p1-muted'>Loading modifiers...</p>}
          {!loading && (
            <div className='flex flex-col gap-3'>
              {combatants.map((combatant) => (
                <CheckSelect
                  key={combatant._id}
                  id={combatant._id}
                  label={combatant.data.name}
                  options={optionsById[combatant._id] ?? []}
                  value={selected[combatant._id] ?? null}
                  onChange={(value) => setSelected((current) => ({ ...current, [combatant._id]: value }))}
                />
              ))}
            </div>
          )}
        </div>
        <div className='border-t border-p1-border p-4'>
          <button
            type='button'
            className='inline-flex h-11 w-full items-center justify-center gap-2 bg-p1-action text-sm font-bold italic text-p1-action-ink hover:bg-p1-action-hover disabled:opacity-50'
            disabled={loading}
            onClick={() => onConfirm(rollBonuses)}
          >
            Roll
            <GiDiceTwentyFacesTwenty size={20} />
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function CheckSelect({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: InitiativeSkillOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selectId = `dice-check-${id}`;
  return (
    <div>
      <label htmlFor={selectId} className='mb-1.5 block text-sm font-semibold'>
        {label}
      </label>
      <div className='relative'>
        <select
          id={selectId}
          className='h-10 w-full appearance-none border border-p1-border bg-p1-inset py-0 pl-3 pr-16 text-sm text-p1-text outline-none focus:border-p1-accent/60'
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value=''>Skip</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2'>
          {value && (
            <button
              type='button'
              className='pointer-events-auto grid h-7 w-7 place-items-center text-p1-muted hover:text-p1-text'
              title='Skip'
              onClick={() => onChange(null)}
            >
              <X size={14} />
            </button>
          )}
          <ChevronsUpDown className='text-p1-faint' size={14} />
        </div>
      </div>
    </div>
  );
}

function roundKey(round: DiceRollLog, index: number) {
  return round.id ?? `${round.title}-${index}`;
}

function combatantLogSummary(entries: DiceRollLogEntry[]) {
  const count = entries.length;
  const noun = count === 1 ? 'combatant' : 'combatants';
  const names = entries.map((entry) => entry.name?.trim()).filter((name): name is string => Boolean(name));
  if (names.length === 0) return `${count} ${noun}`;
  return `${count} ${noun} (${names.join(', ')})`;
}

export function DiceRollLogPanel({ log, canClear, canEdit, canRemoveEntry, onClear, onRemove, onUpdateNote }: {
  log: DiceRollLog[];
  canClear?: boolean;
  canEdit?: boolean;
  canRemoveEntry?: (entry: DiceRollLog) => boolean;
  onClear?: () => void;
  onRemove?: (entry: DiceRollLog) => void;
  onUpdateNote?: (round: DiceRollLog, entry: DiceRollLogEntry, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<{ round: DiceRollLog; entry: DiceRollLogEntry } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DiceRollLog } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  function handleClear() {
    if (!canClear || !onClear) return;
    setConfirmOpen(true);
  }
  function openHeaderMenu(event: ReactMouseEvent) {
    if (!canClear || !onClear) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu(null);
    setHeaderMenu({ x: event.clientX, y: event.clientY });
  }
  const rounds = [...log].reverse();
  return (
    <section className='mt-5 border border-p1-border bg-p1-inset'>
      <div className='flex items-center gap-2 border-b border-p1-border px-4 py-3' onContextMenu={openHeaderMenu}>
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-2 text-left hover:text-p1-text'
          onClick={() => setOpen((value) => !value)}
          onContextMenu={openHeaderMenu}
          aria-expanded={open}
        >
          <History size={15} className='text-p1-muted' />
          <span className='text-sm font-semibold'>Roll log</span>
          <span className='text-xs text-p1-faint'>{log.length} check{log.length === 1 ? '' : 's'}</span>
          <ChevronDown size={14} className={`ml-auto text-p1-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {canClear && onClear && (
          <button type='button' className='toolbar-button shrink-0' title='Clear all logged checks' onClick={handleClear} onContextMenu={openHeaderMenu}>
            <Eraser size={14} /> Clear log
          </button>
        )}
      </div>
      {confirmOpen && (
        <ConfirmDialog
          title='Clear roll log'
          message={log.length === 0 ? 'There are no logged checks to remove.' : `This removes all ${log.length} logged checks. The current grid column is not cleared.`}
          confirmLabel='Clear log'
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onClear?.();
          }}
        />
      )}
      {open && (log.length === 0 ? (
        <p className='px-4 py-6 text-center text-xs text-p1-faint'>No dice rolls logged yet.</p>
      ) : rounds.map((round, index) => (
        <DiceRollLogRound
          key={roundKey(round, index)}
          round={round}
          expanded={expandedKey === roundKey(round, log.length - 1 - index)}
          onToggle={() => {
            const key = roundKey(round, log.length - 1 - index);
            setExpandedKey((current) => (current === key ? null : key));
          }}
          canRemove={Boolean(onRemove && (canRemoveEntry ? canRemoveEntry(round) : canClear))}
          onContextMenu={(event) => {
            const canRemoveThis = Boolean(onRemove && (canRemoveEntry ? canRemoveEntry(round) : canClear));
            if (!canRemoveThis && !canClear) return;
            event.preventDefault();
            event.stopPropagation();
            setHeaderMenu(null);
            setMenu({ x: event.clientX, y: event.clientY, entry: round });
          }}
          canEdit={Boolean(canEdit && onUpdateNote)}
          onEditNote={(entry) => {
            if (!canEdit || !onUpdateNote || !diceEntryWasRolled(entry)) return;
            setNoteTarget({ round, entry });
          }}
        />
      ))}
      {noteTarget && (
        <DiceRollNoteModal
          round={noteTarget.round}
          entry={noteTarget.entry}
          onCancel={() => setNoteTarget(null)}
          onSave={(note) => {
            onUpdateNote?.(noteTarget.round, noteTarget.entry, note);
            setNoteTarget(null);
          }}
        />
      )}
      {menu && (
        <LogEntryContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRemove={onRemove && (canRemoveEntry ? canRemoveEntry(menu.entry) : canClear) ? () => {
            onRemove(menu.entry);
            setMenu(null);
          } : undefined}
          onClearAll={canClear && onClear ? () => {
            setMenu(null);
            handleClear();
          } : undefined}
        />
      )}
      {headerMenu && (
        <LogHeaderContextMenu
          x={headerMenu.x}
          y={headerMenu.y}
          onClose={() => setHeaderMenu(null)}
          onClearAll={() => {
            setHeaderMenu(null);
            handleClear();
          }}
        />
      )}
    </section>
  );
}

function DiceRollLogRound({
  round,
  expanded,
  onToggle,
  onContextMenu,
  canEdit,
  onEditNote,
}: {
  round: DiceRollLog;
  expanded: boolean;
  onToggle: () => void;
  canRemove: boolean;
  onContextMenu: (event: ReactMouseEvent) => void;
  canEdit: boolean;
  onEditNote: (entry: DiceRollLogEntry) => void;
}) {
  return (
    <div
      className='border-b border-p1-border last:border-0'
      onContextMenu={onContextMenu}
    >
      <button
        type='button'
        className='flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-p1-hover'
        aria-expanded={expanded}
        onClick={onToggle}
        onContextMenu={onContextMenu}
      >
        <div className='min-w-0 flex-1'>
          {round.title ? <p className='text-sm font-semibold text-p1-text'>{round.title}</p> : null}
          <h3 className={`${round.title ? 'mt-0.5' : ''} text-[10px] font-semibold uppercase tracking-wide text-p1-accent`}>
            {checkStatLabel(round.defaultStat)} · DC {round.dc}
            {round.audience === 'private' ? ' · Private' : ''}
          </h3>
          <p className='mt-0.5 text-[11px] text-p1-faint'>
            {combatantLogSummary(round.entries)}
          </p>
        </div>
        <ChevronDown size={14} className={`mt-1 shrink-0 text-p1-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className='overflow-x-auto px-4 pb-3'>
          <table className='w-full min-w-[760px] border-collapse text-xs'>
            <thead className='text-[10px] uppercase text-p1-faint'>
              <tr className='border-b border-p1-border'>
                <th className='px-2 py-2 text-left font-semibold'>Combatant</th>
                <th className='w-24 px-2 py-2 text-left font-semibold'>Side</th>
                <th className='px-2 py-2 text-left font-semibold'>Calculation</th>
                <th className='w-32 px-2 py-2 text-left font-semibold'>Result</th>
                <th className='px-2 py-2 text-left font-semibold'>Notes</th>
              </tr>
            </thead>
            <tbody>
              {round.entries.map((entry, entryIndex) => {
                const rolled = diceEntryWasRolled(entry);
                const clickable = canEdit && rolled;
                return (
                  <tr
                    key={`${round.id ?? round.title}-${entry.combatant_id ?? entry.name}-${entryIndex}`}
                    className={`border-b border-p1-border last:border-0 ${outcomeRowClass(entry.outcome)} ${clickable ? 'cursor-pointer hover:bg-p1-hover' : ''}`}
                    title={clickable ? 'Edit notes' : rolled ? undefined : 'Notes can be added after a roll'}
                    onClick={clickable ? () => onEditNote(entry) : undefined}
                  >
                    <td className='px-2 py-2 font-medium text-p1-text'>{entry.name}</td>
                    <td className='px-2 py-2 text-p1-muted'>{entry.ally ? 'Ally' : 'Enemy'}</td>
                    <td className='px-2 py-2 text-p1-muted'>{entry.calculation}</td>
                    <td className='px-2 py-2 text-p1-text'>{outcomeLabel(entry.outcome) || 'Skipped'}</td>
                    <td
                      className='min-w-[12rem] max-w-[28rem] whitespace-pre-wrap break-words px-2 py-2 align-top text-p1-muted'
                      title={entry.note && entry.note.length > DICE_NOTE_PREVIEW_LIMIT ? entry.note : undefined}
                    >
                      {previewDiceNote(entry.note, clickable)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DiceRollNoteModal({
  round,
  entry,
  onCancel,
  onSave,
}: {
  round: DiceRollLog;
  entry: DiceRollLogEntry;
  onCancel: () => void;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(entry.note ?? '');
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, [onCancel]);
  return createPortal(
    <div
      data-entity-modal
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='dice-roll-note-title'
        className='flex w-full max-w-md flex-col border border-p1-border bg-p1-surface shadow-2xl'
      >
        <header className='flex items-start gap-3 border-b border-p1-border px-4 py-3'>
          <div className='min-w-0 flex-1'>
            <h2 id='dice-roll-note-title' className='text-lg font-semibold'>
              Notes
            </h2>
            <p className='mt-1 text-sm text-p1-muted'>
              {entry.name} · {checkStatLabel(round.defaultStat)} vs DC {round.dc}
            </p>
          </div>
          <button type='button' className='icon-button shrink-0' onClick={onCancel} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='px-4 py-3'>
          <textarea
            autoFocus
            className='h-32 w-full resize-y border border-p1-border bg-p1-inset px-3 py-2 text-sm text-p1-text outline-none focus:border-p1-accent/60'
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder='What happened on this check'
          />
        </div>
        <div className='flex justify-end gap-2 border-t border-p1-border p-4'>
          <button type='button' className='toolbar-button' onClick={onCancel}>Cancel</button>
          <button type='button' className='toolbar-button' onClick={() => onSave(draft)}>Save</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function DiceCheckResultToast({
  log,
  x,
  y,
  onClose,
}: {
  log: DiceRollLog;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const entry = log.entries[0];
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);
  const left = Math.min(x + 12, window.innerWidth - 320);
  const top = Math.min(y + 12, window.innerHeight - 160);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[111]' onMouseDown={onClose} />
      <div
        role='status'
        className={`fixed z-[112] w-72 border border-p1-border bg-p1-surface p-3 shadow-2xl ${outcomeRowClass(entry?.outcome)}`}
        style={{ left, top }}
      >
        {log.title ? <p className='mb-1 text-sm font-semibold text-p1-text'>{log.title}</p> : null}
        <p className='text-[10px] font-semibold uppercase tracking-wide text-p1-accent'>
          {checkStatLabel(log.defaultStat)} · DC {log.dc}
        </p>
        {entry && (
          <div className='mt-2 text-xs'>
            <p className='font-medium text-p1-text'>{entry.name}</p>
            <p className='mt-0.5 text-p1-muted'>{entry.calculation}</p>
            <p className='mt-1 font-semibold text-p1-text'>{outcomeLabel(entry.outcome) || 'Skipped'}</p>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

function LogHeaderContextMenu({ x, y, onClose, onClearAll }: { x: number; y: number; onClose: () => void; onClearAll: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 56);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-48 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onClearAll}>
          <Eraser size={14} /> Clear all dice logs
        </button>
      </div>
    </>,
    document.body
  );
}

function LogEntryContextMenu({ x, y, onClose, onRemove, onClearAll }: { x: number; y: number; onClose: () => void; onRemove?: () => void; onClearAll?: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 88);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-48 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        {onRemove && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onRemove}>
            <Trash2 size={14} /> Clear this check
          </button>
        )}
        {onClearAll && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onClearAll}>
            <Eraser size={14} /> Clear all dice logs
          </button>
        )}
      </div>
    </>,
    document.body
  );
}
