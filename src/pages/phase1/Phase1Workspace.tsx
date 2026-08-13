import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, BookOpen, Calculator, Check, ChevronDown, ChevronRight, ClipboardCopy, Copy, Crosshair, Eye, ExternalLink, Footprints, GripVertical, History, KeyRound, ListChecks, LogOut, Package, PanelRight, Plus, Search, Shield, Sparkles, Swords, Trash2, UserMinus, UserRound, UsersRound, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { Campaign, Character, Combatant, Condition, Encounter, LivingEntity } from '@schemas/content';
import { supabase } from '../../supabase-client';
import { phase1Request } from './phase1-api';
import { loadEntityAbilities, type Phase1Ability } from './phase1-abilities';
import { calculateEntityStatus, type Phase1CreatureStatus } from './phase1-stats';
import type { Phase1EntityCombatant } from './phase1-entity';
import { loadEntitySkillsActions, type Phase1ActionGroup, type Phase1Skill } from './phase1-skills';
import {
  loadEntitySpells,
  setEntityFocusSpent,
  setEntityInnateSpent,
  setEntityPreparedEntrySpent,
  setEntitySpellCast,
  setEntitySpellRankSpent,
  type Phase1SpellEntry,
  type Phase1SpellSection,
} from './phase1-spells';
import { flattenInvItems, loadEntityInventory, matchesInvItem, type Phase1InvItem } from './phase1-inventory';
import { EntityNotesPanel, ProseMarkdown, SourceImportNotesPanel, noteContentsToMarkdown } from './phase1-markdown';
import { isContentStackOpen } from './phase1-content-links';
import { toGmNotes } from '@pages/character_sheet/panels/gm-notes';
import { lookupMonsterArt, type Phase1MonsterArt } from './phase1-monster-image';
import { compiledConditions, getConditionByName } from '@conditions/condition-handler';
import { ConditionDetailModal, SelectConditionModal } from './phase1-conditions';
import { ActionSymbol } from '@common/Actions';
import { abilityNameAndCost } from '@utils/actions';
import { toStandard2eProse } from '@utils/foundry-text';

type Phase1SpellActions = {
  setCast: (entry: Phase1SpellEntry, cast: boolean) => Promise<void>;
  setRankSpent: (section: Phase1SpellSection, rank: number, spent: number) => Promise<void>;
  setPreparedSpent: (entry: Phase1SpellEntry, spent: boolean) => Promise<void>;
  setFocusSpent: (section: Phase1SpellSection, spent: number) => Promise<void>;
  setInnateSpent: (entry: Phase1SpellEntry, castsCurrent: number) => Promise<void>;
};
type CampaignNotePage = NonNullable<Campaign['notes']>['pages'][number];
type IndexedNotePage = { page: CampaignNotePage; index: number };

const OLD_UI_ORIGIN = import.meta.env.VITE_OLD_UI_ORIGIN || 'http://localhost:5193';
const DETAIL_WIDTH_KEY = 'phase1-detail-width';
const DETAIL_WIDTH_MIN = 340;
const DETAIL_WIDTH_MAX = 1200;
const DETAIL_WIDTH_DEFAULT = 560;
const DETAIL_TABS = ['Health', 'Abilities', 'Skills', 'Inventory', 'Spells', 'GM Notes', 'Source', 'Details'] as const;
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
  const { campaignId: rawCampaignId, encounterId: rawEncounterId, noteIndex: rawNoteIndex } = useParams();
  const campaignId = Number(rawCampaignId);
  const encounterId = rawEncounterId ? Number(rawEncounterId) : null;
  const viewingNotes = rawNoteIndex !== undefined;
  const noteIndex = viewingNotes && Number.isFinite(Number(rawNoteIndex)) ? Number(rawNoteIndex) : null;
  const enabled = Boolean(session && Number.isFinite(campaignId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const campaignKey = ['phase1-campaign', campaignId, session?.user.id] as const;
  const encountersKey = ['phase1-encounters', campaignId, session?.user.id] as const;
  const playersKey = ['phase1-players', campaignId, session?.user.id] as const;
  const campaign = useQuery({ queryKey: campaignKey, enabled, queryFn: async () => (await phase1Request<Campaign[]>('find-campaign', { id: campaignId }))[0] ?? null });
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

  const updateCharacter = useMutation<unknown, Error, { id: number; spells?: Character['spells']; details?: Character['details'] }, { previous?: Character[] }>({
    mutationFn: ({ id, ...fields }) => phase1Request('update-character', { id, ...fields }),
    onMutate: async ({ id, ...fields }) => {
      await queryClient.cancelQueries({ queryKey: playersKey });
      const previous = queryClient.getQueryData<Character[]>(playersKey);
      queryClient.setQueryData<Character[]>(playersKey, (current = []) => current.map((item) => item.id === id ? { ...item, ...fields } : item));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(playersKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: playersKey }),
  });
  const deleteEncounter = useMutation<unknown, Error, number, { previous?: Encounter[] }>({
    mutationFn: (id) => phase1Request('delete-content', { id, type: 'encounter' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: encountersKey });
      const previous = queryClient.getQueryData<Encounter[]>(encountersKey);
      queryClient.setQueryData<Encounter[]>(encountersKey, (current = []) => current.filter((item) => item.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(encountersKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: encountersKey }),
  });
  const deleteNote = useMutation<unknown, Error, Campaign, { previous?: Campaign | null }>({
    mutationFn: (next) => phase1Request('create-campaign', next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: campaignKey });
      const previous = queryClient.getQueryData<Campaign | null>(campaignKey);
      queryClient.setQueryData(campaignKey, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(campaignKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: campaignKey }),
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
  const notePages = visibleNotePages(campaign.data, isGm);
  const selectedNote = noteIndex == null ? null : notePages.find((item) => item.index === noteIndex) ?? null;
  function handleDeleteNote(index: number) {
    const pages = [...(campaign.data.notes?.pages ?? [])];
    pages.splice(index, 1);
    deleteNote.mutate({ ...campaign.data, notes: { ...campaign.data.notes, pages } });
    if (viewingNotes && noteIndex === index) {
      const remaining = notePages.filter((item) => item.index !== index);
      if (remaining[0]) {
        const next = remaining[0].index > index ? remaining[0].index - 1 : remaining[0].index;
        navigate(`/phase1/campaign/${campaignId}/notes/${next}`);
      } else if (visible[0]) {
        navigate(`/phase1/campaign/${campaignId}/encounters/${visible[0].id}`);
      } else {
        navigate(`/phase1/campaign/${campaignId}`);
      }
    } else if (viewingNotes && noteIndex != null && noteIndex > index) {
      navigate(`/phase1/campaign/${campaignId}/notes/${noteIndex - 1}`);
    }
  }
  function handleDeleteEncounter(id: number) {
    const remaining = visible.filter((item) => item.id !== id);
    deleteEncounter.mutate(id);
    if (encounterId === id) {
      if (remaining[0]) navigate(`/phase1/campaign/${campaignId}/encounters/${remaining[0].id}`);
      else if (notePages[0]) navigate(`/phase1/campaign/${campaignId}/notes/${notePages[0].index}`);
      else navigate(`/phase1/campaign/${campaignId}`);
    }
  }
  if (!viewingNotes && !encounterId && visible[0]) return <Navigate replace to={`/phase1/campaign/${campaignId}/encounters/${visible[0].id}`} />;
  return <EncounterWorkspace campaign={campaign.data} encounters={visible} players={players.data ?? []} selectedEncounter={viewingNotes ? null : visible.find((item) => item.id === encounterId) ?? null} notePages={notePages} selectedNote={selectedNote} viewingNotes={viewingNotes} isGm={isGm} sessionUserId={session.user.id} onUpdateEncounter={(encounter) => updateEncounter.mutate(encounter)} onUpdateCharacter={(id, fields) => updateCharacter.mutate({ id, ...fields })} onDeleteNote={handleDeleteNote} onDeleteEncounter={handleDeleteEncounter} rosterSaving={updateEncounter.isPending} rosterError={updateEncounter.error ?? updateCharacter.error ?? deleteEncounter.error ?? deleteNote.error} />;
}


function EncounterWorkspace({ campaign, encounters, players, selectedEncounter, notePages, selectedNote, viewingNotes, isGm, sessionUserId, onUpdateEncounter, onUpdateCharacter, onDeleteNote, onDeleteEncounter, rosterSaving, rosterError }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; selectedEncounter: Encounter | null; notePages: IndexedNotePage[]; selectedNote: IndexedNotePage | null; viewingNotes: boolean; isGm: boolean; sessionUserId: string; onUpdateEncounter: (encounter: Encounter) => void; onUpdateCharacter: (id: number, fields: { spells?: Character['spells']; details?: Character['details'] }) => void; onDeleteNote: (index: number) => void; onDeleteEncounter: (id: number) => void; rosterSaving: boolean; rosterError: Error | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailWidth, setDetailWidth] = useState(readDetailWidth);
  const [activeTab, setActiveTab] = useState<DetailTab>('Health');
  const combatants = useMemo(() => populateCombatants(selectedEncounter?.combatants.list ?? [], players), [selectedEncounter, players]);
  const selected = combatants.find((item) => item._id === selectedId) ?? null;
  const statuses = useCombatantStatuses(selectedEncounter?.id ?? null, combatants);
  const encounterNote = notePages.find((item) => item.page.name.trim().toLowerCase() === selectedEncounter?.name.trim().toLowerCase());
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

  function addAllPlayers() {
    if (!selectedEncounter || benchPlayers.length === 0) return;
    updateRoster([
      ...selectedEncounter.combatants.list,
      ...benchPlayers.map((player) => ({ _id: crypto.randomUUID(), type: 'CHARACTER' as const, ally: true, initiative: undefined, character: player.id, data: undefined })),
    ]);
  }

  function removePlayer(combatantId: string) {
    if (!selectedEncounter) return;
    const combatant = selectedEncounter.combatants.list.find((item) => item._id === combatantId);
    if (combatant?.type !== 'CHARACTER') return;
    updateRoster(selectedEncounter.combatants.list.filter((item) => item._id !== combatantId));
    if (selectedId === combatantId) setSelectedId(null);
  }

  function cloneCreature(combatantId: string) {
    if (!selectedEncounter) return;
    const list = selectedEncounter.combatants.list;
    const index = list.findIndex((item) => item._id === combatantId);
    const source = index === -1 ? undefined : list[index];
    if (!source || source.type !== 'CREATURE') return;
    const copy = structuredClone(source);
    copy._id = crypto.randomUUID();
    updateRoster([...list.slice(0, index + 1), copy, ...list.slice(index + 1)]);
    setSelectedId(copy._id);
  }

  function deleteCreature(combatantId: string) {
    if (!selectedEncounter) return;
    const combatant = selectedEncounter.combatants.list.find((item) => item._id === combatantId);
    if (combatant?.type !== 'CREATURE') return;
    updateRoster(selectedEncounter.combatants.list.filter((item) => item._id !== combatantId));
    if (selectedId === combatantId) setSelectedId(null);
  }

  const canManageSpells = useMemo(() => {
    if (!selected) return false;
    if (isGm) return true;
    if (selected.type === 'CHARACTER' && selected.character) {
      const owner = players.find((player) => player.id === selected.character);
      return owner?.user_id === sessionUserId;
    }
    return false;
  }, [selected, isGm, players, sessionUserId]);

  function persistCreature(entity: LivingEntity) {
    if (!selected || !selectedEncounter || selected.type !== 'CREATURE') return;
    const list = selectedEncounter.combatants.list.map((combatant) => combatant._id === selected._id ? { ...combatant, creature: entity } as Combatant : combatant);
    onUpdateEncounter({ ...selectedEncounter, combatants: { list } });
  }

  function persistEntitySpells(entity: LivingEntity) {
    if (!selected || !selectedEncounter) return;
    if (selected.type === 'CHARACTER' && selected.character) {
      onUpdateCharacter(selected.character, { spells: entity.spells });
      return;
    }
    persistCreature(entity);
  }

  function persistConditions(conditions: Condition[]) {
    if (!selected || !selectedEncounter) return;
    const details = { ...selected.data.details, conditions };
    if (selected.type === 'CHARACTER' && selected.character) {
      onUpdateCharacter(selected.character, { details: details as Character['details'] });
      return;
    }
    persistCreature({ ...selected.data, details });
  }

  function persistGmNotes(text: string) {
    if (!selected || !selectedEncounter || selected.type !== 'CREATURE') return;
    persistEntitySpells({ ...selected.data, notes: toGmNotes(text, selected.data.notes) });
  }

  const spellActions: Phase1SpellActions | undefined = canManageSpells
    ? {
        setCast: async (entry, cast) => {
          if (!selected) return;
          persistEntitySpells(await setEntitySpellCast(selected as Phase1EntityCombatant, entry, cast));
        },
        setRankSpent: async (section, rank, spent) => {
          if (!selected || !section.source) return;
          persistEntitySpells(await setEntitySpellRankSpent(selected as Phase1EntityCombatant, section.source.name, rank, spent));
        },
        setPreparedSpent: async (entry, spent) => {
          if (!selected) return;
          persistEntitySpells(await setEntityPreparedEntrySpent(selected as Phase1EntityCombatant, entry, spent));
        },
        setFocusSpent: async (section, spent) => {
          if (!selected || !section.focusPoints) return;
          persistEntitySpells(await setEntityFocusSpent(selected as Phase1EntityCombatant, section.focusPoints.max, spent));
        },
        setInnateSpent: async (entry, castsCurrent) => {
          if (!selected) return;
          persistEntitySpells(await setEntityInnateSpent(selected as Phase1EntityCombatant, entry.spell.id, entry.rank, castsCurrent));
        },
      }
    : undefined;
  useEffect(() => setSelectedId(null), [selectedEncounter?.id]);
  useEffect(() => window.localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth)), [detailWidth]);

  return (
    <div className='flex h-screen min-h-[680px] flex-col overflow-hidden bg-[#0d1114] text-[#e7ebed]'>
      <WorkspaceHeader label={campaign.name} />
      <div className={`grid min-h-0 flex-1 ${viewingNotes ? 'grid-cols-[248px_minmax(280px,1fr)]' : 'grid-cols-[248px_minmax(280px,1fr)_6px_auto]'}`}>
        <CampaignRail campaign={campaign} encounters={encounters} players={benchPlayers} selectedEncounter={selectedEncounter} notePages={notePages} selectedNoteIndex={selectedNote?.index ?? null} isGm={isGm} rosterSaving={rosterSaving} onRemovePlayer={removePlayer} onAddAllPlayers={addAllPlayers} onDeleteNote={onDeleteNote} onDeleteEncounter={onDeleteEncounter} />
        <main className='min-w-0 overflow-auto bg-[#11171a]'>
          {viewingNotes ? (
            <NoteSurface note={selectedNote} isGm={isGm} />
          ) : (
            <>
              <EncounterHeader encounter={selectedEncounter} count={combatants.length} isGm={isGm} joinKey={isGm ? campaign.join_key : undefined} noteLink={encounterNote ? { href: `/phase1/campaign/${campaign.id}/notes/${encounterNote.index}`, name: encounterNote.page.name } : undefined} />
              {rosterError && <div className='border-b border-[#a95249]/40 bg-[#a95249]/10 px-5 py-2 text-xs text-[#efaaa3]'>Roster update failed: {rosterError.message}</div>}
              <div className='p-5'><CombatantGrid combatants={combatants} selectedId={selectedId} onSelect={setSelectedId} statuses={statuses.data} calculating={statuses.isLoading} canManageRoster={isGm && !rosterSaving} onAddPlayer={addPlayer} onRemovePlayer={removePlayer} onCloneCreature={cloneCreature} onDeleteCreature={deleteCreature} /></div>
            </>
          )}
        </main>
        {!viewingNotes && (
          <>
            <ResizeRail onResize={(delta) => setDetailWidth((width) => clamp(width - delta, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX))} />
            <Inspector combatant={selected} width={detailWidth} activeTab={activeTab} onTab={setActiveTab} hasMatchingCampaignNote={Boolean(encounterNote)} status={selected ? statuses.data?.[selected._id] : undefined} statusLoading={statuses.isLoading} canManageSpells={canManageSpells} spellActions={spellActions} onChangeConditions={canManageSpells ? persistConditions : undefined} onSaveGmNotes={isGm && selected?.type === 'CREATURE' ? persistGmNotes : undefined} />
          </>
        )}
      </div>
    </div>
  );
}

type CombatantStatusMap = Record<string, Phase1CreatureStatus | null>;

function useCombatantStatuses(encounterId: number | null, combatants: PopulatedCombatant[]) {
  const signature = combatants.map((combatant) => `${combatant._id}:${combatant.data.hp_current}:${combatant.data.hp_temp}:${JSON.stringify(combatant.data.details?.conditions ?? [])}`).join('|');
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

function CampaignRail({ campaign, encounters, players, selectedEncounter, notePages, selectedNoteIndex, isGm, rosterSaving, onRemovePlayer, onAddAllPlayers, onDeleteNote, onDeleteEncounter }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; selectedEncounter: Encounter | null; notePages: IndexedNotePage[]; selectedNoteIndex: number | null; isGm: boolean; rosterSaving: boolean; onRemovePlayer: (combatantId: string) => void; onAddAllPlayers: () => void; onDeleteNote: (index: number) => void; onDeleteEncounter: (id: number) => void;
}) {
  const [benchActive, setBenchActive] = useState(false);
  const [menu, setMenu] = useState<RailContextTarget | null>(null);
  const [benchMenu, setBenchMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RailContextTarget | null>(null);
  const canManageRoster = isGm && !rosterSaving && Boolean(selectedEncounter);

  function dropOnBench(event: ReactDragEvent<HTMLDivElement>) {
    const payload = readPlayerDrag(event);
    setBenchActive(false);
    if (!canManageRoster || payload?.source !== 'encounter' || !payload.combatantId) return;
    event.preventDefault();
    onRemovePlayer(payload.combatantId);
  }

  function openRailMenu(event: ReactMouseEvent, target: Omit<RailContextTarget, 'x' | 'y'>) {
    if (!isGm) return;
    event.preventDefault();
    setMenu({ ...target, x: event.clientX, y: event.clientY });
  }

  function openBenchMenu(event: ReactMouseEvent) {
    if (!canManageRoster) return;
    event.preventDefault();
    setBenchMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <aside className='min-h-0 overflow-y-auto border-r border-white/10 bg-[#0f1417]'>
      <div className='border-b border-white/10 p-4'>
        <Link to='/phase1' className='mb-5 flex items-center gap-2 text-xs text-[#879198] hover:text-white'><ArrowLeft size={14} /> Campaigns</Link>
        <Eyebrow>{isGm ? 'Game master' : 'Player'}</Eyebrow><h1 className='mt-2 text-lg font-semibold leading-tight'>{campaign.name}</h1>
      </div>
      <RailLabel icon={<BookOpen size={14} />} label='Notes' count={notePages.length} />
      <nav className='px-2 pb-4'>
        {notePages.map(({ page, index }) => (
          <Link
            key={`${page.name}-${index}`}
            to={`/phase1/campaign/${campaign.id}/notes/${index}`}
            onContextMenu={(event) => openRailMenu(event, { kind: 'note', id: index, name: page.name })}
            className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedNoteIndex === index ? 'border-[#d6a85f] bg-white/[0.045] text-white' : 'border-transparent text-[#89949a] hover:bg-white/[0.025] hover:text-white'}`}
          >
            <span className='block truncate'>{page.name}</span>
            {isGm && <span className='mt-0.5 block text-[11px] text-[#667178]'>{page.shared ? 'Shared with party' : 'GM only'}</span>}
          </Link>
        ))}
        {notePages.length === 0 && <p className='px-3 py-4 text-xs leading-5 text-[#68747a]'>{isGm ? 'No campaign notes yet.' : 'No shared campaign notes.'}</p>}
      </nav>
      <RailLabel icon={<Swords size={14} />} label='Encounters' count={encounters.length} />
      <nav className='px-2 pb-4'>
        {encounters.map((encounter) => (
          <Link
            key={encounter.id}
            to={`/phase1/campaign/${campaign.id}/encounters/${encounter.id}`}
            onContextMenu={(event) => openRailMenu(event, { kind: 'encounter', id: encounter.id, name: encounter.name })}
            className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedEncounter?.id === encounter.id ? 'border-[#d6a85f] bg-white/[0.045] text-white' : 'border-transparent text-[#89949a] hover:bg-white/[0.025] hover:text-white'}`}
          >
            <span className='block truncate'>{encounter.name}</span>
            <span className='mt-0.5 block text-[11px] text-[#667178]'>{encounter.combatants.list.length} combatants</span>
          </Link>
        ))}
        {encounters.length === 0 && <p className='px-3 py-4 text-xs leading-5 text-[#68747a]'>No encounters are visible for this campaign.</p>}
      </nav>
      <RailLabel icon={<UsersRound size={14} />} label='Party bench' count={players.length} onContextMenu={openBenchMenu} />
      <div className={`mx-2 min-h-16 border px-1 pb-4 pt-1 transition-colors ${benchActive ? 'border-[#d6a85f] bg-[#d6a85f]/[0.07]' : 'border-transparent'}`} onContextMenu={openBenchMenu} onDragOver={(event) => { if (canManageRoster && hasPlayerDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setBenchActive(true); } }} onDragLeave={() => setBenchActive(false)} onDrop={dropOnBench}>
        {players.map((player) => <a key={player.id} href={`${OLD_UI_ORIGIN}/sheet/${player.id}`} target='_blank' rel='noreferrer' draggable={canManageRoster} onDragStart={(event) => writePlayerDrag(event, { source: 'bench', characterId: player.id })} onDragEnd={() => setBenchActive(false)} className='flex items-center gap-2 px-2 py-2 text-sm text-[#89949a] hover:bg-white/[0.025] hover:text-white'>{canManageRoster && <GripVertical size={14} className='shrink-0 cursor-grab text-[#59656b]' />}<UserRound size={15} /><span className='min-w-0 flex-1 truncate'>{player.name}</span><ExternalLink size={12} /></a>)}
        {players.length === 0 && <p className='px-2 py-3 text-xs text-[#68747a]'>No PCs on the bench.</p>}
      </div>
      {menu && (
        <RailContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onDelete={() => {
            setMenu(null);
            setPendingDelete(menu);
          }}
        />
      )}
      {benchMenu && (
        <BenchContextMenu
          x={benchMenu.x}
          y={benchMenu.y}
          disabled={players.length === 0}
          onClose={() => setBenchMenu(null)}
          onAddAll={() => {
            setBenchMenu(null);
            onAddAllPlayers();
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === 'note' ? 'Delete note' : 'Delete encounter'}
          message={`Are you sure you want to delete "${pendingDelete.name}"?`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            if (pendingDelete.kind === 'note') onDeleteNote(pendingDelete.id);
            else onDeleteEncounter(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}
    </aside>
  );
}
function RailLabel({ icon, label, count, onContextMenu }: { icon: ReactNode; label: string; count: number; onContextMenu?: (event: ReactMouseEvent) => void }) {
  return <div className='flex items-center gap-2 px-5 pb-2 pt-5 text-[10px] font-semibold uppercase text-[#68747a]' onContextMenu={onContextMenu}>{icon}{label}<span className='ml-auto'>{count}</span></div>;
}

type RailContextTarget = { kind: 'note' | 'encounter'; id: number; name: string; x: number; y: number };

function PlayerContextMenu({ x, y, onClose, onRemove }: { x: number; y: number; onClose: () => void; onRemove: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - 56);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-40 border border-white/10 bg-[#151b1e] py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e7ebed] hover:bg-white/[0.05]' onClick={onRemove}>
          <UserMinus size={14} /> Remove
        </button>
      </div>
    </>,
    document.body
  );
}

function CombatantContextMenu({ x, y, onClose, onClone, onDelete }: { x: number; y: number; onClose: () => void; onClone: () => void; onDelete: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - 88);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-40 border border-white/10 bg-[#151b1e] py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e7ebed] hover:bg-white/[0.05]' onClick={onClone}>
          <Copy size={14} /> Clone
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#efaaa3] hover:bg-white/[0.05]' onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>,
    document.body
  );
}

function BenchContextMenu({ x, y, disabled, onClose, onAddAll }: { x: number; y: number; disabled: boolean; onClose: () => void; onAddAll: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - 56);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-40 border border-white/10 bg-[#151b1e] py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' disabled={disabled} className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e7ebed] hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:text-[#68747a] disabled:hover:bg-transparent' onClick={onAddAll}>
          <Plus size={14} /> Add all
        </button>
      </div>
    </>,
    document.body
  );
}

function RailContextMenu({ x, y, onClose, onDelete }: { x: number; y: number; onClose: () => void; onDelete: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - 56);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-40 border border-white/10 bg-[#151b1e] py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#efaaa3] hover:bg-white/[0.05]' onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>,
    document.body
  );
}

function ConfirmDialog({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  return createPortal(
    <div className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby='confirm-title' className='w-full max-w-sm border border-white/15 bg-[#11171a] p-5 shadow-2xl'>
        <h2 id='confirm-title' className='text-lg font-semibold'>{title}</h2>
        <p className='mt-2 text-sm leading-6 text-[#aeb7bc]'>{message}</p>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onCancel}>Cancel</button>
          <button type='button' className='toolbar-button border-[#a95249]/50 text-[#efaaa3]' onClick={onConfirm}>Delete</button>
        </div>
      </section>
    </div>,
    document.body
  );
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
function EncounterHeader({ encounter, count, isGm, joinKey, noteLink }: { encounter: Encounter | null; count: number; isGm: boolean; joinKey?: string; noteLink?: { href: string; name: string } }) {
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
        <div className='min-w-0 flex-1'><Eyebrow>{isGm ? 'GM encounter' : 'Assigned encounter'}</Eyebrow><h2 className='mt-1 truncate text-xl font-semibold'>{encounter?.name ?? 'No encounter selected'}</h2><p className='mt-1 truncate text-xs text-[#778289]'>{encounter?.meta_data.description || `${count} combatants`}</p>{noteLink && <Link to={noteLink.href} className='mt-1 block truncate text-xs text-[#d6a85f] hover:underline'>See campaign Notes page: {noteLink.name}</Link>}</div>
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

function CombatantGrid({ combatants, selectedId, onSelect, statuses, calculating, canManageRoster, onAddPlayer, onRemovePlayer, onCloneCreature, onDeleteCreature }: { combatants: PopulatedCombatant[]; selectedId: string | null; onSelect: (id: string) => void; statuses?: CombatantStatusMap; calculating: boolean; canManageRoster: boolean; onAddPlayer: (characterId: number) => void; onRemovePlayer: (combatantId: string) => void; onCloneCreature: (combatantId: string) => void; onDeleteCreature: (combatantId: string) => void }) {
  const [encounterActive, setEncounterActive] = useState(false);
  const [menu, setMenu] = useState<{ id: string; type: Combatant['type']; x: number; y: number } | null>(null);
  function dropOnEncounter(event: ReactDragEvent<HTMLDivElement>) {
    const payload = readPlayerDrag(event);
    setEncounterActive(false);
    if (!canManageRoster || payload?.source !== 'bench') return;
    event.preventDefault();
    onAddPlayer(payload.characterId);
  }
  return (
    <div className={`overflow-x-auto border bg-[#0e1316] transition-colors ${encounterActive ? 'border-[#d6a85f] bg-[#d6a85f]/[0.04]' : 'border-white/10'}`} onDragOver={(event) => { if (canManageRoster && hasPlayerDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setEncounterActive(true); } }} onDragLeave={() => setEncounterActive(false)} onDrop={dropOnEncounter}>
      <table className='w-full min-w-[920px] table-fixed border-collapse text-sm'>
        <thead className='border-b border-white/10 bg-[#0b1012] text-[10px] uppercase text-[#68747a]'><tr><th className='w-20 px-3 py-3 text-left'>Init</th><th className='px-3 text-left'>Combatant</th><th className='w-44 px-3 text-left'>Conditions</th><th className='w-64 px-3 text-left'>Defenses</th><th className='w-32 px-3 text-left'>HP</th><th className='w-16 px-3 text-center'>Open</th></tr></thead>
        <tbody>
          {combatants.map((combatant) => {
            const detailsVisible = combatant.access?.details_revealed !== false;
            const calculable = detailsVisible && hasFullEntityDetails(combatant);
            const calculated = statuses?.[combatant._id];
            const stats = calculated ?? (!calculable ? fallbackStatus(combatant.data) : null);
            const draggable = canManageRoster && combatant.type === 'CHARACTER' && typeof combatant.character === 'number';
            return (
              <tr key={combatant._id} draggable={draggable} onDragStart={(event) => { if (draggable && typeof combatant.character === 'number') writePlayerDrag(event, { source: 'encounter', characterId: combatant.character, combatantId: combatant._id }); }} onDragEnd={() => setEncounterActive(false)} onContextMenu={(event) => { if (!canManageRoster || (combatant.type !== 'CREATURE' && combatant.type !== 'CHARACTER')) return; event.preventDefault(); setMenu({ id: combatant._id, type: combatant.type, x: event.clientX, y: event.clientY }); }} className={`border-b border-white/[0.07] last:border-0 ${draggable ? 'cursor-grab' : ''} ${combatant._id === selectedId ? 'bg-[#d6a85f]/[0.07]' : 'hover:bg-white/[0.025]'}`}>
                <td className='px-3 py-3'><input className='h-9 w-14 border border-white/10 bg-[#11181b] px-2 text-center text-[#bdc5c9]' type='number' value={combatant.initiative ?? ''} readOnly disabled aria-label={`${combatant.data.name} initiative`} /></td>
                <td className='px-3 py-3'><button className='flex w-full items-center gap-3 text-left' onClick={() => openCombatant(combatant, onSelect)}>{draggable && <GripVertical size={14} className='shrink-0 text-[#59656b]' />}<EntityIcon type={combatant.type} /><span className='min-w-0'><span className='block truncate font-semibold'>{combatant.data.name}</span><span className='block text-xs text-[#68747a]'>Level {combatant.data.level} | {combatant.ally ? 'Ally' : 'Enemy'}</span></span></button></td>
                <td className='px-3 py-3'><CombatantConditionPills conditions={detailsVisible ? compiledConditions(combatant.data.details?.conditions ?? []) : []} onOpen={() => openCombatant(combatant, onSelect)} /></td>
                <td className='px-3 py-3 text-xs text-[#89949a]'>{!detailsVisible ? <span className='text-[#59656b]'>Not revealed</span> : stats ? <>{stats.ac} AC <span className='px-1 text-[#455057]'>|</span> Fort {signed(stats.fortitude)}, Ref {signed(stats.reflex)}, Will {signed(stats.will)}</> : calculating ? <span className='text-[#68747a]'>Calculating...</span> : <span className='text-[#a87a70]'>Unavailable</span>}</td>
                <td className='px-3 py-3'><span className='inline-flex h-9 min-w-24 items-center justify-center border border-white/10 bg-[#11181b]'>{!detailsVisible ? <span className='text-[#59656b]'>Hidden</span> : stats ? <>{combatant.data.hp_current}<span className='px-2 text-[#59656b]'>/</span>{stats.maxHp}</> : calculating ? <span className='text-[#68747a]'>...</span> : <>{combatant.data.hp_current}<span className='px-2 text-[#59656b]'>/</span>-</>}</span></td>
                <td className='px-3 text-center'><button className='icon-button mx-auto' title={`Open ${combatant.data.name}`} onClick={() => openCombatant(combatant, onSelect)}><PanelRight size={16} /></button></td>
              </tr>
            );
          })}
          {combatants.length === 0 && <tr><td colSpan={6} className='p-12 text-center text-sm text-[#68747a]'>No combatants in this encounter.</td></tr>}
        </tbody>
      </table>
      {menu?.type === 'CREATURE' && (
        <CombatantContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onClone={() => { setMenu(null); onCloneCreature(menu.id); }}
          onDelete={() => { setMenu(null); onDeleteCreature(menu.id); }}
        />
      )}
      {menu?.type === 'CHARACTER' && (
        <PlayerContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRemove={() => { setMenu(null); onRemovePlayer(menu.id); }}
        />
      )}
    </div>
  );
}
function openCombatant(combatant: PopulatedCombatant, onSelect: (id: string) => void) {
  if (combatant.access?.details_revealed === false) return;
  onSelect(combatant._id);
}

const CONDITION_PILL_MAX = 2;
const CONDITION_PILL_CLASS = 'inline-flex max-w-[8.5rem] items-center truncate rounded-full border border-white/12 bg-white/[0.055] px-2 py-[3px] text-[10px] font-medium leading-none tracking-wide text-[#d5dcde]';

function conditionLabel(condition: Condition) {
  return condition.value != null ? `${condition.name} ${condition.value}` : condition.name;
}

function CombatantConditionPills({ conditions, onOpen }: { conditions: Condition[]; onOpen: () => void }) {
  if (conditions.length === 0) return null;
  const visible = conditions.slice(0, CONDITION_PILL_MAX);
  const extra = conditions.slice(CONDITION_PILL_MAX);
  return (
    <div className='flex flex-wrap items-center gap-1'>
      {visible.map((condition) => (
        <button
          key={`${condition.name}-${condition.source ?? 'direct'}`}
          type='button'
          className={`${CONDITION_PILL_CLASS} hover:border-white/20 hover:bg-white/[0.09]`}
          title={condition.source ? `${conditionLabel(condition)} from ${condition.source}` : conditionLabel(condition)}
          onClick={onOpen}
        >
          {conditionLabel(condition)}
        </button>
      ))}
      {extra.length > 0 && (
        <button
          type='button'
          className='inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-1.5 text-[9px] font-semibold text-[#8b969c] hover:border-white/20 hover:text-[#d5dcde]'
          title={extra.map(conditionLabel).join(', ')}
          onClick={onOpen}
        >
          +{extra.length}
        </button>
      )}
    </div>
  );
}

function Inspector({ combatant, width, activeTab, onTab, hasMatchingCampaignNote, status, statusLoading, canManageSpells, spellActions, onChangeConditions, onSaveGmNotes }: {
  combatant: PopulatedCombatant | null; width: number; activeTab: DetailTab; onTab: (tab: DetailTab) => void; hasMatchingCampaignNote?: boolean; status?: Phase1CreatureStatus | null; statusLoading: boolean; canManageSpells: boolean; spellActions?: Phase1SpellActions; onChangeConditions?: (conditions: Condition[]) => void; onSaveGmNotes?: (text: string) => void;
}) {
  return (
    <aside className='min-h-0 overflow-hidden bg-[#0c1113]' style={{ width }}>
      {!combatant ? (
        <div className='flex h-full flex-col items-center justify-center px-8 text-center'><PanelRight className='mb-4 text-[#465158]' size={28} /><p className='text-sm font-semibold'>Select a combatant</p><p className='mt-2 max-w-56 text-xs leading-5 text-[#68747a]'>PCs, NPCs, and creatures open in this shared read-only inspector.</p></div>
      ) : (
        <div className='flex h-full min-w-0 flex-col'>
<div className='flex items-start gap-3 border-b border-white/10 px-4 py-3.5'><div className='min-w-0 flex-1'><Eyebrow>{combatant.type === 'CREATURE' ? (combatant.ally ? 'NPC / Creature' : 'Creature') : 'Player character'}</Eyebrow><h2 className='mt-1 truncate text-lg font-semibold leading-tight'>{combatant.data.name}</h2><p className='mt-1 text-xs text-[#748087]'>Level {combatant.data.level} | {canManageSpells ? 'Spell tracking' : 'Read only'}</p></div>{combatant.type === 'CHARACTER' && combatant.data.id && <a className='icon-button shrink-0' href={`${OLD_UI_ORIGIN}/sheet/${combatant.data.id}`} target='_blank' rel='noreferrer' title='Open full character sheet'><ExternalLink size={16} /></a>}</div>
          <div className='grid grid-cols-4 border-b border-white/10 bg-[#0a0e10]'>
            {DETAIL_TABS.map((tab) => <button key={tab} className={`border-b-2 px-2 py-2.5 text-[11px] ${activeTab === tab ? 'border-[#d6a85f] text-[#f0d29d]' : 'border-transparent text-[#748087] hover:text-white'}`} onClick={() => onTab(tab)}>{tab}</button>)}
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto p-4'><InspectorContent combatant={combatant} tab={activeTab} hasMatchingCampaignNote={hasMatchingCampaignNote} status={status} statusLoading={statusLoading} spellActions={spellActions} onChangeConditions={onChangeConditions} onSaveGmNotes={onSaveGmNotes} /></div>
        </div>
      )}
    </aside>
  );
}

function InspectorContent({ combatant, tab, hasMatchingCampaignNote, status, statusLoading, spellActions, onChangeConditions, onSaveGmNotes }: { combatant: PopulatedCombatant; tab: DetailTab; hasMatchingCampaignNote?: boolean; status?: Phase1CreatureStatus | null; statusLoading: boolean; spellActions?: Phase1SpellActions; onChangeConditions?: (conditions: Condition[]) => void; onSaveGmNotes?: (text: string) => void }) {
  const entity = combatant.data;
  if (tab === 'Health') return <HealthStatusPanel combatant={combatant} calculatedStatus={status} calculating={statusLoading} onChangeConditions={onChangeConditions} />;
  if (tab === 'Abilities') return <AbilitiesPanel combatant={combatant} />;
  if (tab === 'Skills') return <SkillsActionsPanel combatant={combatant} />;
  if (tab === 'Spells') return <SpellsPanel combatant={combatant} spellActions={spellActions} />;
  if (tab === 'Inventory') return <InventoryPanel combatant={combatant} />;
  if (tab === 'GM Notes') {
    if (hasMatchingCampaignNote && !onSaveGmNotes) return <p className='border border-white/10 bg-[#11171a] p-4 text-sm leading-5 text-[#c4cbce]'>see campaign note of same name</p>;
    return <EntityNotesPanel notes={entity.notes} onSave={onSaveGmNotes} />;
  }
  if (tab === 'Source') return <SourceImportNotesPanel notes={entity.notes} />;
  return <DetailsDescriptionPanel entity={entity} />;
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
      if (event.key === 'Escape' && !document.querySelector('[data-ability-modal]') && !isContentStackOpen()) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);

  return createPortal(
    <div data-entity-modal className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
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
  const { name, cost } = abilityNameAndCost(ability.name, ability.actions);
  return <button className='group relative grid w-full grid-cols-[42px_minmax(0,1fr)] items-stretch border border-white/[0.08] bg-[#11171a] text-left hover:border-white/20 hover:bg-white/[0.045] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d6a85f]' onClick={() => onOpen(ability)}>
    <span className='grid place-items-center border-r border-white/[0.07] text-[#89949a]' title={kind.label}>
      {kind.type === 'ranged' ? <Crosshair size={17} /> : kind.type === 'melee' ? <Swords size={17} /> : <Sparkles size={16} />}
      <span className='sr-only'>{kind.label}</span>
    </span>
    <span className={`flex min-w-0 items-center gap-2 px-3 ${compact ? 'py-2' : 'py-2.5'}`}>
      <ActionSymbol cost={cost} />
      <span className='min-w-0 flex-1 truncate text-sm'>{name}</span>
      {ability.level != null && <span className='text-[10px] text-[#68747a]'>Lvl {ability.level}</span>}
    </span>
    <span className='pointer-events-none invisible absolute left-10 right-2 top-[calc(100%+4px)] z-40 hidden border border-white/15 bg-[#171d20] p-3 opacity-0 shadow-xl transition-opacity delay-300 group-hover:visible group-hover:opacity-100 md:block'>
      <span className='flex items-center gap-2 text-xs font-semibold text-[#e1e5e7]'><ActionSymbol cost={cost} />{name}</span>
      {ability.traitNames.length > 0 && <span className='mt-1.5 block truncate text-[9px] uppercase text-[#8e999f]'>{ability.traitNames.join(' | ')}</span>}
      <span className='mt-2 block text-[11px] leading-4 text-[#aeb7bc]'>{preview}{plainText(ability.description).length > preview.length ? '...' : ''}</span>
    </span>
  </button>;
}
function AbilityModal({ ability, onClose }: { ability: Phase1Ability; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { name, cost } = abilityNameAndCost(ability.name, ability.actions);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isContentStackOpen()) onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);
  const wide = ability.description.length > 900;

  return createPortal(
    <div data-ability-modal data-entity-modal className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby={`ability-${ability.id}-title`} className={`flex max-h-[min(82vh,820px)] w-full flex-col border border-white/15 bg-[#11171a] shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <header className='flex items-start gap-4 border-b border-white/10 px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'><ActionSymbol cost={cost} size='1.75rem' /><h2 id={`ability-${ability.id}-title`} className='text-xl font-semibold leading-tight'>{name}</h2></div>
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
          <ProseMarkdown>{ability.description}</ProseMarkdown>
          {ability.special && <div className='mt-4 border-t border-white/10 pt-4'><strong className='mr-2 text-[#e2e6e8]'>Special</strong><ProseMarkdown>{ability.special}</ProseMarkdown></div>}
        </div>
      </section>
    </div>,
    document.body
  );
}

function InventoryPanel({ combatant }: { combatant: PopulatedCombatant }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Phase1InvItem | null>(null);
  const data = useQuery({
    queryKey: ['phase1-entity-inventory', combatant.type, combatant._id, JSON.stringify(combatant.data.inventory ?? null)],
    enabled: detailsAvailable && combatant.access?.details_revealed !== false,
    queryFn: () => loadEntityInventory(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const needle = query.trim().toLowerCase();
  const inventory = data.data;
  const extras = inventory?.extras ?? {};
  const extraKeys = Object.keys(extras);
  const topLevelItems = inventory?.items ?? [];
  const visibleItems = needle ? flattenInvItems(topLevelItems).filter((item) => matchesInvItem(item, needle)) : topLevelItems;
  const equipped = visibleItems.filter((item) => item.isEquipped && !item.isFormula);
  const carried = visibleItems.filter((item) => !item.isEquipped && !item.isFormula);
  const formulas = visibleItems.filter((item) => item.isFormula);
  const hasItemSections = !needle;

  return <>
    {inventory?.coins && <CoinBar coins={inventory.coins} />}
    {extraKeys.map((key) => <DataSection key={key} title={toInventoryExtraLabel(key)} data={extras[key]} />)}
    <div className='relative mb-2.5 mt-3'>
      <Search className='absolute left-3 top-1/2 -translate-y-1/2 text-[#68747a]' size={14} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search items' className='h-9 w-full border border-white/10 bg-[#11171a] pl-9 pr-3 text-sm outline-none placeholder:text-[#5f6a70] focus:border-[#d6a85f]/60' />
    </div>
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {data.isLoading && <EmptyState>Loading inventory...</EmptyState>}
    {data.isError && <ErrorState error={data.error} />}
    {!data.isLoading && inventory && topLevelItems.length === 0 && <EmptyState>No items in inventory.</EmptyState>}
    {!data.isLoading && needle && !visibleItems.length && topLevelItems.length > 0 && <EmptyState>No items match this search.</EmptyState>}
    {hasItemSections ? <>
      <InventoryItemSection title='Equipped' items={equipped} onOpen={setSelected} />
      <InventoryItemSection title='Carried' items={carried} onOpen={setSelected} />
      <InventoryItemSection title='Formulas' items={formulas} onOpen={setSelected} />
    </> : (
      visibleItems.length > 0 && <InventoryItemSection title='Results' items={visibleItems} onOpen={setSelected} flat />
    )}
    {selected && <ItemModal item={selected} onClose={() => setSelected(null)} />}
  </>;
}

function CoinBar({ coins }: { coins: { cp: number; sp: number; gp: number; pp: number } }) {
  const entries = [
    ['Platinum', coins.pp],
    ['Gold', coins.gp],
    ['Silver', coins.sp],
    ['Copper', coins.cp],
  ] as const;
  return (
    <section className='border border-white/10 bg-[#11171a]'>
      <h3 className='border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase text-[#89949a]'>Currency</h3>
      <div className='grid grid-cols-4 divide-x divide-white/10'>
        {entries.map(([label, amount]) => (
          <div key={label} className='px-2 py-3 text-center'>
            <div className='text-[10px] uppercase text-[#68747a]'>{label}</div>
            <div className='mt-1 text-lg font-semibold'>{amount}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InventoryItemSection({ title, items, onOpen, flat = false }: { title: string; items: Phase1InvItem[]; onOpen: (item: Phase1InvItem) => void; flat?: boolean }) {
  if (!items.length) return null;
  return (
    <section className='mb-2.5 border border-white/10 bg-[#11171a]'>
      <h3 className='border-b border-white/10 px-3 py-2 text-xs font-semibold'>{title}</h3>
      <div className='divide-y divide-white/[0.07]'>
        {items.map((item) => <ItemRow key={item.key} item={item} onOpen={onOpen} depth={flat ? 0 : 0} showContents={!flat} />)}
      </div>
    </section>
  );
}

function ItemRow({ item, onOpen, depth, showContents = true }: { item: Phase1InvItem; onOpen: (item: Phase1InvItem) => void; depth: number; showContents?: boolean }) {
  const preview = plainText(item.description).slice(0, 180);
  const icon = itemGroupIcon(item.group);
  return <>
    <button
      className='group relative grid w-full grid-cols-[42px_minmax(0,1fr)] items-stretch border-0 bg-transparent text-left hover:bg-white/[0.045] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d6a85f]'
      style={{ paddingLeft: depth * 12 }}
      onClick={() => onOpen(item)}
    >
      <span className='grid place-items-center border-r border-white/[0.07] text-[#89949a]' title={item.group}>
        {icon}
      </span>
      <span className='flex min-w-0 items-center gap-2 px-3 py-2.5'>
        <span className='min-w-0 flex-1 truncate text-sm'>{item.name}</span>
        {item.quantity > 1 && <span className='text-[10px] text-[#68747a]'>x{item.quantity}</span>}
        {item.bulkLabel !== '—' && <span className='text-[10px] text-[#68747a]'>{item.bulkLabel} Bulk</span>}
        {item.isEquipped && <Tag>Equipped</Tag>}
        {item.isInvested && <Tag>Invested</Tag>}
      </span>
      <span className='pointer-events-none invisible absolute left-10 right-2 top-[calc(100%+4px)] z-40 hidden border border-white/15 bg-[#171d20] p-3 opacity-0 shadow-xl transition-opacity delay-300 group-hover:visible group-hover:opacity-100 md:block'>
        <span className='flex items-center gap-2 text-xs font-semibold text-[#e1e5e7]'>{item.name}</span>
        {item.traitNames.length > 0 && <span className='mt-1.5 block truncate text-[9px] uppercase text-[#8e999f]'>{item.traitNames.join(' | ')}</span>}
        {item.damageSummary && <span className='mt-1 block text-[10px] text-[#89949a]'>{item.damageSummary}</span>}
        <span className='mt-2 block text-[11px] leading-4 text-[#aeb7bc]'>{preview}{plainText(item.description).length > preview.length ? '...' : ''}</span>
      </span>
    </button>
    {showContents && item.contents.map((child) => <ItemRow key={child.key} item={child} onOpen={onOpen} depth={depth + 1} />)}
  </>;
}

function ItemModal({ item, onClose }: { item: Phase1InvItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isContentStackOpen()) onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);
  const wide = item.description.length > 900;

  return createPortal(
    <div data-entity-modal className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby={`item-${item.key}-title`} className={`flex max-h-[min(82vh,820px)] w-full flex-col border border-white/15 bg-[#11171a] shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <header className='flex items-start gap-4 border-b border-white/10 px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <span className='text-[#89949a]'>{itemGroupIcon(item.group)}</span>
              <h2 id={`item-${item.key}-title`} className='text-xl font-semibold leading-tight'>{item.name}</h2>
            </div>
            <div className='mt-2 flex flex-wrap gap-1.5'>
              <Tag>{item.rarity}</Tag>
              <Tag>{item.group.replaceAll('_', ' ')}</Tag>
              {item.isEquipped && <Tag>Equipped</Tag>}
              {item.isInvested && <Tag>Invested</Tag>}
              {item.isFormula && <Tag>Formula</Tag>}
              {item.traitNames.map((trait) => <Tag key={trait}>{trait}</Tag>)}
            </div>
          </div>
          <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close item'><X size={18} /></button>
        </header>
        <div className='min-h-0 overflow-y-auto px-5 py-4'>
          <div className='mb-4 space-y-1 border-b border-white/10 pb-4 text-sm leading-6'>
            <AbilityFact label='Level' value={String(item.level)} />
            <AbilityFact label='Bulk' value={item.bulkLabel} />
            <AbilityFact label='Price' value={item.priceLabel !== '—' ? item.priceLabel : null} />
            <AbilityFact label='Hands' value={item.hands} />
            <AbilityFact label='Usage' value={item.usage} />
            <AbilityFact label='Damage' value={item.damageSummary} />
            <AbilityFact label='Range' value={item.range} />
            <AbilityFact label='AC Bonus' value={item.acBonus != null ? String(item.acBonus) : null} />
            {item.quantity > 1 && <AbilityFact label='Quantity' value={String(item.quantity)} />}
          </div>
          <ProseMarkdown>{item.description}</ProseMarkdown>
          {item.isContainer && item.contents.length > 0 && (
            <div className='mt-4 border-t border-white/10 pt-4'>
              <h3 className='mb-2 text-xs font-semibold uppercase text-[#89949a]'>Contents</h3>
              <div className='divide-y divide-white/[0.07] border border-white/10'>
                {item.contents.map((child) => (
                  <div key={child.key} className='flex items-center gap-2 px-3 py-2 text-sm'>
                    <span className='text-[#89949a]'>{itemGroupIcon(child.group)}</span>
                    <span className='min-w-0 flex-1 truncate'>{child.name}</span>
                    {child.quantity > 1 && <span className='text-[10px] text-[#68747a]'>x{child.quantity}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

function itemGroupIcon(group: string) {
  if (group === 'WEAPON') return <Swords size={17} />;
  if (group === 'ARMOR' || group === 'SHIELD') return <Shield size={17} />;
  return <Package size={16} />;
}

function toInventoryExtraLabel(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AbilityFact({ label, value }: { label: string; value?: string | null }) {
  return value ? <div><strong className='mr-2 text-[#e2e6e8]'>{label}</strong><span className='text-[#aeb7bc]'>{value}</span></div> : null;
}
function Tag({ children }: { children: ReactNode }) { return <span className='border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-[#98a2a7]'>{children}</span>; }
function plainText(value: string) {
  return toStandard2eProse(value)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function classifyAbility(ability: Phase1Ability) {
  const text = `${ability.name} ${ability.description} ${ability.requirements ?? ''}`.toLowerCase();
  if (/\branged\b/.test(text)) return { type: 'ranged' as const, label: 'Ranged ability' };
  if (/\bmelee\b/.test(text)) return { type: 'melee' as const, label: 'Melee ability' };
  return { type: 'feature' as const, label: 'General ability' };
}
function HealthStatusPanel({ combatant, calculatedStatus, calculating, onChangeConditions }: { combatant: PopulatedCombatant; calculatedStatus?: Phase1CreatureStatus | null; calculating: boolean; onChangeConditions?: (conditions: Condition[]) => void }) {
  const entity = combatant.data;
  const status = calculatedStatus ?? fallbackStatus(entity);  const resistanceSummary = status.resistances.length + status.weaknesses.length + status.immunities.length;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewing, setViewing] = useState<Condition | null>(null);
  const rawConditions = entity.details?.conditions ?? [];
  const conditions = compiledConditions(rawConditions);
  const canManage = Boolean(onChangeConditions);

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
        <CreaturePortrait combatant={combatant} />
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
        <div className='min-w-0 px-2 py-3 text-center'>
          <div className='flex items-center justify-center gap-1.5 text-xs text-[#b8c0c4]'>
            <Activity size={15} />
            Conditions
            {canManage && (
              <button
                type='button'
                aria-label='Add condition'
                className='grid h-4 w-4 place-items-center rounded-full bg-white/10 text-[#c3c9cc] hover:bg-white/20 hover:text-white'
                onClick={() => setPickerOpen(true)}
              >
                <Plus size={10} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className='mt-1.5 flex min-h-6 flex-wrap items-center justify-center gap-1'>
            {conditions.length === 0 && <span className='text-[9px] italic text-[#68747a]'>None active</span>}
            {conditions.map((condition) => (
              <button
                key={`${condition.name}-${condition.source ?? 'direct'}`}
                type='button'
                className={`${CONDITION_PILL_CLASS} hover:border-white/20 hover:bg-white/[0.09]`}
                title={condition.source ? `${conditionLabel(condition)} from ${condition.source}` : conditionLabel(condition)}
                onClick={() => setViewing(condition)}
              >
                {conditionLabel(condition)}
              </button>
            ))}
          </div>
        </div>
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
      {pickerOpen && (
        <SelectConditionModal
          current={rawConditions}
          onSelect={(condition) => {
            onChangeConditions?.(addCondition(rawConditions, condition));
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {viewing && (
        <ConditionDetailModal
          condition={viewing}
          canManage={canManage && !viewing.source}
          onValueChange={(value) => {
            onChangeConditions?.(setConditionValue(rawConditions, viewing.name, value));
            setViewing({ ...viewing, value });
          }}
          onRemove={() => {
            onChangeConditions?.(removeCondition(rawConditions, viewing.name));
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
        />
      )}
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
function DetailsDescriptionPanel({ entity }: { entity: LivingEntity }) {
  const description = entityDescription(entity);
  if (!description) return <EmptyState>No description given.</EmptyState>;
  return (
    <section className='border border-white/10 bg-[#11171a] p-4'>
      <ProseMarkdown>{description}</ProseMarkdown>
    </section>
  );
}

function CreaturePortrait({ combatant }: { combatant: PopulatedCombatant }) {
  const art = useMonsterArt(combatant);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const src = art.data?.fullSrc;
  useEffect(() => setFailed(false), [src]);
  return (
    <>
      <button
        type='button'
        className='grid min-h-[96px] place-items-center overflow-hidden border border-white/10 bg-[#11171a] hover:border-white/25'
        disabled={!src || failed}
        onClick={() => { if (src && !failed) setOpen(true); }}
        title={src && !failed ? 'View image' : undefined}
      >
        {src && !failed ? <img src={src} alt={combatant.data.name} className='h-full max-h-28 w-full object-contain p-1.5' onError={() => setFailed(true)} /> : <Swords size={24} className='text-[#4c585e]' />}
      </button>
      {open && src && <ImageModal src={src} alt={combatant.data.name} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImageModal({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);
  return createPortal(
    <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-label={alt} className='relative max-h-[min(90vh,900px)] max-w-[min(90vw,900px)] border border-white/15 bg-[#11171a] p-3 shadow-2xl'>
        <button ref={closeRef} className='icon-button absolute right-2 top-2 z-10' onClick={onClose} title='Close image'><X size={18} /></button>
        <img src={src} alt={alt} className='max-h-[min(84vh,840px)] max-w-[min(86vw,860px)] object-contain' />
      </section>
    </div>,
    document.body
  );
}

function useMonsterArt(combatant: PopulatedCombatant) {
  const name = combatant.data.name;
  const fallback = combatant.data.details?.image_url;
  return useQuery<Phase1MonsterArt | null>({
    queryKey: ['phase1-monster-art', combatant.type, combatant._id, name, fallback],
    queryFn: () => combatant.type === 'CREATURE' ? lookupMonsterArt(name, fallback) : Promise.resolve(fallback ? { monsterId: null, fullSrc: fallback, thumbSrc: fallback } : null),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function entityDescription(entity: LivingEntity) {
  const details = entity.details as { description?: string } | null | undefined;
  const description = details?.description?.trim();
  return description || '';
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
function SpellsPanel({ combatant, spellActions }: { combatant: PopulatedCombatant; spellActions?: Phase1SpellActions }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Phase1SpellEntry | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [spellError, setSpellError] = useState('');
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

  async function runSpellAction(key: string, action: () => Promise<void>, closeModal = false) {
    if (!spellActions || busyKey) return;
    setBusyKey(key);
    setSpellError('');
    try {
      await action();
      if (closeModal) setSelected(null);
    } catch (error) {
      setSpellError(error instanceof Error ? error.message : 'Spell update could not be saved.');
    } finally {
      setBusyKey(null);
    }
  }

  return <>
    <SearchField value={query} onChange={setQuery} placeholder='Search spells' />
    {spellError && <div className='mt-2 border border-[#a95249]/40 bg-[#a95249]/10 px-3 py-2 text-xs text-[#efaaa3]'>{spellError}</div>}
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {data.isLoading && <EmptyState>Loading spellcasting...</EmptyState>}
    {data.isError && <ErrorState error={data.error} />}
    <div className='mt-3 space-y-3'>
      {sections.map((section) => <SpellSection key={section.key} section={section} spellActions={spellActions} busyKey={busyKey} onOpen={setSelected} onCast={(entry) => runSpellAction(`cast-${entry.key}`, () => spellActions!.setCast(entry, true))} onUncast={(entry) => runSpellAction(`uncast-${entry.key}`, () => spellActions!.setCast(entry, false))} onRankSpent={(rank, spent) => runSpellAction(`rank-${section.key}-${rank}`, () => spellActions!.setRankSpent(section, rank, spent))} onFocusSpent={(spent) => runSpellAction(`focus-${section.key}`, () => spellActions!.setFocusSpent(section, spent))} onPreparedSpent={(entry, spent) => runSpellAction(`prepared-${entry.key}`, () => spellActions!.setPreparedSpent(entry, spent))} onInnateSpent={(entry, castsCurrent) => runSpellAction(`innate-${entry.key}`, () => spellActions!.setInnateSpent(entry, castsCurrent))} />)}
      {data.data && !sections.length && <EmptyState>{needle ? 'No spells match this search.' : 'No spells found.'}</EmptyState>}
    </div>
    {selected && <SpellModal entry={selected} spellActions={spellActions} busy={Boolean(busyKey)} onCast={() => runSpellAction(`modal-cast-${selected.key}`, () => spellActions!.setCast(selected, true), true)} onUncast={() => runSpellAction(`modal-uncast-${selected.key}`, () => spellActions!.setCast(selected, false), true)} onClose={() => setSelected(null)} />}
  </>;
}

function SpellSection({ section, spellActions, busyKey, onOpen, onCast, onUncast, onRankSpent, onFocusSpent, onPreparedSpent, onInnateSpent }: {
  section: Phase1SpellSection;
  spellActions?: Phase1SpellActions;
  busyKey: string | null;
  onOpen: (entry: Phase1SpellEntry) => void;
  onCast: (entry: Phase1SpellEntry) => void;
  onUncast: (entry: Phase1SpellEntry) => void;
  onRankSpent: (rank: number, spent: number) => void;
  onFocusSpent: (spent: number) => void;
  onPreparedSpent: (entry: Phase1SpellEntry, spent: boolean) => void;
  onInnateSpent: (entry: Phase1SpellEntry, castsCurrent: number) => void;
}) {
  const ranks = [...new Set(section.entries.map((entry) => entry.cantrip ? -1 : entry.rank))].sort((a, b) => a - b);
  const focusSpent = section.focusPoints ? section.focusPoints.max - section.focusPoints.current : 0;
  return <section className='border border-white/10 bg-[#11171a]'>
    <header className='border-b border-white/10 px-3 py-2.5'>
      <div className='flex items-center gap-2'>
        <WandSparkles size={14} className='text-[#d6a85f]' />
        <h3 className='truncate text-sm font-semibold'>{section.label}</h3>
        <Tag>{section.mode.toLowerCase()}</Tag>
        {section.mode === 'FOCUS' && section.focusPoints && section.focusPoints.max > 0 && (
          <SlotCircles count={section.focusPoints.max} spent={focusSpent} editable={Boolean(spellActions)} title='Focus points spent' onChange={onFocusSpent} />
        )}
      </div>
      {(section.attack != null || section.dc != null) && <div className='mt-2 flex gap-2 text-[11px] text-[#9ca6ab]'>{section.attack != null && <span className='border border-white/10 bg-white/[0.035] px-2 py-1'>Spell attack <strong className='ml-1 text-[#e1e5e7]'>{signed(section.attack)}</strong></span>}{section.dc != null && <span className='border border-white/10 bg-white/[0.035] px-2 py-1'>Spell DC <strong className='ml-1 text-[#e1e5e7]'>{section.dc}</strong></span>}</div>}
    </header>
    <div className='divide-y divide-white/[0.07]'>
      {ranks.map((rank) => {
        const entries = section.entries.filter((entry) => (entry.cantrip ? -1 : entry.rank) === rank);
        const slots = rank < 0 ? [] : section.slots.filter((slot) => slot.rank === rank);
        const rankSpent = slots.filter((slot) => slot.exhausted).length;
        const showRankCircles = rank >= 0 && slots.length > 0 && (section.mode === 'SPONTANEOUS' || section.mode === 'PREPARED');
        return <div key={rank}>
          <div className='flex h-8 items-center gap-2 bg-[#0d1215] px-3 text-xs font-semibold text-[#b8c0c4]'>
            <span>{rank < 0 ? 'Cantrips' : rankLabel(rank)}</span>
            {showRankCircles && <SlotCircles count={slots.length} spent={rankSpent} editable={Boolean(spellActions)} title={`${rankLabel(rank)} slots spent`} onChange={(spent) => onRankSpent(rank, spent)} />}
            <span className='ml-auto border border-white/15 px-1.5 py-0.5 text-[9px] font-normal text-[#89949a]'>{entries.length}</span>
          </div>
          <div className='divide-y divide-white/[0.06]'>{entries.map((entry) => <SpellRow key={entry.key} entry={entry} spellActions={spellActions} busy={Boolean(busyKey)} onOpen={onOpen} onCast={() => onCast(entry)} onUncast={() => onUncast(entry)} onPreparedSpent={(spent) => onPreparedSpent(entry, spent)} onInnateSpent={(castsCurrent) => onInnateSpent(entry, castsCurrent)} />)}</div>
        </div>;
      })}
    </div>
  </section>;
}

function SpellRow({ entry, spellActions, busy, onOpen, onCast, onUncast, onPreparedSpent, onInnateSpent }: {
  entry: Phase1SpellEntry;
  spellActions?: Phase1SpellActions;
  busy: boolean;
  onOpen: (entry: Phase1SpellEntry) => void;
  onCast: () => void;
  onUncast: () => void;
  onPreparedSpent: (spent: boolean) => void;
  onInnateSpent: (castsCurrent: number) => void;
}) {
  const innateSpent = entry.usesMax != null && entry.usesCurrent != null ? entry.usesMax - entry.usesCurrent : 0;
  return <div className='flex min-h-10 items-center gap-2 px-3 py-1.5 hover:bg-white/[0.025]'>
    {entry.mode === 'PREPARED' && !entry.cantrip && (
      <SlotCircles count={1} spent={entry.exhausted ? 1 : 0} editable={Boolean(spellActions)} title={`${entry.spell.name} slot`} onChange={(spent) => onPreparedSpent(spent > 0)} />
    )}
    {entry.mode === 'INNATE' && !entry.cantrip && entry.usesMax != null && entry.usesMax > 0 && (
      <SlotCircles count={entry.usesMax} spent={innateSpent} editable={Boolean(spellActions)} title={`${entry.spell.name} uses spent`} onChange={onInnateSpent} />
    )}
    <button className='flex min-w-0 flex-1 items-center gap-2 text-left' onClick={() => onOpen(entry)}>
      <ActionSymbol cost={entry.spell.cast} />
      <span className='min-w-0 flex-1'><span className='block truncate text-sm font-medium'>{entry.spell.name}</span><span className='mt-0.5 block truncate text-[9px] uppercase text-[#727e84]'>{entry.traitNames.join(' | ') || entry.spell.traditions.join(' | ')}</span></span>
      {entry.mode !== 'INNATE' && entry.usesMax != null && <span className='text-[10px] text-[#89949a]'>{entry.usesCurrent}/{entry.usesMax}</span>}
    </button>
    {spellActions && !entry.cantrip && (
      <div className='flex shrink-0 items-center gap-1.5'>
        <button className='h-7 border border-[#d6a85f]/40 px-2.5 text-[10px] font-semibold text-[#f0d29d] hover:bg-[#d6a85f]/10 disabled:cursor-wait disabled:opacity-50' disabled={busy} onClick={onCast}>{busy ? 'Saving...' : 'Cast'}</button>
        {entry.exhausted && <button className='h-7 border border-white/15 px-2.5 text-[10px] font-semibold text-[#89949a] hover:bg-white/[0.04] disabled:cursor-wait disabled:opacity-50' disabled={busy} onClick={onUncast}>Uncast</button>}
      </div>
    )}
  </div>;
}

function SpellModal({ entry, spellActions, busy, onCast, onUncast, onClose }: { entry: Phase1SpellEntry; spellActions?: Phase1SpellActions; busy: boolean; onCast: () => void; onUncast: () => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isContentStackOpen()) onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = overflow; };
  }, [onClose]);
  const spell = entry.spell;
  return createPortal(
    <div data-entity-modal className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby={`spell-${spell.id}-title`} className='flex max-h-[min(84vh,840px)] w-full max-w-3xl flex-col border border-white/15 bg-[#11171a] shadow-2xl'>
        <header className='flex items-start gap-4 border-b border-white/10 px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'><ActionSymbol cost={spell.cast} size='1.75rem' /><h2 id={`spell-${spell.id}-title`} className='text-xl font-semibold leading-tight'>{spell.name}</h2></div>
            <div className='mt-2 flex flex-wrap gap-1.5'><Tag>{entry.cantrip ? 'Cantrip' : rankLabel(entry.rank)}</Tag><Tag>{spell.rarity}</Tag>{entry.traitNames.map((trait) => <Tag key={trait}>{trait}</Tag>)}</div>
          </div>
          {spellActions && !entry.cantrip && (
            entry.exhausted
              ? <button className='h-8 shrink-0 border border-white/20 px-3 text-xs font-semibold text-[#c4cbce] hover:bg-white/[0.04] disabled:cursor-wait disabled:opacity-50' disabled={busy} onClick={onUncast}>{busy ? 'Saving...' : 'Uncast'}</button>
              : <button className='h-8 shrink-0 border border-[#d6a85f]/50 bg-[#d6a85f] px-3 text-xs font-semibold text-[#17130d] disabled:cursor-wait disabled:opacity-50' disabled={busy} onClick={onCast}>{busy ? 'Saving...' : `Cast ${rankLabel(entry.rank)}`}</button>
          )}
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
          <ProseMarkdown>{spell.description}</ProseMarkdown>
          {spell.heightened?.text?.map((heightened, index) => <div key={index} className='mt-4 border-t border-white/10 pt-4'><strong className='mr-2 text-[#e2e6e8]'>Heightened ({heightened.amount})</strong><ProseMarkdown>{heightened.text}</ProseMarkdown></div>)}
        </div>
      </section>
    </div>,
    document.body
  );
}

function SlotCircles({ count, spent, editable, title, onChange }: { count: number; spent: number; editable: boolean; title: string; onChange: (spent: number) => void }) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const safeSpent = Number.isFinite(spent) ? Math.min(Math.max(0, Math.trunc(spent)), safeCount) : 0;
  if (safeCount === 0) return null;

  function clickCircle(index: number) {
    if (!editable) return;
    const target = index + 1;
    onChange(target === safeSpent ? Math.max(target - 1, 0) : target);
  }

  return (
    <span className='flex items-center gap-1' aria-label={title} title={title}>
      {Array.from({ length: safeCount }, (_, index) => {
        const filled = index < safeSpent;
        if (editable) {
          return (
            <button
              key={index}
              type='button'
              aria-label={`${title}: ${filled ? 'spent' : 'available'}`}
              className={`h-3 w-3 rounded-full border transition hover:scale-110 ${filled ? 'border-[#8e999f] bg-[#8e999f]' : 'border-[#aab4b9] bg-transparent hover:border-[#d6a85f]'}`}
              onClick={(event) => { event.stopPropagation(); clickCircle(index); }}
            />
          );
        }
        return <span key={index} className={`h-3 w-3 rounded-full border ${filled ? 'border-[#8e999f] bg-[#8e999f]' : 'border-[#aab4b9]'}`} />;
      })}
    </span>
  );
}

function rankLabel(rank: number) {
  if (rank === 0) return 'Cantrip';
  const mod = rank % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}
function NoteSurface({ note, isGm }: { note: IndexedNotePage | null; isGm: boolean }) {
  const markdown = note ? noteContentsToMarkdown(note.page.contents) : '';
  return (
    <>
      <div className='sticky top-0 z-10 border-b border-white/10 bg-[#11171a]/95 px-5 py-4 backdrop-blur'>
        <Eyebrow>{isGm ? 'Campaign notes' : 'Shared campaign notes'}</Eyebrow>
        <h2 className='mt-1 truncate text-xl font-semibold'>{note?.page.name ?? 'Note not found'}</h2>
        <p className='mt-1 truncate text-xs text-[#778289]'>{note ? (note.page.shared ? 'Shared with party' : 'Visible to the GM only') : 'This campaign note is unavailable.'}</p>
      </div>
      <div className='p-5'>
        {!note && <EmptyState>This campaign note could not be found, or it is not shared with you.</EmptyState>}
        {note && !markdown && <EmptyState>This note is empty.</EmptyState>}
        {note && markdown && <ProseMarkdown className='max-w-3xl'>{markdown}</ProseMarkdown>}
      </div>
    </>
  );
}

function DataSection({ title, data }: { title: string; data: unknown }) {
  const parsed = parseDisplayData(data);
  return (
    <section>
      <h3 className='mb-3 text-xs font-semibold uppercase text-[#89949a]'>{title}</h3>
      {parsed.kind === 'empty' ? (
        <p className='border border-white/10 bg-[#11171a] p-4 text-xs text-[#7f8a90]'>No data available.</p>
      ) : parsed.kind === 'json' ? (
        <div className='overflow-x-auto border border-white/10 bg-[#11171a] p-4 font-mono text-xs leading-5 text-[#aeb7bc]'>
          <JsonNode value={parsed.value} depth={0} />
        </div>
      ) : (
        <pre className='whitespace-pre-wrap break-words border border-white/10 bg-[#11171a] p-4 font-mono text-xs leading-5 text-[#aeb7bc]'>{parsed.value}</pre>
      )}
    </section>
  );
}

const LONG_TEXT = 140;
const MARKDOWN_HINT = /(^|\n)\s*(#{1,6}\s|>\s|\*\*|_|- |\d+\.\s)/;

function parseDisplayData(data: unknown): { kind: 'empty' } | { kind: 'json'; value: unknown } | { kind: 'text'; value: string } {
  if (data == null || data === '') return { kind: 'empty' };
  if (typeof data !== 'string') return { kind: 'json', value: data };
  const trimmed = data.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return { kind: 'json', value: JSON.parse(trimmed) };
    } catch {
      return { kind: 'text', value: data };
    }
  }
  return { kind: 'text', value: data };
}

function JsonNode({ value, depth, field }: { value: unknown; depth: number; field?: string }) {
  if (value === null) return <span className='text-[#748087]'>null</span>;
  if (typeof value === 'boolean') return <span className='text-[#d6a85f]'>{String(value)}</span>;
  if (typeof value === 'number') return <span className='text-[#8ec8e8]'>{value}</span>;
  if (typeof value === 'string') return <JsonString value={value} field={field} />;
  if (Array.isArray(value)) return <JsonCollection kind='array' value={value} depth={depth} field={field} />;
  if (typeof value === 'object') return <JsonCollection kind='object' value={value as Record<string, unknown>} depth={depth} field={field} />;
  return <span className='text-[#aeb7bc]'>{String(value)}</span>;
}

function JsonString({ value, field }: { value: string; field?: string }) {
  const long = isLongText(value, field);
  if (!long) return <span className='text-[#9dce9a]'>"{value}"</span>;
  const preview = value.replace(/\s+/g, ' ').trim().slice(0, 72);
  return (
    <details className='group my-1'>
      <summary className='cursor-pointer list-none text-[#9dce9a] marker:content-none [&::-webkit-details-marker]:hidden'>
        <span className='mr-1 inline-block text-[#68747a] group-open:hidden'><ChevronRight size={12} className='inline' /></span>
        <span className='mr-1 hidden text-[#68747a] group-open:inline'><ChevronDown size={12} className='inline' /></span>
        "{preview}{value.length > 72 ? '…' : ''}"
        <span className='ml-2 text-[10px] text-[#68747a]'>{value.length} chars</span>
      </summary>
      <div className='ability-prose mt-2 max-w-none border border-white/10 bg-[#0d1215] p-3 font-sans text-[13px] leading-6 text-[#c4cbce]'>
        {looksLikeMarkdown(value) ? <ProseMarkdown className='max-w-none text-[13px] leading-6'>{value}</ProseMarkdown> : <div className='whitespace-pre-wrap'>{value}</div>}
      </div>
    </details>
  );
}

function JsonCollection({ kind, value, depth, field }: { kind: 'array'; value: unknown[]; depth: number; field?: string } | { kind: 'object'; value: Record<string, unknown>; depth: number; field?: string }) {
  const entries = kind === 'array' ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  const [open, setOpen] = useState(() => shouldExpandCollection(kind, value, depth, field));
  if (entries.length === 0) return <span className='text-[#748087]'>{kind === 'array' ? '[]' : '{}'}</span>;
  return (
    <span className='inline-block min-w-0 align-top'>
      <button type='button' className='inline-flex items-center gap-1 text-left text-[#748087] hover:text-[#d6a85f]' onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{kind === 'array' ? '[' : '{'}</span>
        {!open && <span className='text-[#59656b]'>{collectionPreview(kind, value, entries.length)}</span>}
        {!open && <span>{kind === 'array' ? ']' : '}'}</span>}
      </button>
      {open && (
        <>
          <div className='ml-2 border-l border-white/10 pl-3'>
            {entries.map(([key, item]) => (
              <div key={key} className='py-px'>
                {kind === 'object' && <span className='text-[#c9b38a]'>{key}</span>}
                {kind === 'object' && <span className='text-[#59656b]'>: </span>}
                <JsonNode value={item} depth={depth + 1} field={kind === 'object' ? key : field} />
              </div>
            ))}
          </div>
          <div className='text-[#748087]'>{kind === 'array' ? ']' : '}'}</div>
        </>
      )}
    </span>
  );
}

function isLongText(value: string, field?: string) {
  if (field === 'description' || field === 'flavor') return value.length > 80 || value.includes('\n');
  return value.includes('\n') || value.length > LONG_TEXT;
}

function looksLikeMarkdown(value: string) {
  return MARKDOWN_HINT.test(value) || value.includes('\n\n');
}

function shouldExpandCollection(kind: 'array' | 'object', value: unknown[] | Record<string, unknown>, depth: number, field?: string) {
  if (field === 'operations' || field === 'description') return false;
  if (kind === 'array') return depth === 0 && value.length <= 8;
  const record = value as Record<string, unknown>;
  if (typeof record.description === 'string' && isLongText(record.description, 'description')) return depth === 0;
  return depth < 2;
}

function collectionPreview(kind: 'array' | 'object', value: unknown[] | Record<string, unknown>, count: number) {
  if (kind === 'array') return `${count} ${count === 1 ? 'item' : 'items'}`;
  const record = value as Record<string, unknown>;
  if (typeof record.name === 'string') return record.name;
  return `${count} ${count === 1 ? 'key' : 'keys'}`;
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
function addCondition(current: Condition[], condition: Condition) {
  if (current.some((item) => item.name === condition.name)) return current;
  return [...current, condition];
}
function removeCondition(current: Condition[], name: string) {
  const next = current.filter((item) => item.name !== name);
  if (name !== 'Dying') return next;
  const woundedIndex = next.findIndex((item) => item.name === 'Wounded');
  if (woundedIndex >= 0) {
    return next.map((item, index) => (index === woundedIndex ? { ...item, value: 1 + (item.value ?? 0) } : item));
  }
  const wounded = getConditionByName('Wounded');
  return wounded ? [...next, wounded] : next;
}
function setConditionValue(current: Condition[], name: string, value: number) {
  return current.map((item) => (item.name === name ? { ...item, value } : item));
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
function visibleNotePages(campaign: Campaign, isGm: boolean): IndexedNotePage[] {
  return (campaign.notes?.pages ?? []).map((page, index) => ({ page, index })).filter((item) => isGm || item.page.shared);
}
function isNumber(value: number | null): value is number { return typeof value === 'number'; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function readDetailWidth() {
  const stored = Number(window.localStorage.getItem(DETAIL_WIDTH_KEY));
  return clamp(Number.isFinite(stored) && stored > 0 ? stored : DETAIL_WIDTH_DEFAULT, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX);
}
















