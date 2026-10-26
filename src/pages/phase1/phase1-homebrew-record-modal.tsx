import type { AbilityBlockType, ContentType } from '@schemas/content';
import { cloneDeep } from 'lodash-es';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isContentStackOpen } from './phase1-content-links';

const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'];

type Section = { label: string; kind?: string; contentType: ContentType; abilityBlockType?: AbilityBlockType };

export function Phase1HomebrewRecordModal({
  section,
  sourceId,
  record,
  onSave,
  onClose,
}: {
  section: Section;
  sourceId: number;
  record: Record<string, unknown> | null;
  onSave: (next: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => cloneDeep(record ?? blankRecord(section, sourceId)));

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

  function set(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = String(draft.name ?? '').trim();
    if (!name) return;
    onSave({ ...draft, name, content_source_id: sourceId });
  }

  const creating = record == null;
  const noun = section.kind ?? section.label.replace(/s$/, '');
  const details = (draft.details as { description?: string } | null) ?? null;

  return createPortal(
    <div className='fixed inset-0 z-[200] grid place-items-center bg-black/75 p-5' role='presentation' onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role='dialog' aria-modal='true' aria-labelledby='homebrew-record-title' className='flex max-h-[min(88vh,860px)] w-full max-w-2xl flex-col border border-p1-border bg-p1-surface shadow-2xl'>
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <h2 id='homebrew-record-title' className='min-w-0 flex-1 text-xl font-semibold'>
            {creating ? `Create ${noun}` : `Edit ${noun}`}
          </h2>
          <button ref={closeRef} type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <form className='flex min-h-0 flex-1 flex-col' onSubmit={submit}>
          <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4'>
            <Field label='Name'>
              <input required className='settings-input' value={String(draft.name ?? '')} onChange={(event) => set('name', event.target.value)} />
            </Field>
            {'level' in draft && (
              <Field label='Level'>
                <input className='settings-input' type='number' value={Number(draft.level ?? 0)} onChange={(event) => set('level', Number(event.target.value) || 0)} />
              </Field>
            )}
            {'rank' in draft && (
              <Field label='Rank'>
                <input className='settings-input' type='number' min={0} value={Number(draft.rank ?? 0)} onChange={(event) => set('rank', Number(event.target.value) || 0)} />
              </Field>
            )}
            {'rarity' in draft && (
              <Field label='Rarity'>
                <select className='settings-input' value={String(draft.rarity ?? 'COMMON')} onChange={(event) => set('rarity', event.target.value)}>
                  {RARITIES.map((value) => (
                    <option key={value} value={value}>{value[0] + value.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </Field>
            )}
            {'traditions' in draft && (
              <Field label='Traditions'>
                <input className='settings-input' value={Array.isArray(draft.traditions) ? draft.traditions.join(', ') : ''} onChange={(event) => set('traditions', event.target.value.split(',').map((part) => part.trim()).filter(Boolean))} />
              </Field>
            )}
            {(['actions', 'cast', 'frequency', 'requirements', 'cost', 'trigger', 'range', 'area', 'duration', 'speakers', 'script', 'special', 'access'] as const)
              .filter((key) => key in draft)
              .map((key) => (
                <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
                  <input className='settings-input' value={draft[key] == null ? '' : String(draft[key])} onChange={(event) => set(key, event.target.value || null)} />
                </Field>
              ))}
            {(['trait_id', 'class_id', 'heritage_id', 'dedication_feat_id'] as const)
              .filter((key) => key in draft)
              .map((key) => (
                <Field key={key} label={key.replaceAll('_', ' ')}>
                  <input className='settings-input' type='number' value={draft[key] == null ? '' : Number(draft[key])} onChange={(event) => set(key, event.target.value === '' ? null : Number(event.target.value))} />
                </Field>
              ))}
            {'artwork_url' in draft && (
              <Field label='Image URL'>
                <input className='settings-input' placeholder='https://…' value={String(draft.artwork_url ?? '')} onChange={(event) => set('artwork_url', event.target.value)} />
              </Field>
            )}
            {details ? (
              <Field label='Description'>
                <textarea className='settings-input min-h-40' value={details.description ?? ''} onChange={(event) => set('details', { ...details, description: event.target.value })} />
              </Field>
            ) : (
              'description' in draft && (
                <Field label='Description'>
                  <textarea className='settings-input min-h-40' value={String(draft.description ?? '')} onChange={(event) => set('description', event.target.value)} />
                </Field>
              )
            )}
          </div>
          <footer className='flex justify-end gap-2 border-t border-p1-border px-5 py-3'>
            <button type='button' className='toolbar-button' onClick={onClose}>Cancel</button>
            <button type='submit' className='toolbar-button toolbar-button-accent'>Save</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  );
}

function blankRecord(section: Section, sourceId: number): Record<string, unknown> {
  const base = { id: -1, created_at: '', name: '', content_source_id: sourceId, version: '1.0' };
  if (section.contentType === 'ability-block') {
    return { ...base, operations: [], actions: null, level: 1, rarity: 'COMMON', prerequisites: [], frequency: '', cost: '', trigger: '', requirements: '', access: '', description: '', special: '', type: section.abilityBlockType, meta_data: {}, traits: [] };
  }
  if (section.contentType === 'spell') {
    return { ...base, rank: 0, traditions: [], rarity: 'COMMON', availability: null, cast: null, defense: '', cost: '', trigger: '', requirements: '', range: '', area: '', targets: '', duration: '', description: '', heightened: { text: [], data: {} }, meta_data: {}, traits: [] };
  }
  if (section.contentType === 'trait') {
    return { id: -1, created_at: '', name: '', description: '', meta_data: { important: false, creature_trait: false, unselectable: false }, content_source_id: sourceId };
  }
  if (section.contentType === 'language') {
    return { id: -1, created_at: '', name: '', speakers: '', script: '', description: '', rarity: 'COMMON', availability: null, deprecated: false, content_source_id: sourceId };
  }
  if (section.contentType === 'creature') {
    return { ...base, level: 0, experience: 0, hp_current: 0, hp_temp: 0, stamina_current: 0, resolve_current: 0, rarity: 'COMMON', inventory: null, notes: null, details: { description: '' }, roll_history: null, operations: [], operation_data: null, abilities_base: [], abilities_added: [], spells: null, meta_data: null, deprecated: false };
  }
  if (section.contentType === 'background') {
    return { ...base, rarity: 'COMMON', description: '', operations: [], artwork_url: '', deprecated: false };
  }
  if (section.contentType === 'class') {
    return { ...base, rarity: 'COMMON', description: '', skill_training_base: 0, operations: [], trait_id: -1, artwork_url: '', deprecated: false };
  }
  if (section.contentType === 'archetype') {
    return { ...base, rarity: 'COMMON', description: '', trait_id: -1, dedication_feat_id: null, artwork_url: '', deprecated: null };
  }
  if (section.contentType === 'versatile-heritage') {
    return { ...base, rarity: 'COMMON', description: '', trait_id: -1, heritage_id: -1, artwork_url: '', deprecated: null };
  }
  if (section.contentType === 'class-archetype') {
    return { ...base, rarity: 'COMMON', description: '', class_id: -1, archetype_id: null, operations: [], feature_adjustments: [], override_class_operations: false, override_skill_training_base: null, artwork_url: '', deprecated: false };
  }
  return { ...base, rarity: 'COMMON', description: '', operations: [], artwork_url: '', trait_id: -1, deprecated: false };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='block text-sm'>
      {label}
      <div className='mt-1'>{children}</div>
    </label>
  );
}
