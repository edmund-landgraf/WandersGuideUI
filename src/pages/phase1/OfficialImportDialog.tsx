import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff } from 'lucide-react';
import officialApiClient from '@assets/images/guides/official-api-client-guide.jpg';
import { importOfficialCharacters, testOfficialConnection, type OfficialCharacterSummary, type OfficialImportResult } from '@import/wg/import-from-official';

const IMPORT_CAP = 50;
const STORED_CREDENTIALS_KEY = 'wgui-official-import';

function readStoredCredentials(): { apiKey: string; authUrl: string } | null {
  try {
    const raw = localStorage.getItem(STORED_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { apiKey?: string; authUrl?: string };
    if (!parsed.apiKey || !parsed.authUrl) return null;
    return { apiKey: parsed.apiKey, authUrl: parsed.authUrl };
  } catch {
    return null;
  }
}

export default function OfficialImportDialog(props: {
  accessToken?: string;
  slotsRemaining: number | null;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const stored = readStoredCredentials();
  const [apiKey, setApiKey] = useState(stored?.apiKey ?? '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [authUrl, setAuthUrl] = useState(stored?.authUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [characters, setCharacters] = useState<OfficialCharacterSummary[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<OfficialImportResult[] | null>(null);

  function persistCredentials() {
    const key = apiKey.trim();
    const url = authUrl.trim();
    if (!key || !url) return;
    localStorage.setItem(STORED_CREDENTIALS_KEY, JSON.stringify({ apiKey: key, authUrl: url }));
  }

  function clearCredentials() {
    localStorage.removeItem(STORED_CREDENTIALS_KEY);
    setApiKey('');
    setAuthUrl('');
    setConnected(false);
    setCharacters([]);
    setResults(null);
    setStatus(null);
  }

  function close() {
    persistCredentials();
    props.onClose();
  }

  async function testConnection() {
    setBusy(true);
    setStatus(null);
    setResults(null);
    setConnected(false);
    try {
      const list = await testOfficialConnection(apiKey, authUrl);
      persistCredentials();
      setCharacters(list);
      setSelected(new Set(list.map((character) => character.id)));
      setConnected(true);
      setStatus(list.length === 0 ? 'Connected. This account has no characters.' : `Connected. ${list.length} characters found.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not connect.');
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
      persistCredentials();
      const imported = await importOfficialCharacters(apiKey, authUrl, ids, props.accessToken);
      setResults(imported);
      if (imported.some((row) => row.ok)) await props.onImported();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const allSelected = characters.length > 0 && characters.every((character) => selected.has(character.id));

  return createPortal(
    <div className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby='official-import-title' className='flex max-h-[85vh] w-full max-w-lg flex-col border border-p1-border bg-p1-surface p-5'>
        <h2 id='official-import-title' className='text-lg font-semibold'>Import from wanderersguide.app</h2>
        <p className='mt-2 text-sm text-p1-muted'>
          On wanderersguide.app, open Account, Developer, API Clients. Copy the API key and Character Authorization URL shown there.
        </p>
        <img
          src={officialApiClient}
          alt='New Client card with arrows pointing at the API key and the Character Authorization URL'
          className='mt-3 w-full rounded-md'
        />
        <label className='mt-4 block text-xs text-p1-muted' htmlFor='official-api-key'>API Key</label>
        <div className='relative mt-1'>
          <input
            id='official-api-key'
            className='settings-input h-9 w-full'
            style={{ paddingRight: '2.25rem' }}
            type={showApiKey ? 'text' : 'password'}
            autoComplete='off'
            value={apiKey}
            disabled={busy}
            onChange={(event) => { setApiKey(event.target.value); setConnected(false); setResults(null); }}
          />
          <button
            type='button'
            className='absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center text-p1-muted hover:text-p1-text'
            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            aria-pressed={showApiKey}
            disabled={busy}
            onClick={() => setShowApiKey((visible) => !visible)}
          >
            {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
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
        <div className='mt-4 flex items-center justify-between gap-2'>
          <button
            type='button'
            className='text-xs text-p1-muted hover:text-p1-text disabled:opacity-40'
            disabled={busy || (!apiKey.trim() && !authUrl.trim())}
            onClick={clearCredentials}
          >
            Clear credentials
          </button>
          <div className='flex gap-2'>
          <button
            type='button'
            className='toolbar-button'
            disabled={busy}
            onClick={close}
          >
            Close
          </button>
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
        </div>
      </section>
    </div>,
    document.body
  );
}
