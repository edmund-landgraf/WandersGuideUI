import { submitContentUpdate } from '@content/content-update';
import { convertToContentType } from '@content/content-utils';
import type { AbilityBlockType, ContentType } from '@schemas/content';
import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

export function Phase1MissingContent({
  type,
  id,
  contentSourceId,
  onClose,
}: {
  type: ContentType | AbilityBlockType;
  id: number;
  contentSourceId?: number;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const creating = id < 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = note.trim();
    if (!text) return;
    setBusy(true);
    setError('');
    const result = await submitContentUpdate(
      convertToContentType(type),
      creating ? 'CREATE' : 'UPDATE',
      { description: text, type },
      contentSourceId ?? -1,
      creating ? undefined : id
    );
    setBusy(false);
    if (!result) {
      setError('The report did not go through. Try again.');
      return;
    }
    onClose();
  }

  return createPortal(
    <div className='fixed inset-0 z-[220] grid place-items-center bg-black/75 p-5' role='presentation'>
      <form role='dialog' aria-modal='true' aria-labelledby='missing-content-title' className='w-full max-w-lg border border-p1-border bg-p1-surface p-4' onSubmit={(event) => void submit(event)}>
        <header className='flex items-center gap-3'>
          <h2 id='missing-content-title' className='min-w-0 flex-1 text-lg font-semibold'>Missing something?</h2>
          <button type='button' className='icon-button' onClick={onClose} title='Close'><X size={18} /></button>
        </header>
        <p className='mt-2 text-sm text-p1-muted'>{creating ? 'Describe the record that should be in this book.' : 'Describe what is missing or wrong on this record.'}</p>
        <textarea required className='settings-input mt-3 min-h-32' value={note} onChange={(event) => setNote(event.target.value)} />
        {error && <p className='mt-2 text-sm text-p1-danger-soft'>{error}</p>}
        <footer className='mt-3 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onClose}>Cancel</button>
          <button type='submit' className='toolbar-button toolbar-button-accent' disabled={busy}>Send</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
