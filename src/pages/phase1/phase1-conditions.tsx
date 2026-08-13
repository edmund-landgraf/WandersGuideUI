import { getAllConditions } from '@conditions/condition-handler';
import type { Condition } from '@schemas/content';
import { Minus, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProseMarkdown } from './phase1-markdown';

const BATCH_SIZE = 12;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function SelectConditionModal({
  current,
  onSelect,
  onClose,
}: {
  current: Condition[];
  onSelect: (condition: Condition) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [letter, setLetter] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searched = useMemo(() => {
    const taken = new Set(current.map((item) => item.name));
    const needle = query.trim().toLowerCase();
    return getAllConditions()
      .filter((item) => item.for_creature && !taken.has(item.name))
      .filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle));
  }, [current, query]);
  const availableLetters = useMemo(() => new Set(searched.map((item) => item.name[0]?.toUpperCase())), [searched]);
  const options = useMemo(
    () => (letter ? searched.filter((item) => item.name[0]?.toUpperCase() === letter) : searched),
    [searched, letter]
  );
  const visible = options.slice(0, visibleCount);
  const hasMore = visibleCount < options.length;

  useEffect(() => setVisibleCount(BATCH_SIZE), [query, letter]);
  useEffect(() => {
    searchRef.current?.focus();
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
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = listRef.current;
    if (!sentinel || !root || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((count) => count + BATCH_SIZE);
      },
      { root, rootMargin: '80px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visible.length]);

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
        aria-labelledby='select-condition-title'
        className='flex max-h-[min(82vh,640px)] w-full max-w-md flex-col border border-white/15 bg-[#11171a] shadow-2xl'
      >
        <header className='flex items-center gap-3 border-b border-white/10 px-4 py-3'>
          <h2 id='select-condition-title' className='min-w-0 flex-1 text-lg font-semibold'>
            Select a Condition
          </h2>
          <button type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='border-b border-white/10 p-3 pb-2'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 text-[#68747a]' size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search options'
              className='h-9 w-full border border-white/10 bg-[#0d1215] pl-9 pr-3 text-sm outline-none placeholder:text-[#5f6a70] focus:border-[#d6a85f]/60'
            />
          </div>
          <div className='mt-2 flex flex-wrap justify-center gap-0.5' role='group' aria-label='Filter by first letter'>
            <LetterButton active={!letter} onClick={() => setLetter(null)}>
              All
            </LetterButton>
            {LETTERS.map((item) => (
              <LetterButton
                key={item}
                active={letter === item}
                disabled={!availableLetters.has(item)}
                onClick={() => setLetter(letter === item ? null : item)}
              >
                {item}
              </LetterButton>
            ))}
          </div>
        </div>
        <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto'>
          {visible.length === 0 && <p className='px-4 py-8 text-center text-sm text-[#7f8a90]'>No matching conditions.</p>}
          {visible.map((condition) => (
            <button
              key={condition.name}
              type='button'
              className='flex w-full items-center border-b border-white/[0.07] px-4 py-3 text-left text-sm text-[#e7ebed] hover:bg-white/[0.04]'
              onClick={() => onSelect(condition)}
            >
              {condition.name}
            </button>
          ))}
          {hasMore && <div ref={sentinelRef} className='h-4' />}
        </div>
      </section>
    </div>,
    document.body
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
  onValueChange?: (value: number) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
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
        className='flex max-h-[min(82vh,640px)] w-full max-w-lg flex-col border border-white/15 bg-[#11171a] shadow-2xl'
      >
        <header className='flex items-start gap-3 border-b border-white/10 px-4 py-3'>
          <div className='min-w-0 flex-1'>
            <h2 id='condition-detail-title' className='text-lg font-semibold'>
              {condition.name}
            </h2>
            {condition.source && <p className='mt-1 text-xs italic text-[#89949a]'>From: {condition.source}</p>}
          </div>
          {canManage && onRemove && (
            <button type='button' className='toolbar-button shrink-0' onClick={onRemove}>
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
          <div className='flex items-center justify-center gap-3 border-t border-white/10 px-4 py-3'>
            <button
              type='button'
              className='icon-button'
              aria-label='Decrease value'
              disabled={value <= 1}
              onClick={() => onValueChange(value - 1)}
            >
              <Minus size={16} />
            </button>
            <span className='grid h-9 w-12 place-items-center border border-white/10 bg-white/[0.04] text-sm font-semibold'>
              {value}
            </span>
            <button
              type='button'
              className='icon-button'
              aria-label='Increase value'
              disabled={value >= 9}
              onClick={() => onValueChange(value + 1)}
            >
              <Plus size={16} />
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}

function LetterButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-6 min-w-6 place-items-center px-1 text-[10px] font-semibold ${
        active ? 'bg-[#d6a85f] text-[#17130d]' : 'text-[#aeb7bc] hover:bg-white/[0.08] hover:text-white disabled:text-[#3d484e] disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  );
}
