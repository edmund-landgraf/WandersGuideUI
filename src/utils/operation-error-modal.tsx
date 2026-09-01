import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeCommonLog, type CommonLogEntry } from './common-log';

export function OperationErrorModalHost() {
  const [entry, setEntry] = useState<CommonLogEntry | null>(null);

  useEffect(() => {
    return subscribeCommonLog((next) => {
      if (next.source !== 'operations') return;
      setEntry(next);
    });
  }, []);

  if (!entry || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='wg-operation-error-title'
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.55)',
        padding: 16,
      }}
      onClick={() => setEntry(null)}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#1c1d21',
          color: '#e8e8e8',
          border: '1px solid #4a4c52',
          padding: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id='wg-operation-error-title' style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          Operation failed
        </h2>
        <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{entry.message}</p>
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type='button'
            style={{
              cursor: 'pointer',
              border: '1px solid #4a4c52',
              background: '#2a2b31',
              color: '#e8e8e8',
              padding: '6px 14px',
              fontSize: 14,
            }}
            onClick={() => setEntry(null)}
          >
            Dismiss
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
