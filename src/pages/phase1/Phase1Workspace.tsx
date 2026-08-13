import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, BookOpen, Calculator, Check, ChevronDown, ChevronRight, ClipboardCopy, Crosshair, Eye, ExternalLink, Footprints, GripVertical, History, KeyRound, ListChecks, LogOut, PanelRight, Search, Shield, Sparkles, Swords, UserRound, UsersRound, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { Campaign, Character, Combatant, Encounter, LivingEntity } from '@schemas/content';
import { supabase } from '../../supabase-client';
import { phase1Request } from './phase1-api';
import { loadEntityAbilities, type Phase1Ability } from './phase1-abilities';
import { calculateEntityStatus, type Phase1CreatureStatus } from './phase1-stats';
import type { Phase1EntityCombatant } from './phase1-entity';
import { loadEntitySkillsActions, type Phase1ActionGroup, type Phase1Skill } from './phase1-skills';
import { castEntitySpell, loadEntitySpells, type Phase1SpellEntry, type Phase1SpellSection } from './phase1-spells';

const OLD_UI_ORIGIN = import.meta.env.VITE_OLD_UI_ORIGIN || 'http://localhost:5193';
const DETAIL_WIDTH_KEY = 'phase1-detail-width';
const DETAIL_TABS = ['Health', 'Abilities', 'Skills', 'Inventory', 'Spells', 'Notes', 'Details'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];
type PopulatedCombatant = Combatant & { data: LivingEntity; access?: { can_edit: boolean; details_revealed: boolean } };

function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => mounted && setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);
  return session;
}

export function Phase1IndexPage() {
  const session = useSession();
  const navigate = useNavigate();
  const campaigns = useQuery({
    queryKey: ['phase1-campaigns', session?.user.id],
    enabled: Boolean(session),
    queryFn: async () => {
      const owned = await phase1Request<Campaign[]>('find-campaign', { user_id: session!.user.id });
      const characters = await phase1Request<Character[]>('find-character', { user_id: session!.user.id });
      const joinedIds = [...new Set(characters.map((item) => item.campaign_id).filter(isNumber))];
      const joined = (await Promise.all(joinedIds.map((id) => phase1Request<Campaign[]>('find-campaign', { id })))).flat();
      return uniqueById([...owned, ...joined]);
    },
  });

  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <SignIn />;
  return (
    <div className='min-h-screen bg-[#0d1114] text-[#e7ebed]'>
      <WorkspaceHeader label='Campaigns' />
      <main className='mx-auto max-w-5xl px-6 py-10'>
        <div className='mb-8 flex items-end justify-between gap-6 border-b border-white/10 pb-6'>
          <div><Eyebrow>Phase 1</Eyebrow><h1 className='mt-2 text-3xl font-semibold'>Campaign workspace</h1><p className='mt-2 text-sm text-[#8e999f]'>Choose an owned or joined campaign.</p></div>
          <button className='icon-button' title='Sign out' onClick={() => supabase.auth.signOut()}><LogOut size={17} /></button>
        </div>
        {campaigns.isLoading && <EmptyState>Loading campaigns...</EmptyState>}
        {campaigns.error && <ErrorState error={campaigns.error} />}
        {campaigns.data?.length === 0 && <EmptyState>No campaigns are available.</EmptyState>}
        <div className='divide-y divide-white/10 border-y border-white/10'>
          {campaigns.data?.map((campaign) => (
            <button key={campaign.id} className='group grid w-full grid-cols-[1fr_auto] items-center gap-6 px-2 py-5 text-left hover:bg-white/[0.025]' onClick={() => navigate(`/phase1/campaign/${campaign.id}`)}>
              <div><div className='font-semibold'>{campaign.name}</div><div className='mt-1 line-clamp-1 text-sm text-[#7f8a90]'>{campaign.description || 'No campaign description'}</div></div>
              <ChevronRight className='text-[#616d73] group-hover:text-[#d6a85f]' size={18} />
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

export function Phase1CampaignPage() {
  const session = useSession();
  const { campaignId: rawCampaignId, encounterId: rawEncounterId } = useParams();
  const campaignId = Number(rawCampaignId);
  const encounterId = rawEncounterId ? Number(rawEncounterId) : null;
  const enabled = Boolean(session && Number.isFinite(campaignId));
  const queryClient = useQueryClient();
  const encountersKey = ['phase1-encounters', campaignId, session?.user.id] as const;
  const playersKey = ['phase1-players', campaignId, session?.user.id] as const;
  const campaign = useQuery({ queryKey: ['phase1-campaign', campaignId, session?.user.id], enabled, queryFn: async () => (await phase1Request<Campaign[]>('find-campaign', { id: campaignId }))[0] ?? null });
  const players = useQuery({ queryKey: playersKey, enabled, queryFn: () => phase1Request<Character[]>('find-character', { campaign_id: campaignId }) });
  const encounters = useQuery({ queryKey: encountersKey, enabled, queryFn: () => phase1Request<Encounter[]>('find-encounter', { campaign_id: campaignId }) });
  const updateEncounter = useMutation<boolean, Error, Encounter, { previous?: Encounter[] }>({
    mutationFn: (encounter) => phase1Request<boolean>('create-encounter', { ...encounter }),
    onMutate: async (encounter) => {
      await queryClient.cancelQueries({ queryKey: encountersKey });
      const previous = queryClient.getQueryData<Encounter[]>(encountersKey);
      queryClient.setQueryData<Encounter[]>(encountersKey, (current = []) => current.map((item) => item.id === encounter.id ? encounter : item));
      return { previous };
    },
    onError: (_error, _encounter, context) => {
      if (context?.previous) queryClient.setQueryData(encountersKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: encountersKey }),
  });

  const updateCharacterSpells = useMutation<unknown, Error, { id: number; spells: Character['spells'] }, { previous?: Character[] }>({
    mutationFn: ({ id, spells }) => phase1Request('update-character', { id, spells }),
    onMutate: async ({ id, spells }) => {
      await queryClient.cancelQueries({ queryKey: playersKey });
      const previous = queryClient.getQueryData<Character[]>(playersKey);
      queryClient.setQueryData<Character[]>(playersKey, (current = []) => current.map((item) => item.id === id ? { ...item, spells } : item));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(playersKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: playersKey }),
  });
  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <SignIn />;
  if (campaign.isLoading || players.isLoading || encounters.isLoading) return <LoadingScreen label='Loading campaign workspace' />;
  const error = campaign.error || players.error || encounters.error;
  if (error) return <PageError error={error} />;
  if (!campaign.data) return <PageError error={new Error('Campaign not found')} />;

  const isGm = campaign.data.user_id === session.user.id;
  const ownIds = new Set((players.data ?? []).filter((item) => item.user_id === session.user.id).map((item) => item.id));
  const campaignEncounters = (encounters.data ?? []).filter((encounter) => encounter.campaign_id === campaignId);
  const visible = isGm ? campaignEncounters : campaignEncounters.filter((encounter) => encounter.combatants.list.some((item) => item.type === 'CHARACTER' && item.character && ownIds.has(item.character)));
  if (!encounterId && visible[0]) return <Navigate replace to={`/phase1/campaign/${campaignId}/encounters/${visible[0].id}`} />;
  return <EncounterWorkspace campaign={campaign.data} encounters={visible} players={players.data ?? []} selectedEncounter={visible.find((item) => item.id === encounterId) ?? null} isGm={isGm} onUpdateEncounter={(encounter) => updateEncounter.mutate(encounter)} onUpdateCharacterSpells={(id, spells) => updateCharacterSpells.mutate({ id, spells })} rosterSaving={updateEncounter.isPending} rosterError={updateEncounter.error ?? updateCharacterSpells.error} />;
}


function EncounterWorkspace({ campaign, encounters, players, selectedEncounter, isGm, onUpdateEncounter, onUpdateCharacterSpells, rosterSaving, rosterError }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; selectedEncounter: Encounter | null; isGm: boolean; onUpdateEncounter: (encounter: Encounter) => void; onUpdateCharacterSpells: (id: number, spells: Character['spells']) => void; rosterSaving: boolean; rosterError: Error | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailWidth, setDetailWidth] = useState(readDetailWidth);
  const [activeTab, setActiveTab] = useState<DetailTab>('Health');
  const combatants = useMemo(() => populateCombatants(selectedEncounter?.combatants.list ?? [], players), [selectedEncounter, players]);
  const selected = combatants.find((item) => item._id === selectedId) ?? null;
  const statuses = useCombatantStatuses(selectedEncounter?.id ?? null, combatants);
  const encounterNote = campaign.notes?.pages?.find((page) => page.name.trim().toLowerCase() === selectedEncounter?.name.trim().toLowerCase());
  const activeCharacterIds = new Set((selectedEncounter?.combatants.list ?? []).filter((combatant) => combatant.type === 'CHARACTER').map((combatant) => combatant.character));
  const benchPlayers = players.filter((player) => !activeCharacterIds.has(player.id));

  function updateRoster(list: Combatant[]) {
    if (!selectedEncounter || !isGm || rosterSaving) return;
    const allies = populateCombatants(list, players).filter((combatant) => combatant.ally);
    const levels = allies.map((combatant) => combatant.data.level).filter(Number.isFinite);
    onUpdateEncounter({
      ...selectedEncounter,
      combatants: { list },
      meta_data: {
        ...selectedEncounter.meta_data,
        party_size: allies.length,
        party_level: levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0,
      },
    });
  }

  function addPlayer(characterId: number) {
    if (!selectedEncounter || activeCharacterIds.has(characterId)) return;
    updateRoster([...selectedEncounter.combatants.list, { _id: crypto.randomUUID(), type: 'CHARACTER', ally: true, initiative: undefined, character: characterId, data: undefined }]);
  }

  function removePlayer(combatantId: string) {
    if (!selectedEncounter) return;
    const combatant = selectedEncounter.combatants.list.find((item) => item._id === combatantId);
    if (combatant?.type !== 'CHARACTER') return;
    updateRoster(selectedEncounter.combatants.list.filter((item) => item._id !== combatantId));
  }

  async function castSpell(entry: Phase1SpellEntry) {
    if (!selected || !selectedEncounter || !isGm || !entry.available) return;
    const entity = await castEntitySpell(selected as Phase1EntityCombatant, entry);
    if (selected.type === 'CHARACTER' && selected.character) {
      onUpdateCharacterSpells(selected.character, entity.spells);
      return;
    }
    const list = selectedEncounter.combatants.list.map((combatant) => combatant._id === selected._id ? { ...combatant, creature: entity } as Combatant : combatant);
    onUpdateEncounter({ ...selectedEncounter, combatants: { list } });
  }
  useEffect(() => setSelectedId(null), [selectedEncounter?.id]);
  useEffect(() => window.localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth)), [detailWidth]);

  return (
    <div className='flex h-screen min-h-[680px] flex-col overflow-hidden bg-[#0d1114] text-[#e7ebed]'>
      <WorkspaceHeader label={campaign.name} />
      <div className='grid min-h-0 flex-1 grid-cols-[248px_minmax(520px,1fr)_6px_auto]'>
        <CampaignRail campaign={campaign} encounters={encounters} players={benchPlayers} selectedEncounter={selectedEncounter} isGm={isGm} rosterSaving={rosterSaving} onRemovePlayer={removePlayer} />
        <main className='min-w-0 overflow-auto bg-[#11171a]'>
          <EncounterHeader encounter={selectedEncounter} count={combatants.length} isGm={isGm} joinKey={isGm ? campaign.join_key : undefined} />
          {rosterError && <div className='border-b border-[#a95249]/40 bg-[#a95249]/10 px-5 py-2 text-xs text-[#efaaa3]'>Roster update failed: {rosterError.message}</div>}
          <div className='p-5'><CombatantGrid combatants={combatants} selectedId={selectedId} onSelect={setSelectedId} statuses={statuses.data} calculating={statuses.isLoading} canManageRoster={isGm && !rosterSaving} onAddPlayer={addPlayer} /></div>
        </main>
        <ResizeRail onResize={(delta) => setDetailWidth((width) => clamp(width - delta, 340, 640))} />
        <Inspector combatant={selected} width={detailWidth} activeTab={activeTab} onTab={setActiveTab} encounterNote={encounterNote} status={selected ? statuses.data?.[selected._id] : undefined} statusLoading={statuses.isLoading} canCast={isGm} onCast={castSpell} />
      </div>
    </div>
  );
}

type CombatantStatusMap = Record<string, Phase1CreatureStatus | null>;

function useCombatantStatuses(encounterId: number | null, combatants: PopulatedCombatant[]) {
  const signature = combatants.map((combatant) => `${combatant._id}:${combatant.data.hp_current}:${combatant.data.hp_temp}`).join('|');
  return useQuery({
    queryKey: ['phase1-encounter-statuses', encounterId, signature],
    enabled: encounterId !== null && combatants.length > 0,
    queryFn: async () => {
      const result: CombatantStatusMap = {};
      for (const combatant of combatants) {
        if (combatant.access?.details_revealed === false || !hasFullEntityDetails(combatant)) continue;
        try {
          result[combatant._id] = await calculateEntityStatus(combatant as Phase1EntityCombatant);
        } catch {
          result[combatant._id] = null;
        }
      }
      return result;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
function WorkspaceHeader({ label }: { label: string }) {
  return <header className='flex h-14 shrink-0 items-center gap-4 border-b border-white/10 bg-[#0b0f11] px-5'><a href='/' className='font-semibold'>Wanderer's Guide</a><span className='h-4 w-px bg-white/15' /><span className='truncate text-sm text-[#8e999f]'>{label}</span><span className='ml-auto border border-[#d6a85f]/30 px-2 py-1 text-[10px] font-semibold uppercase text-[#d6a85f]'>Phase 1</span><button className='icon-button' title='Switch account' onClick={() => supabase.auth.signOut()}><LogOut size={15} /></button></header>;
}

function CampaignRail({ campaign, encounters, players, selectedEncounter, isGm, rosterSaving, onRemovePlayer }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; selectedEncounter: Encounter | null; isGm: boolean; rosterSaving: boolean; onRemovePlayer: (combatantId: string) => void;
}) {
  const [benchActive, setBenchActive] = useState(false);
  const canManageRoster = isGm && !rosterSaving && Boolean(selectedEncounter);

  function dropOnBench(event: ReactDragEvent<HTMLDivElement>) {
    const payload = readPlayerDrag(event);
    setBenchActive(false);
    if (!canManageRoster || payload?.source !== 'encounter' || !payload.combatantId) return;
    event.preventDefault();
    onRemovePlayer(payload.combatantId);
  }

  return (
    <aside className='min-h-0 overflow-y-auto border-r border-white/10 bg-[#0f1417]'>
      <div className='border-b border-white/10 p-4'>
        <Link to='/phase1' className='mb-5 flex items-center gap-2 text-xs text-[#879198] hover:text-white'><ArrowLeft size={14} /> Campaigns</Link>
        <Eyebrow>{isGm ? 'Game master' : 'Player'}</Eyebrow><h1 className='mt-2 text-lg font-semibold leading-tight'>{campaign.name}</h1>
      </div>
      <RailLabel icon={<Swords size={14} />} label='Encounters' count={encounters.length} />
      <nav className='px-2 pb-4'>
        {encounters.map((encounter) => <Link key={encounter.id} to={`/phase1/campaign/${campaign.id}/encounters/${encounter.id}`} className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedEncounter?.id === encounter.id ? 'border-[#d6a85f] bg-white/[0.045] text-white' : 'border-transparent text-[#89949a] hover:bg-white/[0.025] hover:text-white'}`}><span className='block truncate'>{encounter.name}</span><span className='mt-0.5 block text-[11px] text-[#667178]'>{encounter.combatants.list.length} combatants</span></Link>)}
        {encounters.length === 0 && <p className='px-3 py-4 text-xs leading-5 text-[#68747a]'>No encounters are visible for this campaign.</p>}
      </nav>
      <RailLabel icon={<UsersRound size={14} />} label='Party bench' count={players.length} />
      <div className={`mx-2 min-h-16 border px-1 pb-4 pt-1 transition-colors ${benchActive ? 'border-[#d6a85f] bg-[#d6a85f]/[0.07]' : 'border-transparent'}`} onDragOver={(event) => { if (canManageRoster && hasPlayerDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setBenchActive(true); } }} onDragLeave={() => setBenchActive(false)} onDrop={dropOnBench}>
        {players.map((player) => <a key={player.id} href={`${OLD_UI_ORIGIN}/sheet/${player.id}`} target='_blank' rel='noreferrer' draggable={canManageRoster} onDragStart={(event) => writePlayerDrag(event, { source: 'bench', characterId: player.id })} onDragEnd={() => setBenchActive(false)} className='flex items-center gap-2 px-2 py-2 text-sm text-[#89949a] hover:bg-white/[0.025] hover:text-white'>{canManageRoster && <GripVertical size={14} className='shrink-0 cursor-grab text-[#59656b]' />}<UserRound size={15} /><span className='min-w-0 flex-1 truncate'>{player.name}</span><ExternalLink size={12} /></a>)}
        {players.length === 0 && <p className='px-2 py-3 text-xs text-[#68747a]'>No PCs on the bench.</p>}
      </div>
    </aside>
  );
}
function RailLabel({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
  return <div className='flex items-center gap-2 px-5 pb-2 pt-5 text-[10px] font-semibold uppercase text-[#68747a]'>{icon}{label}<span className='ml-auto'>{count}</span></div>;
}

const PLAYER_DRAG_TYPE = 'application/x-wanderers-guide-player';
type PlayerDragPayload = { source: 'bench' | 'encounter'; characterId: number; combatantId?: string };

function writePlayerDrag(event: ReactDragEvent, payload: PlayerDragPayload) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(PLAYER_DRAG_TYPE, JSON.stringify(payload));
}
function readPlayerDrag(event: ReactDragEvent): PlayerDragPayload | null {
  try {
    const value = event.dataTransfer.getData(PLAYER_DRAG_TYPE);
    return value ? JSON.parse(value) as PlayerDragPayload : null;
  } catch {
    return null;
  }
}function hasPlayerDrag(event: ReactDragEvent) {
  return Array.from(event.dataTransfer.types).includes(PLAYER_DRAG_TYPE);
}
function EncounterHeader({ encounter, count, isGm, joinKey }: { encounter: Encounter | null; count: number; isGm: boolean; joinKey?: string }) {
  const [joinKeyVisible, setJoinKeyVisible] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    setJoinKeyVisible(false);
    setCopyState('idle');
  }, [encounter?.id]);

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function revealAndCopyJoinKey() {
    if (!joinKey) return;
    setJoinKeyVisible(true);
    setCopyState((await copyToClipboard(joinKey)) ? 'copied' : 'failed');
  }

  return (
    <div className='sticky top-0 z-10 border-b border-white/10 bg-[#11171a]/95 px-5 py-4 backdrop-blur'>
      <div className='flex items-center gap-5'>
        <div className='min-w-0 flex-1'><Eyebrow>{isGm ? 'GM encounter' : 'Assigned encounter'}</Eyebrow><h2 className='mt-1 truncate text-xl font-semibold'>{encounter?.name ?? 'No encounter selected'}</h2><p className='mt-1 truncate text-xs text-[#778289]'>{encounter?.meta_data.description || `${count} combatants`}</p></div>
        {isGm && <button className='toolbar-button' disabled={!joinKey} title={joinKey ? 'Reveal and copy campaign join key' : 'No join key is available'} onClick={revealAndCopyJoinKey}>{copyState === 'copied' ? <Check size={15} /> : joinKeyVisible ? <ClipboardCopy size={15} /> : <KeyRound size={15} />}<span className={joinKeyVisible ? 'font-mono' : ''}>{joinKeyVisible ? joinKey : 'Reveal join key'}</span>{copyState === 'copied' && <span className='text-emerald-300'>Copied</span>}{copyState === 'failed' && <span className='text-red-300'>Copy failed</span>}</button>}
        <button className='toolbar-button' disabled title='Available after read-only parity'><Swords size={15} /> Roll initiative</button>
        <button className='toolbar-button' disabled title='Available after read-only parity'><Shield size={15} /> Group check</button>
      </div>
    </div>
  );
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  }
}

function CombatantGrid({ combatants, selectedId, onSelect, statuses, calculating, canManageRoster, onAddPlayer }: { combatants: PopulatedCombatant[]; selectedId: string | null; onSelect: (id: string) => void; statuses?: CombatantStatusMap; calculating: boolean; canManageRoster: boolean; onAddPlayer: (characterId: number) => void }) {
  const [encounterActive, setEncounterActive] = useState(false);
  function dropOnEncounter(event: ReactDragEvent<HTMLDivElement>) {
    const payload = readPlayerDrag(event);
    setEncounterActive(false);
    if (!canManageRoster || payload?.source !== 'bench') return;
    event.preventDefault();
    onAddPlayer(payload.characterId);
  }
  return (
    <div className={`overflow-x-auto border bg-[#0e1316] transition-colors ${encounterActive ? 'border-[#d6a85f] bg-[#d6a85f]/[0.04]' : 'border-white/10'}`} onDragOver={(event) => { if (canManageRoster && hasPlayerDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setEncounterActive(true); } }} onDragLeave={() => setEncounterActive(false)} onDrop={dropOnEncounter}>
      <table className='w-full min-w-[760px] table-fixed border-collapse text-sm'>
        <thead className='border-b border-white/10 bg-[#0b1012] text-[10px] uppercase text-[#68747a]'><tr><th className='w-20 px-3 py-3 text-left'>Init</th><th className='px-3 text-left'>Combatant</th><th className='w-64 px-3 text-left'>Defenses</th><th className='w-32 px-3 text-left'>HP</th><th className='w-16 px-3 text-center'>Open</th></tr></thead>
        <tbody>
          {combatants.map((combatant) => {
            const detailsVisible = combatant.access?.details_revealed !== false;
            const calculable = detailsVisible && hasFullEntityDetails(combatant);
            const calculated = statuses?.[combatant._id];
            const stats = calculated ?? (!calculable ? fallbackStatus(combatant.data) : null);
            const draggable = canManageRoster && combatant.type === 'CHARACTER' && typeof combatant.character === 'number';
            return (
              <tr key={combatant._id} draggable={draggable} onDragStart={(event) => { if (draggable && typeof combatant.character === 'number') writePlayerDrag(event, { source: 'encounter', characterId: combatant.character, combatantId: combatant._id }); }} onDragEnd={() => setEncounterActive(false)} className={`border-b border-white/[0.07] last:border-0 ${draggable ? 'cursor-grab' : ''} ${combatant._id === selectedId ? 'bg-[#d6a85f]/[0.07]' : 'hover:bg-white/[0.025]'}`}>
                <td className='px-3 py-3'><input className='h-9 w-14 border border-white/10 bg-[#11181b] px-2 text-center text-[#bdc5c9]' type='number' value={combatant.initiative ?? ''} readOnly disabled aria-label={`${combatant.data.name} initiative`} /></td>
                <td className='px-3 py-3'><button className='flex w-full items-center gap-3 text-left' onClick={() => openCombatant(combatant, onSelect)}>{draggable && <GripVertical size={14} className='shrink-0 text-[#59656b]' />}<EntityIcon type={combatant.type} /><span className='min-w-0'><span className='block truncate font-semibold'>{combatant.data.name}</span><span className='block text-xs text-[#68747a]'>Level {combatant.data.level} | {combatant.ally ? 'Ally' : 'Enemy'}</span></span></button></td>
                <td className='px-3 py-3 text-xs text-[#89949a]'>{!detailsVisible ? <span className='text-[#59656b]'>Not revealed</span> : stats ? <>{stats.ac} AC <span className='px-1 text-[#455057]'>|</span> Fort {signed(stats.fortitude)}, Ref {signed(stats.reflex)}, Will {signed(stats.will)}</> : calculating ? <span className='text-[#68747a]'>Calculating...</span> : <span className='text-[#a87a70]'>Unavailable</span>}</td>
                <td className='px-3 py-3'><span className='inline-flex h-9 min-w-24 items-center justify-center border border-white/10 bg-[#11181b]'>{!detailsVisible ? <span className='text-[#59656b]'>Hidden</span> : stats ? <>{combatant.data.hp_current}<span className='px-2 text-[#59656b]'>/</span>{stats.maxHp}</> : calculating ? <span className='text-[#68747a]'>...</span> : <>{combatant.data.hp_current}<span className='px-2 text-[#59656b]'>/</span>-</>}</span></td>
                <td className='px-3 text-center'><button className='icon-button mx-auto' title={`Open ${combatant.data.name}`} onClick={() => openCombatant(combatant, onSelect)}><PanelRight size={16} /></button></td>
              </tr>
            );
          })}
          {combatants.length === 0 && <tr><td colSpan={5} className='p-12 text-center text-sm text-[#68747a]'>No combatants in this encounter.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
function openCombatant(combatant: PopulatedCombatant, onSelect: (id: string) => void) {
  if (combatant.access?.details_revealed === false) return;
  onSelect(combatant._id);
}

function Inspector({ combatant, width, activeTab, onTab, encounterNote, status, statusLoading, canCast, onCast }: {
  combatant: PopulatedCombatant | null; width: number; activeTab: DetailTab; onTab: (tab: DetailTab) => void; encounterNote?: { name: string; contents: unknown }; status?: Phase1CreatureStatus | null; statusLoading: boolean; canCast: boolean; onCast: (entry: Phase1SpellEntry) => Promise<void>;
}) {
  return (
    <aside className='min-h-0 overflow-hidden bg-[#0c1113]' style={{ width }}>
      {!combatant ? (
        <div className='flex h-full flex-col items-center justify-center px-8 text-center'><PanelRight className='mb-4 text-[#465158]' size={28} /><p className='text-sm font-semibold'>Select a combatant</p><p className='mt-2 max-w-56 text-xs leading-5 text-[#68747a]'>PCs, NPCs, and creatures open in this shared read-only inspector.</p></div>
      ) : (
        <div className='flex h-full min-w-[340px] flex-col'>
<div className='flex items-start gap-3 border-b border-white/10 px-4 py-3.5'><div className='min-w-0 flex-1'><Eyebrow>{combatant.type === 'CREATURE' ? (combatant.ally ? 'NPC / Creature' : 'Creature') : 'Player character'}</Eyebrow><h2 className='mt-1 truncate text-lg font-semibold leading-tight'>{combatant.data.name}</h2><p className='mt-1 text-xs text-[#748087]'>Level {combatant.data.level} | {canCast ? 'GM controls' : 'Read only'}</p></div>{combatant.type === 'CHARACTER' && combatant.data.id && <a className='icon-button shrink-0' href={`${OLD_UI_ORIGIN}/sheet/${combatant.data.id}`} target='_blank' rel='noreferrer' title='Open full character sheet'><ExternalLink size={16} /></a>}</div>
          <div className='grid grid-cols-4 border-b border-white/10 bg-[#0a0e10]'>
            {DETAIL_TABS.map((tab) => <button key={tab} className={`border-b-2 px-2 py-2.5 text-[11px] ${activeTab === tab ? 'border-[#d6a85f] text-[#f0d29d]' : 'border-transparent text-[#748087] hover:text-white'}`} onClick={() => onTab(tab)}>{tab}</button>)}
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto p-4'><InspectorContent combatant={combatant} tab={activeTab} encounterNote={encounterNote} status={status} statusLoading={statusLoading} canCast={canCast} onCast={onCast} /></div>
        </div>
      )}
    </aside>
  );
}

function InspectorContent({ combatant, tab, encounterNote, status, statusLoading, canCast, onCast }: { combatant: PopulatedCombatant; tab: DetailTab; encounterNote?: { name: string; contents: unknown }; status?: Phase1CreatureStatus | null; statusLoading: boolean; canCast: boolean; onCast: (entry: Phase1SpellEntry) => Promise<void> }) {
  const entity = combatant.data;
  if (tab === 'Health') return <HealthStatusPanel combatant={combatant} calculatedStatus={status} calculating={statusLoading} />;
  if (tab === 'Abilities') return <AbilitiesPanel combatant={combatant} />;
  if (tab === 'Skills') return <SkillsActionsPanel combatant={combatant} />;
  if (tab === 'Spells') return <SpellsPanel combatant={combatant} canCast={canCast} onCast={onCast} />;
  if (tab === 'Notes' && encounterNote) return <DataSection title={encounterNote.name} data={encounterNote.contents} />;
  const source: Record<DetailTab, unknown> = {
    Health: entity,
    Abilities: (entity as any).abilities_base ?? (entity as any).operations,
    Skills: entity.meta_data?.calculated_stats?.profs,
    Inventory: entity.inventory,
    Spells: entity.spells,
    Notes: entity.notes,
    Details: entity.details,
  };
  return <DataSection title={tab} data={source[tab]} />;
}

function SkillsActionsPanel({ combatant }: { combatant: PopulatedCombatant }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [innerTab, setInnerTab] = useState<'skills' | 'actions'>('skills');
  const [skillQuery, setSkillQuery] = useState('');
  const [actionQuery, setActionQuery] = useState('');
  const [actionCost, setActionCost] = useState<string>('ALL');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<Phase1Ability | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Phase1Skill | null>(null);
  const data = useQuery({
    queryKey: ['phase1-entity-skills-actions', combatant.type, combatant._id],
    enabled: detailsAvailable && combatant.access?.details_revealed !== false,
    queryFn: () => loadEntitySkillsActions(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const skills = (data.data?.skills ?? []).filter((skill) => skill.name.toLowerCase().includes(skillQuery.trim().toLowerCase()));
  const groups = (data.data?.groups ?? []).map((group) => ({
    ...group,
    actions: group.actions.filter((ability) => {
      const needle = actionQuery.trim().toLowerCase();
      const matchesText = !needle || [ability.name, ability.description, ...ability.traitNames].join(' ').toLowerCase().includes(needle);
      return matchesText && (actionCost === 'ALL' || ability.actions === actionCost);
    }),
  })).filter((group) => group.actions.length > 0);
  const filtering = Boolean(actionQuery.trim() || actionCost !== 'ALL');

  return <>
    <div className='mb-2.5 grid grid-cols-2 border-b border-white/10'>
      <InnerTab active={innerTab === 'skills'} onClick={() => setInnerTab('skills')}>Skills</InnerTab>
      <InnerTab active={innerTab === 'actions'} onClick={() => setInnerTab('actions')}>Actions / Abilities</InnerTab>
    </div>
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {data.isLoading && <EmptyState>Calculating skills and actions...</EmptyState>}
    {data.isError && <ErrorState error={data.error} />}
    {data.data && innerTab === 'skills' && <SkillsList skills={skills} query={skillQuery} onQuery={setSkillQuery} onOpen={setSelectedSkill} />}
    {data.data && innerTab === 'actions' && <ActionsCatalog groups={groups} query={actionQuery} onQuery={setActionQuery} cost={actionCost} onCost={setActionCost} openGroup={openGroup} onOpenGroup={setOpenGroup} filtering={filtering} onOpen={setSelected} />}
    {selected && <AbilityModal ability={selected} onClose={() => setSelected(null)} />}
    {selectedSkill && <SkillModal skill={selectedSkill} onClose={() => setSelectedSkill(null)} />}
  </>;
}

function InnerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={`border-b-2 px-2 py-2 text-xs ${active ? 'border-[#d6a85f] bg-white/[0.035] text-white' : 'border-transparent text-[#89949a] hover:text-white'}`} onClick={onClick}>{children}</button>;
}

function SkillsList({ skills, query, onQuery, onOpen }: { skills: Phase1Skill[]; query: string; onQuery: (value: string) => void; onOpen: (skill: Phase1Skill) => void }) {
  return <div>
    <SearchField value={query} onChange={onQuery} placeholder='Search skills' />
    <div className='mt-2 space-y-1.5'>
      {skills.map((skill) => <button key={skill.name} className='flex h-9 w-full items-center border border-white/10 bg-[#11171a] px-3 text-left text-sm hover:border-white/20 hover:bg-white/[0.045]' onClick={() => onOpen(skill)}>
        <span className='truncate'>{skill.name}</span>
        <strong className='ml-auto text-[#dce1e3]'>{signed(skill.modifier)}</strong>
        <span className='ml-3 grid h-5 min-w-6 place-items-center bg-white/[0.06] px-1.5 text-[10px] font-semibold text-[#89949a]' title={proficiencyName(skill.rank)}>{skill.rank}</span>
      </button>)}
      {!skills.length && <EmptyState>No skills found.</EmptyState>}
    </div>
  </div>;
}

type SkillModalTab = 'description' | 'actions' | 'breakdown' | 'timeline';
const SKILL_MODAL_TABS: Array<{ id: SkillModalTab; label: string; icon: ReactNode }> = [
  { id: 'description', label: 'Description', icon: <BookOpen size={15} /> },
  { id: 'actions', label: 'Skill Actions', icon: <ListChecks size={15} /> },
  { id: 'breakdown', label: 'Breakdown', icon: <Calculator size={15} /> },
  { id: 'timeline', label: 'Timeline', icon: <History size={15} /> },
];

function SkillModal({ skill, onClose }: { skill: Phase1Skill; onClose: () => void }) {
  const [tab, setTab] = useState<SkillModalTab>('description');
  const [selectedAction, setSelectedAction] = useState<Phase1Ability | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-ability-modal]')) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);

  return createPortal(
    <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby={`skill-${skill.variableName}-title`} className='flex h-[min(82vh,720px)] w-full max-w-4xl flex-col border border-white/15 bg-[#11171a] shadow-2xl'>
        <header className='flex items-start gap-4 border-b border-white/10 px-5 py-4'>
          <div className='min-w-0 flex-1'><h2 id={`skill-${skill.variableName}-title`} className='text-xl font-semibold'>{skill.name}</h2><div className='mt-2 flex items-center gap-2'><Tag>{proficiencyName(skill.rank)}</Tag><span className='text-sm font-semibold text-[#dce1e3]'>{signed(skill.modifier)}</span></div></div>
          <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close skill details'><X size={18} /></button>
        </header>
        <div className='grid grid-cols-4 border-b border-white/10 bg-[#0d1215]' role='tablist' aria-label='Skill details'>
          {SKILL_MODAL_TABS.map((item) => <button key={item.id} role='tab' aria-selected={tab === item.id} className={`flex h-11 items-center justify-center gap-2 border-b-2 px-3 text-xs ${tab === item.id ? 'border-[#d6a85f] bg-white/[0.035] text-[#f0d29d]' : 'border-transparent text-[#89949a] hover:text-white'}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto p-5'>
          {tab === 'description' && <div className='mx-auto max-w-3xl text-sm leading-7 text-[#c4cbce]'><p>{skill.description}</p></div>}
          {tab === 'actions' && <div className='mx-auto max-w-3xl space-y-1.5'>{skill.actions.map((ability, index) => <AbilityRow key={`${ability.id}-${index}`} ability={ability} onOpen={setSelectedAction} compact />)}{skill.actions.length === 0 && <EmptyState>No actions found for this skill.</EmptyState>}</div>}
          {tab === 'breakdown' && <SkillBreakdown skill={skill} />}
          {tab === 'timeline' && <SkillTimeline skill={skill} />}
        </div>
      </section>
      {selectedAction && <AbilityModal ability={selectedAction} onClose={() => setSelectedAction(null)} />}
    </div>,
    document.body
  );
}

function SkillBreakdown({ skill }: { skill: Phase1Skill }) {
  return <div className='mx-auto max-w-3xl'>
    <div className='mb-5 flex flex-wrap items-center gap-2 border border-white/10 bg-[#0d1215] px-4 py-4 text-sm'><strong className='mr-1 text-lg text-[#e2e6e8]'>{signed(skill.breakdown.final)} =</strong>{skill.breakdown.terms.map((term, index) => <span key={`${term.label}-${index}`} className='inline-flex items-center gap-2'>{index > 0 && <span className='text-[#68747a]'>{term.value >= 0 ? '+' : '-'}</span>}<span className='border border-white/15 bg-white/[0.04] px-2.5 py-1 font-mono text-[#dce1e3]' title={term.label}>{Math.abs(term.value)}</span></span>)}</div>
    <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>{skill.breakdown.terms.map((term, index) => <section key={`${term.label}-detail-${index}`} className='border border-white/10 bg-[#0d1215] p-3'><div className='flex items-center gap-3'><strong className='text-sm text-[#e2e6e8]'>{term.label}</strong><span className='ml-auto font-mono text-sm text-[#f0d29d]'>{signed(term.value)}</span></div><p className='mt-2 text-xs leading-5 text-[#89949a]'>{term.detail}</p>{term.sources?.map((source, sourceIndex) => <p key={sourceIndex} className='mt-1 text-[11px] text-[#68747a]'>{signed(source.amount)} from {source.source}</p>)}</section>)}</div>
    {skill.breakdown.conditionals.length > 0 && <section className='mt-4 border border-[#d6a85f]/30 bg-[#d6a85f]/[0.07] p-3'><h3 className='text-xs font-semibold uppercase text-[#f0d29d]'>Situational modifiers</h3>{skill.breakdown.conditionals.map((item, index) => <p key={index} className='mt-2 text-xs leading-5 text-[#bdc5c9]'>{item.text} <span className='text-[#68747a]'>from {item.source}</span></p>)}</section>}
  </div>;
}

function SkillTimeline({ skill }: { skill: Phase1Skill }) {
  if (!skill.timeline.length) return <EmptyState>No recorded history found for this proficiency.</EmptyState>;
  return <ol className='mx-auto max-w-2xl'>{skill.timeline.map((item, index) => <li key={`${item.timestamp}-${index}`} className='grid grid-cols-[28px_minmax(0,1fr)]'><span className='relative flex justify-center'><span className={`z-10 mt-1.5 h-3 w-3 border ${item.type === 'ADJUSTMENT' ? 'border-[#d6a85f] bg-[#d6a85f]' : 'border-[#82aec2] bg-[#82aec2]'}`} />{index < skill.timeline.length - 1 && <span className='absolute bottom-0 top-4 w-px bg-white/15' />}</span><div className='pb-6'><strong className='text-sm text-[#e2e6e8]'>{item.title}</strong><p className='mt-1 text-xs italic text-[#89949a]'>{item.description}</p></div></li>)}</ol>;
}
function ActionsCatalog({ groups, query, onQuery, cost, onCost, openGroup, onOpenGroup, filtering, onOpen }: {
  groups: Phase1ActionGroup[]; query: string; onQuery: (value: string) => void; cost: string; onCost: (value: string) => void;
  openGroup: string | null; onOpenGroup: (value: string | null) => void; filtering: boolean; onOpen: (ability: Phase1Ability) => void;
}) {
  const costs = ['ALL', 'ONE-ACTION', 'TWO-ACTIONS', 'THREE-ACTIONS', 'FREE-ACTION', 'REACTION'];
  return <div>
    <SearchField value={query} onChange={onQuery} placeholder='Search actions & activities' />
    <div className='my-2 flex items-center gap-1 border-b border-white/10 pb-2'>
      {costs.map((value) => <button key={value} className={`grid h-8 min-w-8 place-items-center px-2 text-[10px] ${cost === value ? 'bg-[#d6a85f] text-[#17130d]' : 'bg-white/[0.04] text-[#89949a] hover:text-white'}`} title={value === 'ALL' ? 'All action costs' : value.toLowerCase().replaceAll('-', ' ')} onClick={() => onCost(value)}>{value === 'ALL' ? 'All' : <ActionSymbol cost={value as Phase1Ability['actions']} />}</button>)}
    </div>
    <div className='space-y-1'>
      {groups.map((group) => {
        const open = filtering || openGroup === group.id;
        return <section key={group.id} className='border-b border-white/[0.07]'>
          <button className='flex h-9 w-full items-center px-1 text-left text-sm font-semibold hover:bg-white/[0.025]' onClick={() => onOpenGroup(openGroup === group.id ? null : group.id)}>
            <span className='truncate'>{group.label}</span><span className='ml-auto mr-2 border border-white/20 px-2 py-0.5 text-[10px] font-normal text-[#a5aeb2]'>{group.actions.length}</span><ChevronDown size={14} className={`text-[#7c878d] transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && <div className='space-y-1 pb-2 pt-1'>{group.actions.map((ability, index) => <AbilityRow key={`${group.id}-${ability.id}-${index}`} ability={ability} onOpen={onOpen} compact />)}</div>}
        </section>;
      })}
      {!groups.length && <EmptyState>No actions match these filters.</EmptyState>}
    </div>
  </div>;
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className='relative'><Search className='absolute left-3 top-1/2 -translate-y-1/2 text-[#68747a]' size={14} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className='h-9 w-full border border-white/10 bg-[#11171a] pl-9 pr-3 text-sm outline-none placeholder:text-[#5f6a70] focus:border-[#d6a85f]/60' /></div>;
}
function proficiencyName(rank: string) { return ({ U: 'Untrained', T: 'Trained', E: 'Expert', M: 'Master', L: 'Legendary' } as Record<string, string>)[rank] ?? rank; }
function AbilitiesPanel({ combatant }: { combatant: PopulatedCombatant }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Phase1Ability | null>(null);
  const abilities = useQuery({
    queryKey: ['phase1-entity-abilities', combatant.type, combatant._id],
    enabled: detailsAvailable && combatant.access?.details_revealed !== false,
    queryFn: () => loadEntityAbilities(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const visible = (abilities.data ?? []).filter((ability) => {
    const needle = query.trim().toLowerCase();
    return !needle || [ability.name, ability.description, ability.source, ...ability.traitNames].join(' ').toLowerCase().includes(needle);
  });

  return <>
    <div className='relative mb-2.5'>
      <Search className='absolute left-3 top-1/2 -translate-y-1/2 text-[#68747a]' size={14} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search abilities' className='h-9 w-full border border-white/10 bg-[#11171a] pl-9 pr-3 text-sm outline-none placeholder:text-[#5f6a70] focus:border-[#d6a85f]/60' />
    </div>
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {abilities.isLoading && <EmptyState>Loading abilities...</EmptyState>}
    {abilities.isError && <ErrorState error={abilities.error} />}
    {!abilities.isLoading && !visible.length && <EmptyState>No abilities found.</EmptyState>}
    {(['Base', 'Added', 'Character'] as const).map((source) => {
      const group = visible.filter((ability) => ability.source === source);
      if (!group.length) return null;
      return <section key={source} className='mb-2.5 border border-white/10 bg-[#11171a]'>
        <h3 className='border-b border-white/10 px-3 py-2 text-xs font-semibold'>{source === 'Character' ? 'Character Abilities' : source + ' Abilities'}</h3>
        <div className='divide-y divide-white/[0.07]'>
          {group.map((ability, index) => <AbilityRow key={`${ability.id}-${index}`} ability={ability} onOpen={setSelected} />)}
        </div>
      </section>;
    })}
    {selected && <AbilityModal ability={selected} onClose={() => setSelected(null)} />}
  </>;
}

function AbilityRow({ ability, onOpen, compact = false }: { ability: Phase1Ability; onOpen: (ability: Phase1Ability) => void; compact?: boolean }) {
  const kind = classifyAbility(ability);
  const preview = plainText(ability.description).slice(0, 180);
  return <button className='group relative grid w-full grid-cols-[42px_minmax(0,1fr)] items-stretch border border-white/[0.08] bg-[#11171a] text-left hover:border-white/20 hover:bg-white/[0.045] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d6a85f]' onClick={() => onOpen(ability)}>
    <span className='grid place-items-center border-r border-white/[0.07] text-[#89949a]' title={kind.label}>
      {kind.type === 'ranged' ? <Crosshair size={17} /> : kind.type === 'melee' ? <Swords size={17} /> : <Sparkles size={16} />}
      <span className='sr-only'>{kind.label}</span>
    </span>
    <span className={`flex min-w-0 items-center gap-2 px-3 ${compact ? 'py-2' : 'py-2.5'}`}>
      <ActionSymbol cost={ability.actions} />
      <span className='min-w-0 flex-1 truncate text-sm'>{ability.name}</span>
      {ability.level != null && <span className='text-[10px] text-[#68747a]'>Lvl {ability.level}</span>}
    </span>
    <span className='pointer-events-none invisible absolute left-10 right-2 top-[calc(100%+4px)] z-40 hidden border border-white/15 bg-[#171d20] p-3 opacity-0 shadow-xl transition-opacity delay-300 group-hover:visible group-hover:opacity-100 md:block'>
      <span className='flex items-center gap-2 text-xs font-semibold text-[#e1e5e7]'><ActionSymbol cost={ability.actions} />{ability.name}</span>
      {ability.traitNames.length > 0 && <span className='mt-1.5 block truncate text-[9px] uppercase text-[#8e999f]'>{ability.traitNames.join(' | ')}</span>}
      <span className='mt-2 block text-[11px] leading-4 text-[#aeb7bc]'>{preview}{plainText(ability.description).length > preview.length ? '...' : ''}</span>
    </span>
  </button>;
}
function AbilityModal({ ability, onClose }: { ability: Phase1Ability; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);
  const wide = ability.description.length > 900;

  return createPortal(
    <div data-ability-modal className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby={`ability-${ability.id}-title`} className={`flex max-h-[min(82vh,820px)] w-full flex-col border border-white/15 bg-[#11171a] shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <header className='flex items-start gap-4 border-b border-white/10 px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'><ActionSymbol cost={ability.actions} large /><h2 id={`ability-${ability.id}-title`} className='text-xl font-semibold leading-tight'>{ability.name}</h2></div>
            <div className='mt-2 flex flex-wrap gap-1.5'><Tag>{ability.rarity}</Tag>{ability.type !== 'action' && <Tag>{ability.type}</Tag>}{ability.traitNames.map((trait) => <Tag key={trait}>{trait}</Tag>)}</div>
          </div>
          <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close ability'><X size={18} /></button>
        </header>
        <div className='min-h-0 overflow-y-auto px-5 py-4'>
          <div className='mb-4 space-y-1 text-sm leading-6'>
            <AbilityFact label='Prerequisites' value={ability.prerequisites?.join(', ')} />
            <AbilityFact label='Frequency' value={ability.frequency} />
            <AbilityFact label='Trigger' value={ability.trigger} />
            <AbilityFact label='Cost' value={ability.cost} />
            <AbilityFact label='Requirements' value={ability.requirements} />
            <AbilityFact label='Access' value={ability.access} />
          </div>
          <div className='ability-prose text-sm leading-7 text-[#c4cbce]'><ReactMarkdown>{ability.description}</ReactMarkdown></div>
          {ability.special && <div className='mt-4 border-t border-white/10 pt-4 text-sm leading-7 text-[#c4cbce]'><strong className='mr-2 text-[#e2e6e8]'>Special</strong><ReactMarkdown>{ability.special}</ReactMarkdown></div>}
        </div>
      </section>
    </div>,
    document.body
  );
}

function ActionSymbol({ cost, large = false }: { cost: string | null | undefined; large?: boolean }) {
  const symbols: Record<string, string> = { 'ONE-ACTION': '1', 'TWO-ACTIONS': '2', 'THREE-ACTIONS': '3', 'FREE-ACTION': '4', REACTION: '5' };
  const ranges: Record<string, string> = { 'ONE-TO-TWO-ACTIONS': '1 to 2', 'ONE-TO-THREE-ACTIONS': '1 to 3', 'TWO-TO-THREE-ACTIONS': '2 to 3' };
  if (!cost) return null;
  const label = cost.toLowerCase().replaceAll('-', ' ');
  if (ranges[cost]) return <span className='whitespace-nowrap text-[10px] text-[#89949a]' title={label}>{ranges[cost].split(' ').map((part, index) => part === 'to' ? <span key={index} className='mx-1 font-sans'>to</span> : <span key={index} style={{ fontFamily: 'ActionIcons, sans-serif' }} className={large ? 'text-2xl' : 'text-lg'}>{part}</span>)}</span>;
  return symbols[cost] ? <span style={{ fontFamily: 'ActionIcons, sans-serif' }} className={`shrink-0 text-[#9da7ac] ${large ? 'text-3xl' : 'text-xl'}`} title={label} aria-label={label}>{symbols[cost]}</span> : <span className='text-[10px] text-[#89949a]'>{cost}</span>;
}

function AbilityFact({ label, value }: { label: string; value?: string | null }) {
  return value ? <div><strong className='mr-2 text-[#e2e6e8]'>{label}</strong><span className='text-[#aeb7bc]'>{value}</span></div> : null;
}
function Tag({ children }: { children: ReactNode }) { return <span className='border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-[#98a2a7]'>{children}</span>; }
function plainText(value: string) { return value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#>~|-]/g, ' ').replace(/\s+/g, ' ').trim(); }
function classifyAbility(ability: Phase1Ability) {
  const text = `${ability.name} ${ability.description} ${ability.requirements ?? ''}`.toLowerCase();
  if (/\branged\b/.test(text)) return { type: 'ranged' as const, label: 'Ranged ability' };
  if (/\bmelee\b/.test(text)) return { type: 'melee' as const, label: 'Melee ability' };
  return { type: 'feature' as const, label: 'General ability' };
}
function HealthStatusPanel({ combatant, calculatedStatus, calculating }: { combatant: PopulatedCombatant; calculatedStatus?: Phase1CreatureStatus | null; calculating: boolean }) {
  const entity = combatant.data;
  const status = calculatedStatus ?? fallbackStatus(entity);  const resistanceSummary = status.resistances.length + status.weaknesses.length + status.immunities.length;

  return (
    <div className='space-y-2.5'>
      <div className='grid grid-cols-[minmax(0,1fr)_86px] gap-2.5'>
        <section className='border border-white/10 bg-[#11171a]'>
          <div className='grid grid-cols-2 px-3 py-3 text-center'>
            <Metric label='Hit points' value={<><span className='text-[#5bd6a2]'>{entity.hp_current}</span><span className='mx-1.5 text-[#59656b]'>/</span>{status.maxHp}</>} />
            <Metric label='Temp. HP' value={entity.hp_temp || '-'} />
          </div>
          <div className='border-t border-white/[0.07] px-3 py-2 text-center text-[10px] text-[#7d898f]'>
            {resistanceSummary ? 'Resistances, weaknesses & immunities' : 'No resistances or weaknesses'}
          </div>
        </section>
        <CreaturePortrait entity={entity} />
      </div>

      {resistanceSummary > 0 && (
        <section className='border border-white/10 bg-[#11171a] px-3 py-2 text-[11px] leading-5'>
          <StatusLine label='Resist' values={status.resistances} />
          <StatusLine label='Weak' values={status.weaknesses} />
          <StatusLine label='Immune' values={status.immunities} />
        </section>
      )}

      {combatant.type === 'CREATURE' && <section className='border border-white/10 bg-[#11171a] px-3 py-2 text-center text-[11px] text-[#aeb7bc]'>
        {status.recallKnowledge ? <><strong className='font-semibold text-[#d5dadd]'>Recall Knowledge</strong> <span className='italic text-[#89949a]'>({[status.recallKnowledge.trait, status.recallKnowledge.rarity].filter(Boolean).join(', ')})</span> {status.recallKnowledge.skill} DC {status.recallKnowledge.dc}</> : <span className='text-[#68747a]'>Recall Knowledge unavailable</span>}
      </section>}

      <section className='grid grid-cols-3 divide-x divide-white/10 border border-white/10 bg-[#11171a]'>
        <IconMetric icon={<Eye size={15} />} label='Perception' value={signed(status.perception)} detail={status.vision} />
        <IconMetric icon={<Footprints size={15} />} label='Speed' value={status.speed ? `${status.speed} ft.` : '-'} detail={status.otherSpeeds.join(', ') || 'Land speed'} />
        <IconMetric icon={<Activity size={15} />} label='Conditions' value={status.conditions.length || '-'} detail={status.conditions.join(', ') || 'None active'} />
      </section>

      <section className='grid grid-cols-[42%_58%] border border-white/10 bg-[#11171a]'>
        <div className='grid place-items-center border-r border-white/10 px-3 py-3 text-center'>
          <Shield size={26} className='mb-1 text-[#59656b]' />
          <strong className='text-xl leading-none'>{status.ac}</strong>
          <span className='mt-1 text-[9px] uppercase text-[#68747a]'>Armor class</span>
        </div>
        <div className='divide-y divide-white/[0.07] px-3 py-1.5'>
          <DefenseRow label='Fortitude' value={status.fortitude} />
          <DefenseRow label='Reflex' value={status.reflex} />
          <DefenseRow label='Will' value={status.will} />
        </div>
      </section>

      <section className='grid grid-cols-2 gap-x-2 gap-y-1.5 border border-white/10 bg-[#11171a] p-3'>
        {ATTRIBUTE_LABELS.map(([key, label]) => <AttributePill key={key} label={label} value={status.attributes[key]} />)}
      </section>

      {calculating && !calculatedStatus && <p className='text-center text-[10px] text-[#68747a]'>Calculating combatant statistics...</p>}
      {calculatedStatus === null && <p className='text-center text-[10px] text-[#a87a70]'>Using stored values; calculated statistics were unavailable.</p>}
    </div>
  );
}

const ATTRIBUTE_LABELS: Array<[keyof Phase1CreatureStatus['attributes'], string]> = [
  ['strength', 'Strength'], ['intelligence', 'Intelligence'],
  ['dexterity', 'Dexterity'], ['wisdom', 'Wisdom'],
  ['constitution', 'Constitution'], ['charisma', 'Charisma'],
];

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div><div className='text-xs text-[#b8c0c4]'>{label}</div><div className='mt-1 text-lg font-semibold'>{value}</div></div>;
}
function IconMetric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: ReactNode; detail: string }) {
  return <div className='min-w-0 px-2 py-3 text-center'><div className='flex items-center justify-center gap-1.5 text-xs text-[#b8c0c4]'>{icon}{label}</div><div className='mt-1 text-lg font-semibold'>{value}</div><div className='mt-1 truncate text-[9px] text-[#68747a]' title={detail}>{detail}</div></div>;
}
function DefenseRow({ label, value }: { label: string; value: number }) {
  return <div className='flex items-center py-1.5 text-xs'><span className='text-[#aab3b7]'>{label}</span><strong className='ml-auto'>{signed(value)}</strong></div>;
}
function AttributePill({ label, value }: { label: string; value: number }) {
  return <div className='flex h-6 items-center bg-white/[0.045] px-2 text-[11px]'><span className='truncate text-[#b1b9bd]'>{label}</span><strong className='ml-auto pl-2'>{signed(value)}</strong></div>;
}
function StatusLine({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return <div><span className='mr-2 font-semibold text-[#8f999e]'>{label}</span><span className='text-[#c3c9cc]'>{values.join(', ')}</span></div>;
}
function CreaturePortrait({ entity }: { entity: LivingEntity }) {
  const [failed, setFailed] = useState(false);
  const src = entity.details?.image_url;
  useEffect(() => setFailed(false), [src]);
  return <div className='grid min-h-[96px] place-items-center overflow-hidden border border-white/10 bg-[#11171a]'>{src && !failed ? <img src={src} alt='' className='h-full max-h-28 w-full object-contain p-1.5' onError={() => setFailed(true)} /> : <Swords size={24} className='text-[#4c585e]' />}</div>;
}
function fallbackStatus(entity: LivingEntity): Phase1CreatureStatus {
  const stats = statsFor(entity);
  return {
    maxHp: stats.maxHp, ac: stats.ac, fortitude: stats.fort, reflex: stats.reflex, will: stats.will,
    perception: 0, speed: 0, otherSpeeds: [], vision: 'Normal vision',
    attributes: { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 },
    conditions: entity.details?.conditions?.map((condition) => condition.value ? `${condition.name} ${condition.value}` : condition.name) ?? [],
    resistances: [], weaknesses: [], immunities: [], recallKnowledge: null,
  };
}
function SpellsPanel({ combatant, canCast, onCast }: { combatant: PopulatedCombatant; canCast: boolean; onCast: (entry: Phase1SpellEntry) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Phase1SpellEntry | null>(null);
  const [casting, setCasting] = useState<string | null>(null);
  const [castError, setCastError] = useState('');
  const detailsAvailable = hasFullEntityDetails(combatant);
  const data = useQuery({
    queryKey: ['phase1-entity-spells', combatant.type, combatant._id, JSON.stringify(combatant.data.spells ?? null)],
    enabled: detailsAvailable && combatant.access?.details_revealed !== false,
    queryFn: () => loadEntitySpells(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const needle = query.trim().toLowerCase();
  const sections = (data.data ?? []).map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => !needle || [entry.spell.name, entry.spell.description, ...entry.traitNames].join(' ').toLowerCase().includes(needle)),
  })).filter((section) => section.entries.length > 0);

  async function cast(entry: Phase1SpellEntry) {
    if (!canCast || !entry.available || casting) return;
    setCasting(entry.key);
    setCastError('');
    try {
      await onCast(entry);
      setSelected(null);
    } catch (error) {
      setCastError(error instanceof Error ? error.message : 'Spell cast could not be saved.');
    } finally {
      setCasting(null);
    }
  }

  return <>
    <SearchField value={query} onChange={setQuery} placeholder='Search spells' />
    {castError && <div className='mt-2 border border-[#a95249]/40 bg-[#a95249]/10 px-3 py-2 text-xs text-[#efaaa3]'>{castError}</div>}
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {data.isLoading && <EmptyState>Loading spellcasting...</EmptyState>}
    {data.isError && <ErrorState error={data.error} />}
    <div className='mt-3 space-y-3'>
      {sections.map((section) => <SpellSection key={section.key} section={section} canCast={canCast} casting={casting} onOpen={setSelected} onCast={cast} />)}
      {data.data && !sections.length && <EmptyState>{needle ? 'No spells match this search.' : 'No spells found.'}</EmptyState>}
    </div>
    {selected && <SpellModal entry={selected} canCast={canCast} casting={casting === selected.key} onCast={cast} onClose={() => setSelected(null)} />}
  </>;
}

function SpellSection({ section, canCast, casting, onOpen, onCast }: { section: Phase1SpellSection; canCast: boolean; casting: string | null; onOpen: (entry: Phase1SpellEntry) => void; onCast: (entry: Phase1SpellEntry) => Promise<void> }) {
  const ranks = [...new Set(section.entries.map((entry) => entry.cantrip ? -1 : entry.rank))].sort((a, b) => a - b);
  return <section className='border border-white/10 bg-[#11171a]'>
    <header className='border-b border-white/10 px-3 py-2.5'>
      <div className='flex items-center gap-2'><WandSparkles size={14} className='text-[#d6a85f]' /><h3 className='truncate text-sm font-semibold'>{section.label}</h3><Tag>{section.mode.toLowerCase()}</Tag></div>
      {(section.attack != null || section.dc != null) && <div className='mt-2 flex gap-2 text-[11px] text-[#9ca6ab]'>{section.attack != null && <span className='border border-white/10 bg-white/[0.035] px-2 py-1'>Spell attack <strong className='ml-1 text-[#e1e5e7]'>{signed(section.attack)}</strong></span>}{section.dc != null && <span className='border border-white/10 bg-white/[0.035] px-2 py-1'>Spell DC <strong className='ml-1 text-[#e1e5e7]'>{section.dc}</strong></span>}</div>}
    </header>
    <div className='divide-y divide-white/[0.07]'>
      {ranks.map((rank) => {
        const entries = section.entries.filter((entry) => (entry.cantrip ? -1 : entry.rank) === rank);
        const slots = rank < 0 ? [] : section.slots.filter((slot) => slot.rank === rank);
        return <div key={rank}>
          <div className='flex h-8 items-center gap-2 bg-[#0d1215] px-3 text-xs font-semibold text-[#b8c0c4]'>
            <span>{rank < 0 ? 'Cantrips' : rankLabel(rank)}</span>
            {slots.length > 0 && <span className='flex gap-1' aria-label={slots.map((slot) => slot.exhausted ? 'used' : 'available').join(', ')}>{slots.map((slot, index) => <span key={index} className={`h-3 w-3 border ${slot.exhausted ? 'border-[#4e595f] bg-[#4e595f]' : 'border-[#aab4b9]'}`} />)}</span>}
            <span className='ml-auto border border-white/15 px-1.5 py-0.5 text-[9px] font-normal text-[#89949a]'>{entries.length}</span>
          </div>
          <div className='divide-y divide-white/[0.06]'>{entries.map((entry) => <SpellRow key={entry.key} entry={entry} canCast={canCast} casting={casting === entry.key} onOpen={onOpen} onCast={onCast} />)}</div>
        </div>;
      })}
    </div>
  </section>;
}

function SpellRow({ entry, canCast, casting, onOpen, onCast }: { entry: Phase1SpellEntry; canCast: boolean; casting: boolean; onOpen: (entry: Phase1SpellEntry) => void; onCast: (entry: Phase1SpellEntry) => Promise<void> }) {
  return <div className='flex min-h-10 items-center gap-2 px-3 py-1.5 hover:bg-white/[0.025]'>
    <button className='flex min-w-0 flex-1 items-center gap-2 text-left' onClick={() => onOpen(entry)}>
      <ActionSymbol cost={entry.spell.cast} />
      <span className='min-w-0 flex-1'><span className='block truncate text-sm font-medium'>{entry.spell.name}</span><span className='mt-0.5 block truncate text-[9px] uppercase text-[#727e84]'>{entry.traitNames.join(' | ') || entry.spell.traditions.join(' | ')}</span></span>
      {entry.usesMax != null && <span className='text-[10px] text-[#89949a]'>{entry.usesCurrent}/{entry.usesMax}</span>}
    </button>
    {canCast && <button className='h-7 shrink-0 border border-[#d6a85f]/40 px-2.5 text-[10px] font-semibold text-[#f0d29d] hover:bg-[#d6a85f]/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-[#59656b]' disabled={!entry.available || casting} onClick={() => onCast(entry)}>{casting ? 'Casting...' : entry.available ? 'Cast' : 'Spent'}</button>}
  </div>;
}

function SpellModal({ entry, canCast, casting, onCast, onClose }: { entry: Phase1SpellEntry; canCast: boolean; casting: boolean; onCast: (entry: Phase1SpellEntry) => Promise<void>; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);
  const spell = entry.spell;
  return createPortal(
    <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby={`spell-${spell.id}-title`} className='flex max-h-[min(84vh,840px)] w-full max-w-3xl flex-col border border-white/15 bg-[#11171a] shadow-2xl'>
        <header className='flex items-start gap-4 border-b border-white/10 px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'><ActionSymbol cost={spell.cast} large /><h2 id={`spell-${spell.id}-title`} className='text-xl font-semibold leading-tight'>{spell.name}</h2></div>
            <div className='mt-2 flex flex-wrap gap-1.5'><Tag>{entry.cantrip ? 'Cantrip' : rankLabel(entry.rank)}</Tag><Tag>{spell.rarity}</Tag>{entry.traitNames.map((trait) => <Tag key={trait}>{trait}</Tag>)}</div>
          </div>
          {canCast && <button className='h-8 shrink-0 border border-[#d6a85f]/50 bg-[#d6a85f] px-3 text-xs font-semibold text-[#17130d] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-[#59656b]' disabled={!entry.available || casting} onClick={() => onCast(entry)}>{casting ? 'Casting...' : entry.available ? `Cast ${entry.cantrip ? 'Cantrip' : rankLabel(entry.rank)}` : 'No uses remaining'}</button>}
          <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close spell details'><X size={18} /></button>
        </header>
        <div className='min-h-0 overflow-y-auto px-5 py-4'>
          <div className='mb-4 space-y-1 border-b border-white/10 pb-4 text-sm leading-6'>
            <AbilityFact label='Traditions' value={spell.traditions.join(', ')} />
            <AbilityFact label='Defense' value={spell.defense} />
            <AbilityFact label='Cost' value={spell.cost} />
            <AbilityFact label='Trigger' value={spell.trigger} />
            <AbilityFact label='Requirements' value={spell.requirements} />
            <AbilityFact label='Range' value={spell.range} />
            <AbilityFact label='Area' value={spell.area} />
            <AbilityFact label='Targets' value={spell.targets} />
            <AbilityFact label='Duration' value={spell.duration} />
          </div>
          <div className='ability-prose text-sm leading-7 text-[#c4cbce]'><ReactMarkdown>{spell.description}</ReactMarkdown></div>
          {spell.heightened?.text?.map((heightened, index) => <div key={index} className='mt-4 border-t border-white/10 pt-4 text-sm leading-7 text-[#c4cbce]'><strong className='mr-2 text-[#e2e6e8]'>Heightened ({heightened.amount})</strong><ReactMarkdown>{heightened.text}</ReactMarkdown></div>)}
        </div>
      </section>
    </div>,
    document.body
  );
}

function rankLabel(rank: number) {
  if (rank === 0) return 'Cantrip';
  const mod = rank % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}
function DataSection({ title, data }: { title: string; data: unknown }) {
  return <section><h3 className='mb-3 text-xs font-semibold uppercase text-[#89949a]'>{title}</h3><pre className='whitespace-pre-wrap break-words border border-white/10 bg-[#11171a] p-4 font-mono text-xs leading-5 text-[#aeb7bc]'>{data == null ? 'No data available.' : typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre></section>;
}

function ResizeRail({ onResize }: { onResize: (delta: number) => void }) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: MouseEvent) => onResize(event.movementX);
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging, onResize]);
  return <button aria-label='Resize detail panel' className='cursor-col-resize bg-[#20292e] hover:bg-[#d6a85f]' onMouseDown={() => setDragging(true)} />;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setError(result.error.message);
    setBusy(false);
  }
  return (
    <div className='grid min-h-screen place-items-center bg-[#0d1114] px-6 text-[#e7ebed]'>
      <form onSubmit={submit} className='w-full max-w-sm border border-white/10 bg-[#11171a] p-7'>
        <Eyebrow>Phase 1</Eyebrow><h1 className='mt-2 text-2xl font-semibold'>Sign in</h1><p className='mt-2 text-sm text-[#7f8a90]'>This parallel UI uses the same account and backend.</p>
        <label className='mt-6 block text-xs text-[#89949a]'>Email<input className='mt-2 h-10 w-full border border-white/10 bg-[#0b1012] px-3 text-white' type='email' required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className='mt-4 block text-xs text-[#89949a]'>Password<input className='mt-2 h-10 w-full border border-white/10 bg-[#0b1012] px-3 text-white' type='password' required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className='mt-4 text-xs text-[#ef8f86]'>{error}</p>}
        <button className='mt-6 h-10 w-full bg-[#d6a85f] font-semibold text-[#15120d] hover:bg-[#e4ba76] disabled:opacity-50' disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <a href='/' className='mt-5 block text-center text-xs text-[#7f8a90] hover:text-white'>Back to interface chooser</a>
      </form>
    </div>
  );
}

function EntityIcon({ type }: { type: Combatant['type'] }) {
  return <span className={`grid h-9 w-9 shrink-0 place-items-center border ${type === 'CREATURE' ? 'border-[#9e574f]/50 text-[#dc8c83]' : 'border-[#527485]/50 text-[#82aec2]'}`}>{type === 'CREATURE' ? <Swords size={16} /> : <UserRound size={16} />}</span>;
}
function Eyebrow({ children }: { children: ReactNode }) { return <div className='text-[10px] font-semibold uppercase text-[#d6a85f]'>{children}</div>; }
function EmptyState({ children }: { children: ReactNode }) { return <div className='border border-white/10 p-8 text-center text-sm text-[#7f8a90]'>{children}</div>; }
function ErrorState({ error }: { error: Error }) { return <div className='border border-[#a95249]/40 bg-[#a95249]/10 p-4 text-sm text-[#efaaa3]'>{error.message}</div>; }
function PageError({ error }: { error: Error }) { return <div className='min-h-screen bg-[#0d1114] p-8 text-[#e7ebed]'><Link to='/phase1' className='text-sm text-[#d6a85f]'>Back to campaigns</Link><div className='mt-6 max-w-xl'><ErrorState error={error} /></div></div>; }
function LoadingScreen({ label }: { label: string }) { return <div className='grid min-h-screen place-items-center bg-[#0d1114] text-sm text-[#7f8a90]'>{label}...</div>; }

function populateCombatants(combatants: Combatant[], players: Character[]): PopulatedCombatant[] {
  return combatants.map((combatant) => {
    const data = combatant.type === 'CHARACTER' ? players.find((player) => player.id === combatant.character) ?? combatant.data : combatant.creature ?? combatant.data;
    return data ? { ...combatant, data } : null;
  }).filter((combatant): combatant is PopulatedCombatant => Boolean(combatant));
}
function hasFullEntityDetails(combatant: PopulatedCombatant) {
  return combatant.type === 'CREATURE' || Boolean((combatant.data as Partial<Character>).user_id);
}
function statsFor(entity: LivingEntity) {
  const profs = entity.meta_data?.calculated_stats?.profs;
  return { ac: entity.meta_data?.calculated_stats?.ac ?? 10, fort: profs?.SAVE_FORT?.total ?? 0, reflex: profs?.SAVE_REFLEX?.total ?? 0, will: profs?.SAVE_WILL?.total ?? 0, maxHp: entity.meta_data?.calculated_stats?.hp_max ?? entity.hp_current };
}
function signed(value: number) { return value >= 0 ? `+${value}` : String(value); }
function uniqueById(campaigns: Campaign[]) { return [...new Map(campaigns.map((campaign) => [campaign.id, campaign])).values()]; }
function isNumber(value: number | null): value is number { return typeof value === 'number'; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function readDetailWidth() {
  const stored = Number(window.localStorage.getItem(DETAIL_WIDTH_KEY));
  return clamp(Number.isFinite(stored) && stored > 0 ? stored : 420, 340, 640);
}
















