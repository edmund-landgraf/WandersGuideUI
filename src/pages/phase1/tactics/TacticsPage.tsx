import { useAuthSession } from '@auth/useAuthSession';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ollamaDesign, proposeTurn } from './tactics-ollama';
import { loadTacticsBundle } from './tactics-bundle';
import { postChoice, postSnapshot } from './tactics-export';
import { confirmSpend, listSpends } from './tactics-spends';
import type { TacticsChoice, TacticsSnapshot } from './tactics-types';

type Message = { id: string; side: 'guide' | 'gm'; text: string };

export function TacticsPage() {
  const session = useAuthSession();
  const { campaignId: rawCampaign, encounterId: rawEncounter } = useParams();
  const campaignId = Number(rawCampaign);
  const encounterId = Number(rawEncounter);
  const enabled = Boolean(session && Number.isFinite(campaignId) && Number.isFinite(encounterId));
  const bundle = useQuery({
    queryKey: ['tactics-window', campaignId, encounterId, session?.user.id],
    enabled,
    queryFn: () => loadTacticsBundle(campaignId, encounterId, session!.user.id),
  });
  const [index, setIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [comment, setComment] = useState('');
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [choices, setChoices] = useState<TacticsChoice[]>([]);
  const [picked, setPicked] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [didText, setDidText] = useState('');
  const [designText, setDesignText] = useState('');
  const [designLine, setDesignLine] = useState('');
  const [designComment, setDesignComment] = useState('');
  const [spendTick, setSpendTick] = useState(0);

  const enemy = bundle.data?.enemies[index];
  const spends = useMemo(
    () => (bundle.data ? listSpends(campaignId, encounterId) : []),
    [bundle.data, campaignId, encounterId, spendTick]
  );
  const turnKey = enemy ? `${campaignId}:${encounterId}:${bundle.data?.round}:${enemy.id}:${spends.map((spend) => `${spend.abilityId}:${spend.used}`).join(',')}` : '';
  useEffect(() => {
    if (!bundle.data || !enemy || !turnKey) return;
    let cancelled = false;
    setWaiting(true);
    setElapsedSec(0);
    setPicked(false);
    setChoices([]);
    setStatusLog([]);
    setComment(`Preparing ${enemy.name}'s sheet for llama3.1.`);
    const started = Date.now();
    const clock = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    void proposeTurn({
      campaignId,
      encounterId,
      actor: enemy,
      combatants: bundle.data.combatants,
      spends,
      catalog: bundle.data.catalog,
      onStatus: (status) => {
        if (cancelled) return;
        setComment(status.detail);
        setStatusLog((current) => (current[current.length - 1] === status.detail ? current : [...current, status.detail]));
      },
    }).then((result) => {
      window.clearInterval(clock);
      if (cancelled) return;
      setChoices(result.choices);
      setComment(result.comment);
      setWaiting(false);
    });
    return () => {
      cancelled = true;
      window.clearInterval(clock);
    };
    // turnKey already covers the enemy, round, and spends being sent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  const snapshot: TacticsSnapshot | null = bundle.data && enemy
    ? {
        snapshotId: `${campaignId}:${encounterId}:${bundle.data.round}:${enemy.id}:${choices.map((choice) => choice.id).join(',')}`,
        campaignId,
        encounterId,
        round: bundle.data.round,
        enemyId: enemy.id,
        combatants: bundle.data.combatants,
        spends,
        choices,
      }
    : null;

  const snapshotId = snapshot?.snapshotId;
  useEffect(() => {
    if (!snapshot || choices.length === 0) return;
    void postSnapshot(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotId]);

  function selectChoice(choice: TacticsChoice) {
    if (!enemy || picked) return;
    setPicked(true);
    setChoices([]);
    for (const abilityId of new Set(choice.abilityIds)) {
      const ability = enemy.abilities.find((item) => item.id === abilityId);
      if (ability?.usesMax != null) confirmSpend(campaignId, encounterId, enemy.id, abilityId);
    }
    setSpendTick((value) => value + 1);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), side: 'guide', text: choice.text },
      { id: crypto.randomUUID(), side: 'gm', text: `Selected: ${choice.text}` },
    ]);
    void postChoice({ snapshotId: snapshot?.snapshotId ?? '', combatantId: enemy.id, choiceText: choice.text, source: 'menu' });
  }

  function recordDid() {
    if (!enemy || !didText.trim()) return;
    const text = didText.trim();
    setMessages((current) => [...current, { id: crypto.randomUUID(), side: 'gm', text }]);
    void postChoice({ snapshotId: snapshot?.snapshotId ?? '', combatantId: enemy.id, choiceText: text, source: 'already-did' });
    setDidText('');
    setCustomOpen(false);
  }

  async function design() {
    if (!snapshot || !designText.trim()) return;
    const result = await ollamaDesign(designText.trim(), snapshotBlock(snapshot));
    setDesignLine(result.line);
    setDesignComment(result.comment);
    setComment(result.comment);
  }

  function acceptDesign() {
    if (!enemy || !designLine.trim()) return;
    const text = designLine.trim();
    setMessages((current) => [...current, { id: crypto.randomUUID(), side: 'gm', text }]);
    void postChoice({ snapshotId: snapshot?.snapshotId ?? '', combatantId: enemy.id, choiceText: text, source: 'custom-design' });
    setDesignText('');
    setDesignLine('');
    setCustomOpen(false);
  }

  return (
    <div className='min-h-screen bg-p1-bg text-p1-text'>
      <header className='border-b border-p1-border px-5 py-4'>
        <p className='text-[10px] uppercase tracking-wide text-p1-faint'>GM tactics</p>
        <h1 className='text-xl font-semibold'>
          Round {bundle.data?.round ?? '—'} · {enemy?.name ?? 'No living enemy'}
        </h1>
      </header>
      <div className='mx-auto flex max-w-3xl flex-col gap-4 px-5 py-4'>
        {bundle.isLoading && <p className='text-sm text-p1-muted'>Loading the encounter snapshot…</p>}
        {bundle.error && <p className='text-sm text-p1-danger-soft'>{bundle.error instanceof Error ? bundle.error.message : 'Could not load the encounter.'}</p>}
        <div className='flex flex-col gap-2'>
          {messages.map((message) => (
            <p key={message.id} className={`max-w-[85%] rounded px-3 py-2 text-sm ${message.side === 'guide' ? 'self-start bg-p1-surface' : 'self-end bg-p1-accent/20'}`}>
              {message.text}
            </p>
          ))}
        </div>
        {waiting && (
          <section className='border border-p1-border bg-p1-surface px-3 py-2 text-sm'>
            <p className='text-p1-text'>{comment} · {elapsedSec}s</p>
            {statusLog.length > 1 && (
              <ul className='mt-2 space-y-1 text-xs text-p1-muted'>
                {statusLog.slice(0, -1).map((line, lineIndex) => (
                  <li key={lineIndex}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div className='flex flex-col gap-2'>
          {choices.map((choice) => (
            <button key={choice.id} type='button' disabled={picked} className='border border-p1-border bg-p1-surface px-3 py-2 text-left text-sm disabled:opacity-50' onClick={() => selectChoice(choice)}>
              <ul className='list-disc space-y-1 pl-4'>
                {choice.lines.map((line, lineIndex) => (
                  <li key={lineIndex}>{line}</li>
                ))}
              </ul>
              <span className='mt-1 block text-xs text-p1-muted'>{choice.tip}</span>
            </button>
          ))}
        </div>
        {!waiting && comment && <div className='rounded border border-[#e7e1d6] bg-[#f6f1e8] px-3 py-2 text-sm text-[#3d3830]'>{comment}</div>}
        <div className='flex flex-wrap gap-2'>
          <button type='button' className='toolbar-button' onClick={() => setIndex((value) => value + 1)}>Next enemy</button>
          <button type='button' className='toolbar-button' onClick={() => setIndex((value) => value + 1)}>Skip</button>
          <button type='button' className='toolbar-button' onClick={() => setCustomOpen(true)}>Custom</button>
        </div>
        {customOpen && (
          <section className='border border-p1-border bg-p1-surface p-3 text-sm'>
            <label className='block text-xs text-p1-muted'>
              Tell you what I did
              <textarea className='mt-1 w-full border border-p1-border bg-p1-inset p-2' rows={2} value={didText} onChange={(event) => setDidText(event.target.value)} />
            </label>
            <button type='button' className='toolbar-button mt-2' onClick={recordDid}>Select</button>
            <label className='mt-4 block text-xs text-p1-muted'>
              Add a custom choice
              <textarea className='mt-1 w-full border border-p1-border bg-p1-inset p-2' rows={2} value={designText} onChange={(event) => setDesignText(event.target.value)} />
            </label>
            <button type='button' className='toolbar-button mt-2' onClick={() => void design()}>Check</button>
            {designLine && (
              <label className='mt-3 block text-xs text-p1-muted'>
                Rules line
                <textarea className='mt-1 w-full border border-p1-border bg-p1-inset p-2' rows={3} value={designLine} onChange={(event) => setDesignLine(event.target.value)} />
              </label>
            )}
            {designComment && <p className='mt-2 text-xs text-p1-muted'>{designComment}</p>}
            <div className='mt-2 flex gap-2'>
              <button type='button' className='toolbar-button' onClick={acceptDesign}>Accept</button>
              <button type='button' className='toolbar-button' onClick={() => { setDesignLine(''); setDesignComment(''); setCustomOpen(false); }}>Discard</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function snapshotBlock(snapshot: TacticsSnapshot) {
  return snapshot.combatants
    .map((combatant) => `${combatant.name} (${combatant.side}) HP ${combatant.hpCurrent}/${combatant.hpMax} AC ${combatant.ac ?? '?'}`)
    .join('\n');
}
