import { Input } from '@components/ui/input';
import { cn } from '@utils/cn';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function OpsField({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      {label && <span className='mb-1 block text-[10px] font-semibold uppercase tracking-wide text-p1-muted'>{label}</span>}
      {children}
    </label>
  );
}

export function OpsSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      className={cn(
        'h-8 border border-p1-border bg-p1-inset px-2 text-sm text-p1-text outline-none focus:border-p1-accent/60',
        className
      )}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder && (
        <option value='' disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function OpsSegmented({
  value,
  onChange,
  options,
  vertical,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  vertical?: boolean;
}) {
  return (
    <div className={cn('inline-flex border border-p1-border', vertical ? 'flex-col' : 'flex-row flex-wrap')}>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          className={cn(
            'px-2 py-1 text-xs',
            value === option.value ? 'bg-p1-accent text-p1-accent-ink' : 'text-p1-muted hover:bg-p1-hover hover:text-p1-text'
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function OpsCombobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  fontMono,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  fontMono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options.slice(0, 80);
    return options.filter((item) => item.toLowerCase().includes(needle)).slice(0, 80);
  }, [options, query]);

  useEffect(() => setQuery(value), [value]);

  return (
    <div className={cn('relative min-w-[12rem]', className)}>
      <Input
        className={fontMono ? 'font-mono' : undefined}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <ul className='absolute z-[80] mt-1 max-h-56 w-full overflow-auto border border-p1-border bg-p1-surface shadow-lg'>
          {filtered.map((item) => (
            <li key={item}>
              <button
                type='button'
                className='block w-full px-2 py-1.5 text-left font-mono text-xs hover:bg-p1-hover'
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(item);
                  setQuery(item);
                  setOpen(false);
                }}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OpsNotice({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(onClose, 2000);
    return () => window.clearTimeout(t);
  }, [onClose]);

  return createPortal(
    <div className='pointer-events-none fixed bottom-4 right-4 z-[200] border border-p1-border bg-p1-surface px-4 py-3 shadow-xl'>
      <p className='text-sm font-semibold'>{title}</p>
      <p className='mt-0.5 text-xs text-p1-muted'>{message}</p>
    </div>,
    document.body
  );
}

export function OpsConfirm({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onCancel]);

  return createPortal(
    <div
      className='fixed inset-0 z-[180] grid place-items-center bg-black/75 p-5'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className='w-full max-w-sm border border-p1-border bg-p1-surface p-5'>
        <h2 className='text-lg font-semibold'>{title}</h2>
        <p className='mt-2 text-sm text-p1-muted'>{message}</p>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onCancel}>
            Cancel
          </button>
          <button type='button' className='toolbar-button' onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function AddOpMenu({
  options,
  onPick,
}: {
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((item) => item.label.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className='relative'>
      <button
        type='button'
        className='inline-flex h-8 min-w-[11.5rem] items-center gap-2 rounded-full border border-p1-border bg-p1-inset px-3 text-sm hover:bg-p1-hover'
        onClick={() => setOpen((value) => !value)}
      >
        <span className='text-p1-accent'>+</span>
        <span className='flex-1 text-left'>+ Add Operation</span>
        <ChevronDown size={14} className='text-p1-muted' />
      </button>
      {open && (
        <div className='absolute right-0 z-[90] mt-1 w-64 border border-p1-border bg-p1-surface shadow-xl'>
          <div className='border-b border-p1-border p-2'>
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search operations'
            />
          </div>
          <ul className='max-h-72 overflow-auto py-1'>
            {filtered.map((item) => (
              <li key={item.value}>
                <button
                  type='button'
                  className='block w-full px-3 py-1.5 text-left text-sm hover:bg-p1-hover'
                  onClick={() => {
                    onPick(item.value);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className='px-3 py-2 text-xs italic text-p1-muted'>No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function HoverHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className='group relative inline-block'>
      <span className='cursor-help text-sm italic text-p1-accent hover:underline'>{label}</span>
      <span className='absolute bottom-full left-0 z-[100] mb-2 hidden w-64 border border-p1-border bg-p1-surface p-3 text-left text-sm font-normal not-italic text-p1-text shadow-lg group-hover:block'>
        {children}
      </span>
    </span>
  );
}

export function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      title={label}
      aria-label={label}
      disabled={disabled}
      className='icon-button disabled:opacity-40'
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export { Input };
export { X };
