import type { Operation } from '@schemas/operations';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HowToUseOperations, OperationSection } from './operations/operation-section';

export function Phase1OperationsModal(props: {
  title: string;
  opened: boolean;
  onClose: () => void;
  operations: Operation[];
  onChange: (operations: Operation[]) => void;
}) {
  useEffect(() => {
    if (!props.opened) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', close);
      document.body.style.overflow = overflow;
    };
  }, [props.opened, props.onClose]);

  if (!props.opened) return null;

  return createPortal(
    <div
      className='fixed inset-0 z-[140] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='phase1-ops-title'
        className='flex max-h-[min(86vh,800px)] w-full max-w-3xl flex-col border border-p1-border bg-p1-surface shadow-2xl'
      >
        <header className='flex items-center gap-3 border-b border-p1-border px-4 py-3'>
          <h2 id='phase1-ops-title' className='min-w-0 flex-1 text-lg font-semibold'>
            {props.title}
          </h2>
          <button type='button' className='icon-button' onClick={props.onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='min-h-0 flex-1 overflow-y-auto p-4'>
          <OperationSection title={<HowToUseOperations />} operations={props.operations} onChange={props.onChange} />
        </div>
      </section>
    </div>,
    document.body
  );
}
