import type { Character } from '@schemas/content';
import { rollDie } from '@utils/random';
import { Dices, X } from 'lucide-react';
import { useState } from 'react';

const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const;

type RollEntry = NonNullable<Character['roll_history']>['rolls'][number];

export function Phase1DiceButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type='button' className='toolbar-button' onClick={onOpen} title='Dice roller'>
      <Dices size={14} /> Dice
    </button>
  );
}

export function Phase1DiceModal({
  character,
  canEdit = false,
  hint = '2d rolls stay on this sheet. 3D dice remain on the original sheet.',
  onClose,
  onSaveHistory,
}: {
  character?: Character | null;
  canEdit?: boolean;
  hint?: string;
  onClose: () => void;
  onSaveHistory?: (rolls: RollEntry[]) => void;
}) {
  const [count, setCount] = useState(1);
  const [die, setDie] = useState<(typeof DIE_TYPES)[number]>('d20');
  const [bonus, setBonus] = useState(0);
  const [label, setLabel] = useState('');
  const [history, setHistory] = useState<RollEntry[]>(() => [...(character?.roll_history?.rolls ?? [])].reverse());

  const latest = history[0];
  const latestTotal = latest ? latest.result + latest.bonus : null;

  function roll() {
    const n = Math.max(1, Math.min(20, count));
    const results: number[] = [];
    for (let i = 0; i < n; i += 1) results.push(rollDie(die));
    const sum = results.reduce((a, b) => a + b, 0);
    const entry: RollEntry = {
      type: `${n}${die}`,
      label: label.trim() || `${n}${die}`,
      result: sum,
      bonus,
      timestamp: Date.now(),
    };
    const next = [entry, ...history].slice(0, 80);
    setHistory(next);
    if (canEdit) onSaveHistory?.([...next].reverse());
  }

  return (
    <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className='w-full max-w-md border border-p1-border bg-p1-surface p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <h2 className='text-lg font-semibold'>Dice roller</h2>
            <p className='mt-1 text-xs text-p1-muted'>{hint}</p>
          </div>
          <button type='button' className='icon-button' title='Close' onClick={onClose}><X size={16} /></button>
        </div>

        {latest && latestTotal != null && (
          <p className='mt-4 border border-p1-border bg-p1-inset px-3 py-3 text-center'>
            <span className='block text-xs text-p1-muted'>{latest.label}</span>
            <span className='text-lg font-semibold text-p1-accent-soft'>{latestTotal}</span>
            <span className='mt-1 block text-xs text-p1-faint'>{latest.type}{latest.bonus ? (latest.bonus > 0 ? `+${latest.bonus}` : String(latest.bonus)) : ''}</span>
          </p>
        )}

        <div className='mt-4 flex flex-wrap gap-1'>
          {DIE_TYPES.map((item) => (
            <button
              key={item}
              type='button'
              className={`toolbar-button ${die === item ? 'border-p1-accent text-p1-accent-soft' : ''}`}
              onClick={() => setDie(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className='mt-3 grid grid-cols-3 gap-2'>
          <label className='text-xs text-p1-muted'>
            Count
            <input className='mt-1 h-8 w-full border border-p1-border bg-p1-page px-2 text-sm text-p1-text outline-none' type='number' min={1} max={20} value={count} onChange={(event) => setCount(Number(event.target.value) || 1)} />
          </label>
          <label className='text-xs text-p1-muted'>
            Bonus
            <input className='mt-1 h-8 w-full border border-p1-border bg-p1-page px-2 text-sm text-p1-text outline-none' type='number' value={bonus} onChange={(event) => setBonus(Number(event.target.value) || 0)} />
          </label>
          <label className='text-xs text-p1-muted'>
            Label
            <input className='mt-1 h-8 w-full border border-p1-border bg-p1-page px-2 text-sm text-p1-text outline-none' value={label} onChange={(event) => setLabel(event.target.value)} placeholder='Strike' />
          </label>
        </div>

        <button type='button' className='toolbar-button mt-4 w-full justify-center text-p1-accent-ink' style={{ background: 'var(--p1-accent)', color: 'var(--p1-accent-ink)', borderColor: 'var(--p1-accent)' }} onClick={roll}>
          Roll {count}{die}{bonus ? (bonus > 0 ? `+${bonus}` : String(bonus)) : ''}
        </button>

        {history.length > 0 && (
          <ol className='mt-4 max-h-48 space-y-1 overflow-auto text-xs text-p1-muted'>
            {history.map((entry) => (
              <li key={`${entry.timestamp}-${entry.type}-${entry.result}`} className='flex justify-between gap-3 border-b border-p1-border py-1'>
                <span className='truncate'>{entry.label}</span>
                <span className='shrink-0 text-p1-text'>{entry.type} {entry.result + entry.bonus}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
