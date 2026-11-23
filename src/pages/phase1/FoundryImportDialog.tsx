import { ensurePhase1PublicUser, phase1Request } from '@pages/phase1/phase1-api';
import { Character } from '@schemas/content';
import { useState } from 'react';
import { findBuilderCharacter, planBuilderUpdate } from '@import/foundry/builder-delta.mjs';
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
  const [links, setLinks] = useState<Record<string, { wgId?: unknown; host?: unknown }>>({});

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
    const flags = (body.actor as { flags?: Record<string, { wgId?: unknown; host?: unknown }> }).flags?.['foundry-wanderersguide-import'];
    return { plan: planSinglePc(body.actor, body.worldId || row.worldId), link: flags ?? {} };
  }

  function matchPlan(plan: SinglePcPlan) {
    const link = links[plan.actorId];
    return findBuilderCharacter(characters, {
      wgId: link?.wgId as number | string | undefined,
      host: typeof link?.host === 'string' ? link.host : undefined,
      worldId: plan.worldId,
      actorId: plan.actorId,
    });
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
      const nextLinks: Record<string, { wgId?: unknown; host?: unknown }> = {};
      for (const row of targets) {
        const read = await readPlan(row);
        next.push(read.plan);
        nextLinks[read.plan.actorId] = read.link;
      }
      setPlans(next);
      setLinks(nextLinks);
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
        const lookup = () => matchPlan(plan);
        const found = lookup();
        if (found.action === 'reject') {
          throw new Error(found.reason === 'host-mismatch'
            ? `${plan.name ?? 'A character'} is linked to a different Wanderer's Guide server. Nothing was written.`
            : `The linked Wanderer's Guide character for ${plan.name ?? 'a character'} was not found. Nothing was created.`);
        }
        if (found.action === 'update') {
          const update = planBuilderUpdate(found.character, {
            name: plan.name,
            level: plan.level,
            meta: { worldId: plan.worldId, actorId: plan.actorId },
          });
          if (!update.confirm) throw new Error(`${plan.name ?? 'A character'}: nothing writable changed. Session values were not applied.`);
          if (lookup().action !== 'update') throw new Error('The link changed before confirm. Nothing was created.');
          await phase1Request('update-character', update.body, accessToken);
          updated += 1;
        } else {
          if (lookup().action !== 'create') throw new Error(`${plan.name ?? 'A character'} already matches a character. Nothing new was created.`);
          const decision = planImportWrite(plan, undefined);
          if (decision.action !== 'create') throw new Error(decision.action === 'reject' ? `${plan.name ?? 'A character'}: ${decision.message}` : 'Nothing was created.');
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
              const found = matchPlan(plan);
              const rejected = found.action === 'reject' || (found.action === 'create' && planImportWrite(plan, undefined).action === 'reject');
              const verb = found.action === 'update' ? 'update' : 'create';
              return (
                <div key={plan.actorId}>
                  <p>{plan.counts.mapped} mapped, {plan.counts.included} included, {plan.counts.unresolved} unresolved, {plan.counts['leftover-preserved']} leftover-preserved, {plan.counts.dropped} dropped.</p>
                  {found.action === 'reject' ? (
                    <p className='mt-2'>{found.reason === 'host-mismatch'
                      ? `"${plan.name ?? 'This character'}" is linked to a different Wanderer's Guide server. Nothing will be written.`
                      : `The linked Wanderer's Guide character for "${plan.name ?? 'this character'}" was not found. Nothing will be created.`}</p>
                  ) : rejected ? (
                    <p className='mt-2'>Import needs a string name and a numeric level to create "{plan.name ?? 'this character'}". The other values stay in the leftovers.</p>
                  ) : (
                    <p className='mt-2'>Import will {verb} "{plan.name ?? 'this character'}"{plan.level != null ? `, level ${plan.level}` : ''}. Feats, spells, and gear stay in the leftovers.</p>
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
              disabled={busy || plans.length === 0 || plans.some((plan) => {
                const found = matchPlan(plan);
                return found.action === 'reject' || (found.action === 'create' && planImportWrite(plan, undefined).action === 'reject');
              })}
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
