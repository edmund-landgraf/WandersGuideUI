import { useState } from 'react';
import { createPortal } from 'react-dom';
import { importOfficialCharacters, testOfficialConnection, type OfficialCharacterSummary, type OfficialImportResult } from '@import/wg/import-from-official';

const IMPORT_CAP = 50;

export default function OfficialImportDialog(props: {
  accessToken?: string;
  slotsRemaining: number | null;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [characters, setCharacters] = useState<OfficialCharacterSummary[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<OfficialImportResult[] | null>(null);

  async function testConnection() {
    setBusy(true);
    setStatus(null);
    setResults(null);
    setConnected(false);
    try {
      const list = await testOfficialConnection(apiKey, authUrl, props.accessToken);
      setCharacters(list);
      setSelected(new Set(list.map((character) => character.id)));
      setConnected(true);
      setStatus(list.length === 0 ? 'Connected. This account has no characters.' : `Connected. ${list.length} characters found.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message.replace(/^wgui-ext-import-official-characters:\s*/, '') : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importSelected() {
    const ids = characters.filter((character) => selected.has(character.id)).map((character) => character.id);
    if (ids.length === 0 || busy) return;
    if (ids.length > IMPORT_CAP) {
      setStatus(`Import up to ${IMPORT_CAP} characters at a time.`);
      return;
    }
    if (props.slotsRemaining != null && ids.length > props.slotsRemaining) {
      setStatus(`Character slot limit reached. ${props.slotsRemaining} slots left.`);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const imported = await importOfficialCharacters(apiKey, authUrl, ids, props.accessToken);
      setResults(imported);
      if (imported.some((row) => row.ok)) await props.onImported();
    } catch (error) {
      setStatus(error instanceof Error ? error.message.replace(/^wgui-ext-import-official-characters:\s*/, '') : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const allSelected = characters.length > 0 && characters.every((character) => selected.has(character.id));

  return createPortal(
    <div className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) props.onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby='official-import-title' className='flex max-h-[85vh] w-full max-w-lg flex-col border border-p1-border bg-p1-surface p-5'>
        <h2 id='official-import-title' className='text-lg font-semibold'>Import from wanderersguide.app</h2>
        <p className='mt-2 text-sm text-p1-muted'>
          Paste the API key and Character Authorization URL from Account, Developer, API Clients on wanderersguide.app. The key is used for this import only and is not saved.
        </p>
        <label className='mt-4 block text-xs text-p1-muted' htmlFor='official-api-key'>API Key</label>
        <input
          id='official-api-key'
          className='settings-input mt-1 h-9 w-full'
          type='password'
          autoComplete='off'
          value={apiKey}
          disabled={busy}
          onChange={(event) => { setApiKey(event.target.value); setConnected(false); setResults(null); }}
        />
        <label className='mt-3 block text-xs text-p1-muted' htmlFor='official-auth-url'>Character Authorization URL</label>
        <input
          id='official-auth-url'
          className='settings-input mt-1 h-9 w-full'
          type='url'
          autoComplete='off'
          placeholder='https://wanderersguide.app/oauth/access?user_id=…&client_id=…'
          value={authUrl}
          disabled={busy}
          onChange={(event) => { setAuthUrl(event.target.value); setConnected(false); setResults(null); }}
        />
        {status && <p className='mt-3 text-sm text-p1-muted'>{status}</p>}
        {connected && characters.length > 0 && !results && (
          <div className='mt-4 min-h-0 flex-1 overflow-y-auto border border-p1-border'>
            <label className='flex items-center gap-2 border-b border-p1-border px-3 py-2 text-sm'>
              <input
                type='checkbox'
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(characters.map((character) => character.id)))}
              />
              Select all
            </label>
            {characters.map((character) => (
              <label key={character.id} className='flex items-center gap-2 px-3 py-2 text-sm hover:bg-p1-hover'>
                <input type='checkbox' checked={selected.has(character.id)} onChange={() => toggle(character.id)} />
                <span className='min-w-0 flex-1 truncate'>{character.name}</span>
                <span className='text-p1-muted'>Level {character.level}</span>
              </label>
            ))}
          </div>
        )}
        {results && (
          <ul className='mt-4 min-h-0 flex-1 overflow-y-auto text-sm'>
            {results.map((row, index) => (
              <li key={`${row.name}-${index}`} className='border-b border-p1-border py-2'>
                {row.ok ? `Imported ${row.name}` : `${row.name}: ${row.message}`}
              </li>
            ))}
          </ul>
        )}
        <div className='mt-4 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' disabled={busy} onClick={props.onClose}>Close</button>
          {!results && (
            <button type='button' className='toolbar-button' disabled={busy || !apiKey.trim() || !authUrl.trim()} onClick={() => void testConnection()}>
              {busy && !connected ? 'Testing…' : 'Test connection'}
            </button>
          )}
          {connected && !results && (
            <button
              type='button'
              className='toolbar-button'
              disabled={busy || selected.size === 0}
              style={{ background: 'var(--p1-accent)', color: 'var(--p1-accent-ink)', borderColor: 'var(--p1-accent)' }}
              onClick={() => void importSelected()}
            >
              {busy ? 'Importing…' : `Import ${selected.size}`}
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
