import { fetchContentAll, fetchContentSources } from '@content/content-store';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ancestry, Class } from '@schemas/content';

export type Phase1RandomCharacterPicks = {
  class?: string;
  ancestry?: string;
  level: number;
};

export function Phase1RandomCharacterModal(props: {
  onClose: () => void;
  onConfirm: (picks: Phase1RandomCharacterPicks) => void;
  generating?: boolean;
}) {
  const [className, setClassName] = useState('');
  const [ancestryName, setAncestryName] = useState('');
  const [level, setLevel] = useState(1);
  const [classes, setClasses] = useState<{ value: string; label: string }[]>([]);
  const [ancestries, setAncestries] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sources = await fetchContentSources('ALL-OFFICIAL-PUBLIC');
        const sourceIds = sources.map((s) => s.id);
        const [classList, ancestryList] = await Promise.all([
          fetchContentAll<Class>('class', sourceIds),
          fetchContentAll<Ancestry>('ancestry', sourceIds),
        ]);
        const sortByName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
        if (cancelled) return;
        setClasses([...classList].sort(sortByName).map((c) => ({ value: c.name, label: c.name })));
        setAncestries([...ancestryList].sort(sortByName).map((a) => ({ value: a.name, label: a.name })));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.generating) props.onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [props]);

  return createPortal(
    <div
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !props.generating) props.onClose();
      }}
    >
      <section className='w-full max-w-md border border-p1-border bg-p1-surface p-5' role='dialog' aria-modal='true' aria-labelledby='random-character-title'>
        <div className='flex items-start justify-between gap-3'>
          <h2 id='random-character-title' className='text-lg font-semibold'>
            Random character
          </h2>
          <button type='button' className='icon-button shrink-0' onClick={props.onClose} disabled={props.generating} title='Close'>
            <X size={18} />
          </button>
        </div>
        <p className='mt-2 text-sm text-p1-muted'>
          Pick ancestry, class, and level. Leave ancestry or class empty to randomize. Heritage, background, and feats
          are filled automatically.
        </p>
        <label className='mt-4 block text-xs text-p1-muted'>
          Ancestry
          <select
            className='settings-input mt-1 h-9 w-full'
            value={ancestryName}
            disabled={loading || props.generating}
            onChange={(event) => setAncestryName(event.target.value)}
          >
            <option value=''>Random</option>
            {ancestries.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className='mt-3 block text-xs text-p1-muted'>
          Class
          <select
            className='settings-input mt-1 h-9 w-full'
            value={className}
            disabled={loading || props.generating}
            onChange={(event) => setClassName(event.target.value)}
          >
            <option value=''>Random</option>
            {classes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className='mt-3 block text-xs text-p1-muted'>
          Level
          <input
            className='settings-input mt-1 h-9 w-full'
            type='number'
            min={1}
            max={20}
            value={level}
            disabled={props.generating}
            onChange={(event) => {
              const n = Number.parseInt(event.target.value, 10);
              setLevel(Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 1);
            }}
          />
        </label>
        <div className='mt-4 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' disabled={props.generating} onClick={props.onClose}>
            Cancel
          </button>
          <button
            type='button'
            className='toolbar-button'
            disabled={props.generating}
            style={{ background: 'var(--p1-accent)', color: 'var(--p1-accent-ink)', borderColor: 'var(--p1-accent)' }}
            onClick={() =>
              props.onConfirm({
                class: className || undefined,
                ancestry: ancestryName || undefined,
                level,
              })
            }
          >
            {props.generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
