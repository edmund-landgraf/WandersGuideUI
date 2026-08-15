import { getAllConditions } from '@conditions/condition-handler';
import type { Condition } from '@schemas/content';
import { Minus, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProseMarkdown } from './phase1-markdown';
import { Phase1PickerModal } from './phase1-picker-modal';

function ChangeNoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className='block border-t border-p1-border px-4 py-3'>
      <span className='mb-1.5 block text-[10px] uppercase text-p1-faint'>Why (optional)</span>
      <input
        className='h-8 w-full border border-p1-border bg-p1-page px-2 text-xs text-p1-text outline-none placeholder:text-p1-faint focus:border-p1-border'
        placeholder='Reason for this change'
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function SelectConditionModal({
  current,
  onSelect,
  onClose,
}: {
  current: Condition[];
  onSelect: (condition: Condition, note?: string | null) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const items = useMemo(() => {
    const taken = new Set(current.map((item) => item.name));
    return getAllConditions().filter((item) => item.for_creature && !taken.has(item.name));
  }, [current]);

  return (
    <Phase1PickerModal
      title='Select a Condition'
      titleId='select-condition-title'
      searchPlaceholder='Search options'
      items={items}
      getName={(item) => item.name}
      getKey={(item) => item.name}
      matchesSearch={(item, needle) =>
        item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)
      }
      empty='No matching conditions.'
      onClose={onClose}
      footer={<ChangeNoteField value={note} onChange={setNote} />}
      renderItem={(condition) => (
        <button
          type='button'
          className='flex w-full items-center border-b border-p1-border px-4 py-3 text-left text-sm text-p1-text hover:bg-p1-hover'
          onClick={() => onSelect(condition, note.trim() || null)}
        >
          {condition.name}
        </button>
      )}
    />
  );
}

export function ConditionDetailModal({
  condition,
  canManage,
  onValueChange,
  onRemove,
  onClose,
}: {
  condition: Condition;
  canManage: boolean;
  onValueChange?: (value: number, note?: string | null) => void;
  onRemove?: (note?: string | null) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState('');
  const value = condition.value ?? 0;
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      data-entity-modal
      className='fixed inset-0 z-[110] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='condition-detail-title'
        className='flex max-h-[min(82vh,640px)] w-full max-w-lg flex-col border border-p1-border bg-p1-surface shadow-2xl'
      >
        <header className='flex items-start gap-3 border-b border-p1-border px-4 py-3'>
          <div className='min-w-0 flex-1'>
            <h2 id='condition-detail-title' className='text-lg font-semibold'>
              {condition.name}
            </h2>
            {condition.source && <p className='mt-1 text-xs italic text-p1-muted'>From: {condition.source}</p>}
          </div>
          {canManage && onRemove && (
            <button type='button' className='toolbar-button shrink-0' onClick={() => onRemove(note.trim() || null)}>
              Remove
            </button>
          )}
          <button ref={closeRef} type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
          <ProseMarkdown>{condition.description}</ProseMarkdown>
        </div>
        {canManage && condition.value !== undefined && onValueChange && (
          <div className='flex items-center justify-center gap-3 border-t border-p1-border px-4 py-3'>
            <button
              type='button'
              className='icon-button'
              aria-label='Decrease value'
              disabled={value <= 1}
              onClick={() => onValueChange(value - 1, note.trim() || null)}
            >
              <Minus size={16} />
            </button>
            <span className='grid h-9 w-12 place-items-center border border-p1-border bg-p1-hover text-sm font-semibold'>
              {value}
            </span>
            <button
              type='button'
              className='icon-button'
              aria-label='Increase value'
              disabled={value >= 9}
              onClick={() => onValueChange(value + 1, note.trim() || null)}
            >
              <Plus size={16} />
            </button>
          </div>
        )}
        {canManage && (onValueChange || onRemove) ? <ChangeNoteField value={note} onChange={setNote} /> : null}
      </section>
    </div>,
    document.body
  );
}
