import type { CombatantChangeLogEntry } from '@schemas/content';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatChangeLogField, formatChangeLogTime, formatChangeLogValue } from './phase1-change-log';

export function CombatantChangeLogFooter({ entries }: { entries: CombatantChangeLogEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const ordered = [...entries].reverse();

  return (
    <section className='shrink-0 border-t border-white/10 bg-[#0a0e10]'>
      <button
        type='button'
        className='flex w-full items-center gap-2 px-4 py-2.5 text-left text-[11px] text-[#aeb7bc] hover:bg-white/[0.03] hover:text-[#dce1e3]'
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <History size={14} className='shrink-0 text-[#68747a]' />
        <span className='font-medium'>Change log</span>
        {entries.length > 0 ? (
          <span className='rounded-full border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-[#c4cbce]'>
            {entries.length}
          </span>
        ) : null}
        <span className='ml-auto text-[#68747a]'>
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>
      {expanded && (
        <div className='max-h-44 overflow-y-auto border-t border-white/[0.07] px-4 py-2'>
          {ordered.length === 0 ? (
            <p className='py-2 text-center text-[10px] italic text-[#68747a]'>No status changes.</p>
          ) : (
            <ul className='space-y-2'>
              {ordered.map((entry) => (
                <li key={entry.id} className='border border-white/[0.07] bg-[#11171a] px-2.5 py-2 text-[10px] leading-5 text-[#c4cbce]'>
                  <div className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
                    <span className='text-[#68747a]'>{formatChangeLogTime(entry.at)}</span>
                    <span className='font-semibold text-[#dce1e3]'>{formatChangeLogField(entry.field)}</span>
                    <span>
                      {formatChangeLogValue(entry.field, entry.from)}
                      <span className='px-1 text-[#59656b]'>→</span>
                      {formatChangeLogValue(entry.field, entry.to)}
                    </span>
                  </div>
                  {entry.note ? <p className='mt-1 italic text-[#89949a]'>“{entry.note}”</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function EditableValueWithNote({
  label,
  displayValue,
  editValue,
  canEdit,
  accentClass,
  onCommit,
}: {
  label: string;
  displayValue: ReactNode;
  editValue: string;
  canEdit: boolean;
  accentClass?: string;
  onCommit: (value: string, note: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(editValue);
  const [note, setNote] = useState('');

  function startEditing() {
    if (!canEdit) return;
    setValue(editValue);
    setNote('');
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    onCommit(value, note.trim() || null);
  }

  if (!editing) {
    return (
      <button
        type='button'
        disabled={!canEdit}
        className={`text-center disabled:cursor-default ${canEdit ? 'hover:bg-white/[0.03]' : ''}`}
        onClick={startEditing}
      >
        <div className='text-[10px] uppercase text-[#68747a]'>{label}</div>
        <div className={`mt-1 text-lg font-semibold leading-none ${accentClass ?? 'text-[#dce1e3]'}`}>{displayValue}</div>
      </button>
    );
  }

  return (
    <div className='space-y-1.5 px-1 py-1 text-left'>
      <div className='text-[10px] uppercase text-[#68747a]'>{label}</div>
      <input
        autoFocus
        className='h-8 w-full border border-white/15 bg-[#0d1114] px-2 text-center text-sm text-[#dce1e3] outline-none focus:border-[#d6a85f]/60'
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(false);
        }}
        onBlur={commit}
      />
      <input
        className='h-7 w-full border border-white/10 bg-[#0d1114] px-2 text-[10px] text-[#aeb7bc] outline-none placeholder:text-[#59656b] focus:border-white/20'
        placeholder='Why (optional)'
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    </div>
  );
}

export function GridHpEditPopover({
  combatantName,
  currentHp,
  maxHp,
  anchorRect,
  onCommit,
  onClose,
}: {
  combatantName: string;
  currentHp: number;
  maxHp: number;
  anchorRect: DOMRect;
  onCommit: (value: string, note: string | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(String(currentHp));
  const [note, setNote] = useState('');

  function commit() {
    onCommit(value, note.trim() || null);
    onClose();
  }

  return createPortal(
    <>
      <button type='button' className='fixed inset-0 z-[120]' aria-label='Close HP editor' onClick={onClose} />
      <div
        className='fixed z-[121] w-52 border border-white/15 bg-[#11171a] p-3 shadow-2xl'
        style={{
          left: Math.min(anchorRect.left, window.innerWidth - 220),
          top: anchorRect.bottom + 6,
        }}
        role='dialog'
        aria-label={`Edit ${combatantName} hit points`}
      >
        <div className='mb-2 text-[10px] uppercase text-[#68747a]'>Hit points / {maxHp}</div>
        <input
          autoFocus
          className='h-9 w-full border border-white/15 bg-[#0d1114] px-2 text-center text-sm text-[#dce1e3] outline-none focus:border-[#d6a85f]/60'
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') onClose();
          }}
        />
        <input
          className='mt-2 h-8 w-full border border-white/10 bg-[#0d1114] px-2 text-[10px] text-[#aeb7bc] outline-none placeholder:text-[#59656b] focus:border-white/20'
          placeholder='Why (optional)'
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') onClose();
          }}
        />
        <div className='mt-2 flex justify-end gap-2'>
          <button type='button' className='px-2 py-1 text-[10px] text-[#89949a] hover:text-[#dce1e3]' onClick={onClose}>
            Cancel
          </button>
          <button type='button' className='border border-[#d6a85f]/40 bg-[#d6a85f]/10 px-2 py-1 text-[10px] font-medium text-[#f0d29d] hover:bg-[#d6a85f]/20' onClick={commit}>
            Save
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
