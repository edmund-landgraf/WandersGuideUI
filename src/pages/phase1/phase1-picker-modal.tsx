import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isContentStackOpen } from './phase1-content-links';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DEFAULT_BATCH = 12;

export function Phase1PickerModal<T>({
  title,
  titleId,
  searchPlaceholder = 'Search',
  items,
  getName,
  getKey,
  matchesSearch,
  loading,
  error,
  empty,
  onClose,
  renderItem,
  toolbar,
  footer,
  aside,
  listClassName,
  maxWidthClass = 'max-w-md',
  maxHeightClass = 'max-h-[min(82vh,640px)]',
  batchSize = DEFAULT_BATCH,
}: {
  title: string;
  titleId: string;
  searchPlaceholder?: string;
  items: T[];
  getName: (item: T) => string;
  getKey: (item: T) => string;
  matchesSearch?: (item: T, needle: string) => boolean;
  loading?: boolean;
  error?: string | null;
  empty: string;
  onClose: () => void;
  renderItem: (item: T) => ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
  listClassName?: string;
  maxWidthClass?: string;
  maxHeightClass?: string;
  batchSize?: number;
}) {
  const [query, setQuery] = useState('');
  const [letter, setLetter] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    const match = matchesSearch ?? ((item: T, value: string) => getName(item).toLowerCase().includes(value));
    return items.filter((item) => match(item, needle));
  }, [items, query, matchesSearch, getName]);

  const availableLetters = useMemo(
    () => new Set(searched.map((item) => firstLetter(getName(item))).filter((value): value is string => Boolean(value))),
    [searched, getName]
  );

  const options = useMemo(
    () => (letter ? searched.filter((item) => firstLetter(getName(item)) === letter) : searched),
    [searched, letter, getName]
  );
  const visible = options.slice(0, visibleCount);
  const hasMore = visibleCount < options.length;

  useEffect(() => setVisibleCount(batchSize), [query, letter, batchSize, items]);
  useEffect(() => {
    if (letter && !availableLetters.has(letter)) setLetter(null);
  }, [letter, availableLetters]);
  useEffect(() => {
    searchRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isContentStackOpen()) onClose();
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
        if (entries[0]?.isIntersecting) setVisibleCount((count) => count + batchSize);
      },
      { root, rootMargin: '80px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visible.length, batchSize]);

  return createPortal(
    <div
      data-entity-modal
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isContentStackOpen()) onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        className={`flex ${maxHeightClass} w-full ${maxWidthClass} flex-col border border-p1-border bg-p1-surface shadow-2xl`}
      >
        <header className='flex items-center gap-3 border-b border-p1-border px-4 py-3'>
          <h2 id={titleId} className='min-w-0 flex-1 text-lg font-semibold'>
            {title}
          </h2>
          <button type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='border-b border-p1-border p-3 pb-2'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 text-p1-faint' size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className='h-9 w-full border border-p1-border bg-p1-inset pl-9 pr-3 text-sm outline-none placeholder:text-p1-faint focus:border-p1-accent/60'
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
          {toolbar}
        </div>
        <div className={`flex min-h-0 flex-1 ${aside ? 'flex-row' : 'flex-col'}`}>
          <div ref={listRef} className={`min-h-0 flex-1 overflow-y-auto ${aside ? 'border-r border-p1-border md:max-w-md' : ''}`}>
            {loading && <p className='px-4 py-8 text-center text-sm text-p1-muted'>Loading...</p>}
            {error && <p className='px-4 py-8 text-center text-sm text-p1-danger-soft'>{error}</p>}
            {!loading && !error && visible.length === 0 && <p className='px-4 py-8 text-center text-sm text-p1-muted'>{empty}</p>}
            {!loading && !error && visible.length > 0 && (
              <div className={listClassName}>
                {visible.map((item) => (
                  <div key={getKey(item)}>{renderItem(item)}</div>
                ))}
              </div>
            )}
            {hasMore && <div ref={sentinelRef} className='h-4' />}
          </div>
          {aside && <div className='min-h-0 min-w-0 flex-1 overflow-y-auto'>{aside}</div>}
        </div>
        {footer}
      </section>
    </div>,
    document.body
  );
}

function firstLetter(name: string) {
  const match = name.trim().match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : null;
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
        active
          ? 'bg-p1-accent text-p1-accent-ink'
          : 'text-p1-muted hover:bg-p1-hover hover:text-p1-text disabled:text-p1-faint disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  );
}
