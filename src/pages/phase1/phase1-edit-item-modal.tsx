import type { Item, ItemGroup } from '@schemas/content';
import { cloneDeep } from 'lodash-es';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isContentStackOpen } from './phase1-content-links';

const GROUPS: ItemGroup[] = ['GENERAL', 'ARMOR', 'SHIELD', 'WEAPON', 'RUNE', 'UPGRADE', 'MATERIAL'];
const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'] as const;
const SIZES = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN'] as const;
const HANDS = ['', '1', '1+', '2', '2+', '1 or 2'];
const DICE = ['', 'd2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];

export function Phase1EditItemModal({
  item,
  onSave,
  onClose,
}: {
  item: Item;
  onSave: (next: Item) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(() => cloneDeep(item));

  useEffect(() => {
    closeRef.current?.focus();
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

  function patch(next: Partial<Item>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function patchMeta(next: Partial<NonNullable<Item['meta_data']>>) {
    setDraft((current) => ({
      ...current,
      meta_data: {
        bulk: current.meta_data?.bulk ?? {},
        ...current.meta_data,
        ...next,
      },
    }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    onSave({
      ...draft,
      name,
      level: Number(draft.level) || 0,
      bulk: draft.bulk === '' ? null : draft.bulk,
      hands: draft.hands || null,
      usage: draft.usage || null,
      price: {
        cp: num(draft.price?.cp),
        sp: num(draft.price?.sp),
        gp: num(draft.price?.gp),
        pp: num(draft.price?.pp),
      },
    });
  }

  const meta = draft.meta_data;
  const damage = meta?.damage ?? {};
  const runes = meta?.runes ?? {};
  const charges = meta?.charges ?? {};

  return createPortal(
    <div
      data-entity-modal
      className='fixed inset-0 z-[200] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isContentStackOpen()) onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='edit-item-title'
        className='flex max-h-[min(88vh,860px)] w-full max-w-2xl flex-col border border-p1-border bg-p1-surface shadow-2xl'
      >
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <h2 id='edit-item-title' className='min-w-0 flex-1 text-xl font-semibold'>
            Edit item
          </h2>
          <button ref={closeRef} type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <form className='flex min-h-0 flex-1 flex-col' onSubmit={submit}>
          <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4'>
            <div className='grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3'>
              <Field label='Name'>
                <input
                  required
                  className='settings-input'
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </Field>
              <Field label='Level'>
                <input
                  className='settings-input'
                  type='number'
                  min={0}
                  max={30}
                  value={draft.level}
                  onChange={(event) => patch({ level: Number(event.target.value) || 0 })}
                />
              </Field>
            </div>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              <Field label='Rarity'>
                <select className='settings-input' value={draft.rarity} onChange={(event) => patch({ rarity: event.target.value as Item['rarity'] })}>
                  {RARITIES.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label='Group'>
                <select className='settings-input' value={draft.group} onChange={(event) => patch({ group: event.target.value as ItemGroup })}>
                  {GROUPS.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label='Size'>
                <select className='settings-input' value={draft.size} onChange={(event) => patch({ size: event.target.value as Item['size'] })}>
                  {SIZES.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label='Quantity'>
                <input
                  className='settings-input'
                  type='number'
                  min={0}
                  value={meta?.quantity ?? 1}
                  onChange={(event) => patchMeta({ quantity: Number(event.target.value) || 0 })}
                />
              </Field>
            </div>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              <CoinField label='PP' value={draft.price?.pp} onChange={(value) => patch({ price: { ...draft.price, pp: value } })} />
              <CoinField label='GP' value={draft.price?.gp} onChange={(value) => patch({ price: { ...draft.price, gp: value } })} />
              <CoinField label='SP' value={draft.price?.sp} onChange={(value) => patch({ price: { ...draft.price, sp: value } })} />
              <CoinField label='CP' value={draft.price?.cp} onChange={(value) => patch({ price: { ...draft.price, cp: value } })} />
            </div>
            <div className='grid grid-cols-3 gap-3'>
              <Field label='Bulk'>
                <input className='settings-input' value={draft.bulk ?? ''} onChange={(event) => patch({ bulk: event.target.value || null })} />
              </Field>
              <Field label='Hands'>
                <select className='settings-input' value={draft.hands ?? ''} onChange={(event) => patch({ hands: event.target.value || null })}>
                  {HANDS.map((value) => (
                    <option key={value || 'none'} value={value}>
                      {value || '—'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label='Usage'>
                <input className='settings-input' value={draft.usage ?? ''} onChange={(event) => patch({ usage: event.target.value })} />
              </Field>
            </div>
            <Field label='Description'>
              <textarea
                rows={6}
                className='settings-input min-h-[8rem] resize-y'
                value={draft.description}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </Field>
            <Section title='Weapon'>
              <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <Field label='Dice'>
                  <input
                    className='settings-input'
                    type='number'
                    min={0}
                    value={damage.dice ?? ''}
                    onChange={(event) => patchMeta({ damage: { ...damage, dice: event.target.value === '' ? undefined : Number(event.target.value) } })}
                  />
                </Field>
                <Field label='Die'>
                  <select
                    className='settings-input'
                    value={damage.die ?? ''}
                    onChange={(event) => patchMeta({ damage: { ...damage, die: event.target.value || null } })}
                  >
                    {DICE.map((value) => (
                      <option key={value || 'none'} value={value}>
                        {value || '—'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label='Type'>
                  <input
                    className='settings-input'
                    placeholder='slashing'
                    value={damage.damageType ?? ''}
                    onChange={(event) => patchMeta({ damage: { ...damage, damageType: event.target.value } })}
                  />
                </Field>
                <Field label='Extra'>
                  <input
                    className='settings-input'
                    value={damage.extra ?? ''}
                    onChange={(event) => patchMeta({ damage: { ...damage, extra: event.target.value } })}
                  />
                </Field>
              </div>
              <div className='grid grid-cols-3 gap-3'>
                <Field label='Range'>
                  <input
                    className='settings-input'
                    type='number'
                    min={0}
                    value={meta?.range ?? ''}
                    onChange={(event) => patchMeta({ range: event.target.value === '' ? null : Number(event.target.value) })}
                  />
                </Field>
                <Field label='Reload'>
                  <input className='settings-input' value={meta?.reload ?? ''} onChange={(event) => patchMeta({ reload: event.target.value || null })} />
                </Field>
                <Field label='Attack bonus'>
                  <input
                    className='settings-input'
                    type='number'
                    value={meta?.attack_bonus ?? ''}
                    onChange={(event) => patchMeta({ attack_bonus: event.target.value === '' ? null : Number(event.target.value) })}
                  />
                </Field>
              </div>
            </Section>
            <Section title='Armor'>
              <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
                <NumField label='AC bonus' value={meta?.ac_bonus} onChange={(value) => patchMeta({ ac_bonus: value })} />
                <NumField label='Check penalty' value={meta?.check_penalty} onChange={(value) => patchMeta({ check_penalty: value })} />
                <NumField label='Speed penalty' value={meta?.speed_penalty} onChange={(value) => patchMeta({ speed_penalty: value })} />
                <NumField label='Dex cap' value={meta?.dex_cap} onChange={(value) => patchMeta({ dex_cap: value })} />
                <NumField label='Strength' value={meta?.strength} onChange={(value) => patchMeta({ strength: value })} />
              </div>
            </Section>
            <Section title='Runes'>
              <div className='grid grid-cols-3 gap-3'>
                <NumField label='Potency' value={runes.potency} onChange={(value) => patchMeta({ runes: { ...runes, potency: value } })} />
                <NumField label='Striking' value={runes.striking} onChange={(value) => patchMeta({ runes: { ...runes, striking: value } })} />
                <NumField label='Resilient' value={runes.resilient} onChange={(value) => patchMeta({ runes: { ...runes, resilient: value } })} />
              </div>
            </Section>
            <Section title='Item HP'>
              <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <NumField label='Hardness' value={meta?.hardness} onChange={(value) => patchMeta({ hardness: value })} />
                <NumField label='HP' value={meta?.hp} onChange={(value) => patchMeta({ hp: value })} />
                <NumField label='Max HP' value={meta?.hp_max} onChange={(value) => patchMeta({ hp_max: value })} />
                <NumField label='Broken' value={meta?.broken_threshold} onChange={(value) => patchMeta({ broken_threshold: value })} />
              </div>
            </Section>
            <Section title='Charges'>
              <div className='grid grid-cols-2 gap-3'>
                <NumField label='Current' value={charges.current} onChange={(value) => patchMeta({ charges: { ...charges, current: value } })} />
                <NumField label='Max' value={charges.max} onChange={(value) => patchMeta({ charges: { ...charges, max: value } })} />
              </div>
            </Section>
            <div className='flex flex-wrap gap-4 text-sm'>
              <label className='flex items-center gap-2'>
                <input type='checkbox' checked={Boolean(meta?.is_shoddy)} onChange={(event) => patchMeta({ is_shoddy: event.target.checked })} />
                Shoddy
              </label>
              <label className='flex items-center gap-2'>
                <input type='checkbox' checked={Boolean(meta?.unselectable)} onChange={(event) => patchMeta({ unselectable: event.target.checked })} />
                Unselectable
              </label>
            </div>
          </div>
          <footer className='flex justify-end gap-2 border-t border-p1-border px-5 py-3'>
            <button type='button' className='toolbar-button' onClick={onClose}>
              Cancel
            </button>
            <button type='submit' className='toolbar-button'>
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='block min-w-0'>
      <span className='mb-1 block text-[10px] font-semibold uppercase tracking-wide text-p1-muted'>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className='space-y-3 border-t border-p1-border pt-3'>
      <h3 className='text-[11px] font-semibold uppercase tracking-wide text-p1-muted'>{title}</h3>
      {children}
    </div>
  );
}

function CoinField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number | string;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Field label={label}>
      <input
        className='settings-input'
        type='number'
        min={0}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </Field>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number | string | null;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Field label={label}>
      <input
        className='settings-input'
        type='number'
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </Field>
  );
}

function num(value: number | string | undefined) {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
