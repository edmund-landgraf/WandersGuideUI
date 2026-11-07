import { ensurePhase1PublicUser, phase1Request } from '@pages/phase1/phase1-api';
import { Character } from '@schemas/content';
import { useState } from 'react';
import {
  FoundryListRow,
  LIST_PATH,
  SinglePcPlan,
  actorPath,
  findImportedCharacter,
  foundryGet,
  planImportWrite,
  planSinglePc,
} from '@import/foundry/single-pc';

type Step = 'connect' | 'pick' | 'review';

type Props = {
  accessToken: string | undefined;
  characters: Character[];
  onClose: () => void;
  onImported: (message: string) => void;
};

function linkedCharacter(characters: Character[], worldId: string, actorId: string) {
  const match = findImportedCharacter(characters, worldId, actorId);
  if (!match || match.id == null) return undefined;
  return {
    id: match.id,
    name: match.name,
    meta_data: (match.meta_data ?? undefined) as Record<string, unknown> | undefined,
  };
}

export function FoundryImportDialog({ accessToken, characters, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('connect');
  const [origin, setOrigin] = useState('http://localhost:30000');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<FoundryListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plan, setPlan] = useState<SinglePcPlan | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const body = await foundryGet<{ characters?: FoundryListRow[] }>(origin, code, LIST_PATH);
      const list = (body.characters ?? []).filter((row) => row.id);
      setRows(list);
      setSelectedId(list.length === 1 ? list[0].id : null);
      setStep('pick');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Foundry world did not answer.');
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    const row = rows.find((entry) => entry.id === selectedId);
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      const body = await foundryGet<{ worldId?: string; actor?: Parameters<typeof planSinglePc>[0] }>(origin, code, actorPath(row.id));
      if (!body.actor) throw new Error('Foundry did not return that character.');
      setPlan(planSinglePc(body.actor, body.worldId || row.worldId));
      setStep('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that character.');
    } finally {
      setBusy(false);
    }
  }

  async function write() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await ensurePhase1PublicUser(accessToken);
      const decision = planImportWrite(plan, linkedCharacter(characters, plan.worldId, plan.actorId));
      if (decision.action === 'reject') throw new Error(decision.message);
      if (decision.action === 'update') {
        await phase1Request('update-character', decision.body, accessToken);
        onImported(`Updated "${decision.messageName}".`);
      } else {
        const created = await phase1Request<Character>('create-character', decision.body, accessToken);
        onImported(`Imported "${created.name ?? decision.messageName}".`);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className='max-h-[85vh] w-full max-w-lg overflow-auto border border-p1-border bg-p1-surface p-5'>
        <h2 className='text-lg font-semibold'>Import from Foundry</h2>
        <p className='mt-2 text-sm text-p1-muted'>One character. The connection code stays in this browser. Cancel writes nothing.</p>
        {error ? <p className='mt-3 text-sm text-p1-danger-soft'>{error}</p> : null}

        {step === 'connect' && (
          <>
            <label className='mt-4 block text-sm'>
              Foundry world address
              <input className='settings-input mt-1 h-9 w-full' value={origin} onChange={(event) => setOrigin(event.target.value)} />
            </label>
            <label className='mt-3 block text-sm'>
              Connection code
              <input className='settings-input mt-1 h-9 w-full' type='password' value={code} onChange={(event) => setCode(event.target.value)} />
            </label>
          </>
        )}

        {step === 'pick' && (
          <ul className='mt-4 space-y-2'>
            {rows.length === 0 ? <li className='text-sm text-p1-muted'>No characters.</li> : null}
            {rows.map((row) => (
              <li key={row.id}>
                <label className='flex items-start gap-2 text-sm'>
                  <input type='radio' name='foundry-pc' checked={selectedId === row.id} onChange={() => setSelectedId(row.id)} />
                  <span>
                    {row.name || 'Unnamed'} {row.level != null ? `· level ${row.level}` : ''} {row.className ? `· ${row.className}` : ''}
                    {linkedCharacter(characters, row.worldId, row.id) ? ' · already in this account' : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {step === 'review' && plan && (
          <div className='mt-4 text-sm'>
            <p>{plan.counts.mapped} mapped, {plan.counts.included} included, {plan.counts.unresolved} unresolved, {plan.counts['leftover-preserved']} leftover-preserved, {plan.counts.dropped} dropped.</p>
            {planImportWrite(plan, linkedCharacter(characters, plan.worldId, plan.actorId)).action === 'reject' ? (
              <p className='mt-2'>Import needs a string name and a numeric level to create a character. The other values stay in the leftovers.</p>
            ) : (
              <p className='mt-2'>Import will {linkedCharacter(characters, plan.worldId, plan.actorId) ? 'update' : 'create'} "{plan.name ?? 'this character'}"{plan.level != null ? `, level ${plan.level}` : ''}. Feats, spells, and gear stay in the leftovers.</p>
            )}
          </div>
        )}

        <div className='mt-4 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' disabled={busy} onClick={onClose}>Cancel</button>
          {step === 'connect' && <button type='button' className='toolbar-button' disabled={busy} onClick={() => void connect()}>Connect</button>}
          {step === 'pick' && <button type='button' className='toolbar-button' disabled={busy || !selectedId} onClick={() => void review()}>Review</button>}
          {step === 'review' && (
            <button
              type='button'
              className='toolbar-button'
              disabled={busy || !plan || planImportWrite(plan, linkedCharacter(characters, plan.worldId, plan.actorId)).action === 'reject'}
              onClick={() => void write()}
            >
              Import
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
