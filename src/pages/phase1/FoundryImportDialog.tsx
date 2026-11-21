import { ensurePhase1PublicUser, phase1Request } from '@pages/phase1/phase1-api';
import { Character } from '@schemas/content';
import { useState } from 'react';
import {
  FoundryListRow,
  SinglePcPlan,
  findImportedCharacter,
  foundryRelayRead,
  foundryRelayUrl,
  partyFolders,
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
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [plans, setPlans] = useState<SinglePcPlan[]>([]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const body = await foundryRelayRead<{ characters?: FoundryListRow[] }>(foundryRelayUrl(), origin, code, 'list');
      const list = (body.characters ?? []).filter((row) => row.id);
      setRows(list);
      setSelectedFolderId(null);
      setSelectedId(list.length === 1 ? list[0].id : null);
      setStep('pick');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Foundry world did not answer.');
    } finally {
      setBusy(false);
    }
  }

  const parties = partyFolders(rows);
  const chosenParty = parties.find((party) => party.folderId === selectedFolderId) ?? null;

  async function readPlan(row: FoundryListRow) {
    const body = await foundryRelayRead<{ worldId?: string; actor?: Parameters<typeof planSinglePc>[0] }>(
      foundryRelayUrl(),
      origin,
      code,
      'actor',
      row.id,
    );
    if (!body.actor) throw new Error(`Foundry did not return ${row.name || 'that character'}.`);
    return planSinglePc(body.actor, body.worldId || row.worldId);
  }

  async function review() {
    const targets = chosenParty
      ? rows.filter((row) => chosenParty.actorIds.includes(row.id))
      : rows.filter((row) => row.id === selectedId);
    if (!targets.length) return;
    setBusy(true);
    setError(null);
    try {
      const next: SinglePcPlan[] = [];
      for (const row of targets) next.push(await readPlan(row));
      setPlans(next);
      setStep('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that character.');
    } finally {
      setBusy(false);
    }
  }

  async function write() {
    if (!plans.length) return;
    setBusy(true);
    setError(null);
    try {
      await ensurePhase1PublicUser(accessToken);
      let created = 0;
      let updated = 0;
      for (const plan of plans) {
        const decision = planImportWrite(plan, linkedCharacter(characters, plan.worldId, plan.actorId));
        if (decision.action === 'reject') throw new Error(`${plan.name ?? 'A character'}: ${decision.message}`);
        if (decision.action === 'update') {
          await phase1Request('update-character', decision.body, accessToken);
          updated += 1;
        } else {
          await phase1Request<Character>('create-character', decision.body, accessToken);
          created += 1;
        }
      }
      const partyName = chosenParty?.folderName;
      if (plans.length === 1 && !chosenParty) {
        onImported(updated ? `Updated "${plans[0].name ?? 'this character'}".` : `Imported "${plans[0].name ?? 'this character'}".`);
      } else {
        const parts = [`Imported ${created}`, updated ? `updated ${updated}` : ''].filter(Boolean).join(', ');
        onImported(`${parts} from "${partyName ?? 'the party'}".`);
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
        <p className='mt-2 text-sm text-p1-muted'>One character, or every character in a party folder. The connection code stays in this browser. Cancel writes nothing.</p>
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
            {parties.map((party) => (
              <li key={party.folderId}>
                <label className='flex items-start gap-2 text-sm'>
                  <input
                    type='radio'
                    name='foundry-pc'
                    checked={selectedFolderId === party.folderId}
                    onChange={() => { setSelectedFolderId(party.folderId); setSelectedId(null); }}
                  />
                  <span>Party: {party.folderName} · {party.actorIds.length} character{party.actorIds.length === 1 ? '' : 's'}</span>
                </label>
              </li>
            ))}
            {rows.map((row) => (
              <li key={row.id}>
                <label className='flex items-start gap-2 text-sm'>
                  <input type='radio' name='foundry-pc' checked={selectedId === row.id} onChange={() => { setSelectedId(row.id); setSelectedFolderId(null); }} />
                  <span>
                    {row.name || 'Unnamed'} {row.level != null ? `· level ${row.level}` : ''} {row.className ? `· ${row.className}` : ''}
                    {linkedCharacter(characters, row.worldId, row.id) ? ' · already in this account' : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {step === 'review' && plans.length > 0 && (
          <div className='mt-4 space-y-3 text-sm'>
            {plans.map((plan) => {
              const rejected = planImportWrite(plan, linkedCharacter(characters, plan.worldId, plan.actorId)).action === 'reject';
              return (
                <div key={plan.actorId}>
                  <p>{plan.counts.mapped} mapped, {plan.counts.included} included, {plan.counts.unresolved} unresolved, {plan.counts['leftover-preserved']} leftover-preserved, {plan.counts.dropped} dropped.</p>
                  {rejected ? (
                    <p className='mt-2'>Import needs a string name and a numeric level to create "{plan.name ?? 'this character'}". The other values stay in the leftovers.</p>
                  ) : (
                    <p className='mt-2'>Import will {linkedCharacter(characters, plan.worldId, plan.actorId) ? 'update' : 'create'} "{plan.name ?? 'this character'}"{plan.level != null ? `, level ${plan.level}` : ''}. Feats, spells, and gear stay in the leftovers.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className='mt-4 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' disabled={busy} onClick={onClose}>Cancel</button>
          {step === 'connect' && <button type='button' className='toolbar-button' disabled={busy} onClick={() => void connect()}>Connect</button>}
          {step === 'pick' && <button type='button' className='toolbar-button' disabled={busy || (!selectedId && !selectedFolderId)} onClick={() => void review()}>Review</button>}
          {step === 'review' && (
            <button
              type='button'
              className='toolbar-button'
              disabled={busy || plans.length === 0 || plans.some((plan) => planImportWrite(plan, linkedCharacter(characters, plan.worldId, plan.actorId)).action === 'reject')}
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
