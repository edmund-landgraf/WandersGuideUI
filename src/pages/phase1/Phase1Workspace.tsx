import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, BookOpen, Calculator, Check, ChevronDown, ChevronRight, Copy, Crosshair, Eraser, Eye, ExternalLink, Footprints, GripVertical, HeartPulse, History, KeyRound, ListChecks, LogOut, Package, PanelRight, Plus, RotateCcw, Search, Settings, Shield, Skull, Sparkles, Swords, Trash2, UserMinus, UserRound, UsersRound, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Campaign, Character, Combatant, Condition, Creature, Encounter, InitiativeRoundLog, InitiativeRoundLogEntry, LivingEntity } from '@schemas/content';
import { CampaignSignIn } from '@auth/CampaignSignIn';
import { useAuthSession } from '@auth/useAuthSession';
import { confirmHealth } from '@pages/character_sheet/entity-handler';
import { supabase } from '../../supabase-client';
import { phase1Request } from './phase1-api';
import { loadEntityAbilities, type Phase1Ability } from './phase1-abilities';
import { calculateEntityStatus, type Phase1CreatureStatus } from './phase1-stats';
import type { Phase1EntityCombatant } from './phase1-entity';
import { StatDetailModal, type Phase1StatKey, type Phase1StatTarget } from './phase1-stat-modal';
import { loadEntityDetails, type Phase1ProfRow } from './phase1-details';
import { loadEntitySkillsActions, type Phase1ActionGroup, type Phase1Skill } from './phase1-skills';
import {
  addEntitySpellToList,
  applyEntityDivineFont,
  prepareEntitySpellSlot,
  removeEntitySpellFromList,
  setEntityFocusSpent,
  setEntityInnateSpent,
  setEntityPreparedEntrySpent,
  setEntitySpellCast,
  setEntitySpellRankSpent,
} from './phase1-spells';
import { flattenInvItems, inventoryItemToPhase1, loadEntityInventory, matchesInvItem, type Phase1InvItem } from './phase1-inventory';
import { EntityNotesPanel, ProseMarkdown, SourceImportNotesPanel, noteContentsToMarkdown } from './phase1-markdown';
import { isContentStackOpen, useContentLinks } from './phase1-content-links';
import { getBestShield, getItemHealth } from '@items/inv-utils';
import { toGmNotes } from '@pages/character_sheet/panels/gm-notes';
import { lookupMonsterArt, type Phase1MonsterArt } from './phase1-monster-image';
import { addConditionWithSpawns, compiledConditions, removeConditionWithSpawns } from '@conditions/condition-handler';
import { ConditionDetailModal, SelectConditionModal } from './phase1-conditions';
import { SelectCreatureModal } from './phase1-creatures';
import { ActionSymbol } from '@common/Actions';
import { abilityNameAndCost } from '@utils/actions';
import { toStandard2eProse } from '@utils/foundry-text';
import { GiDiceTwentyFacesTwenty } from '@common/game-icons-inline';
import { Phase1ThemeToggle } from './Phase1ThemeToggle';
import { rollDie } from '@utils/random';
import { buildInitiativeRoundLog, formatInitiativeRoll, InitiativeRollModal, isCombatantOut, nextInitiativeRoundNumber, overlayInitiativeLogs, setRoundLogEntryNote, sortCombatantsByInitiative, type InitiativeRollChoice } from './phase1-initiative';
import { appendChangeLog, characterCombatFieldsFromEntity, createChangeLogEntry, parseTempHpInput } from './phase1-change-log';
import { appendActionLog, createActionLogEntry, currentActionRound, removeActionLogEntry, type ActionLogDraft } from './phase1-action-log';
import { maxCombatantStats, maxEntityStats, resetCombatant, resetEntityCombatState, resolveResetMaxHp } from './phase1-encounter-reset';
import { CombatantChangeLogFooter, EditableValueWithNote, GridHpEditPopover, RoundNoteField } from './phase1-change-log-ui';
import { PhaseViewSwitch } from '../phase-switch/PhaseViewSwitch';
import { ConfirmDialog, SettingsSurface } from './phase1-campaign-settings';
import { calculateDifficulty, formatLevelDelta, shouldDisplayEncounterDifficulty, type EncounterDifficulty } from '@utils/encounter-difficulty';
import { InspectorContent, DETAIL_TABS, fallbackStatus, hasFullEntityDetails, normalizeDetailTab, signed, statsFor, type DetailTab, type Phase1SpellActions } from './phase1-entity-panels';
type CampaignNotePage = NonNullable<Campaign['notes']>['pages'][number];
type IndexedNotePage = { page: CampaignNotePage; index: number };

const DETAIL_WIDTH_KEY = 'phase1-detail-width';
const DETAIL_WIDTH_MIN = 340;
const DETAIL_WIDTH_MAX = 1200;
const DETAIL_WIDTH_DEFAULT = 560;
type PopulatedCombatant = Combatant & { data: LivingEntity; access?: { can_edit: boolean; details_revealed: boolean } };

export function Phase1IndexPage() {
  const session = useAuthSession();
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
  if (!session) return <CampaignSignIn variant='phase1' />;
  return (
    <div className='min-h-screen bg-p1-page text-p1-text'>
      <WorkspaceHeader section='campaigns' />
      <main className='mx-auto max-w-5xl px-6 py-10'>
        <div className='mb-8 flex items-end justify-between gap-6 border-b border-p1-border pb-6'>
          <div><Eyebrow>Phase 1</Eyebrow><h1 className='mt-2 text-3xl font-semibold'>Campaign workspace</h1><p className='mt-2 text-sm text-p1-muted'>Choose an owned or joined campaign, or open Characters from the header.</p></div>
          <button className='icon-button' title='Sign out' onClick={() => supabase.auth.signOut()}><LogOut size={17} /></button>
        </div>
        {campaigns.isLoading && <EmptyState>Loading campaigns...</EmptyState>}
        {campaigns.error && <ErrorState error={campaigns.error} />}
        {campaigns.data?.length === 0 && <EmptyState>No campaigns are available.</EmptyState>}
        <div className='divide-y divide-p1-border border-y border-p1-border'>
          {campaigns.data?.map((campaign) => (
            <CampaignWorkspaceRow key={campaign.id} campaign={campaign} onOpen={() => navigate(`/phase1/campaign/${campaign.id}`)} />
          ))}
        </div>
      </main>
    </div>
  );
}

type AddAllJoinResult = {
  assigned: number;
  skippedSame: number;
  skippedAssigned: number;
  failed: number;
  firstError?: string;
  campaignName?: string;
};

export function Phase1CharactersPage() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [joinKey, setJoinKey] = useState('');
  const [reassign, setReassign] = useState(false);
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const characters = useQuery({
    queryKey: ['phase1-characters', session?.user.id],
    enabled: Boolean(session),
    queryFn: () => phase1Request<Character[]>('find-character', { user_id: session!.user.id }),
  });

  const addAllToJoinKey = useMutation({
    mutationFn: async (): Promise<AddAllJoinResult> => {
      const key = joinKey.trim();
      if (!key) throw new Error('Enter a join key.');
      const roster = characters.data ?? [];
      const campaigns = await phase1Request<Campaign[]>('find-campaign', { join_key: key });
      const campaign = campaigns?.[0];
      if (!campaign) throw new Error('Invalid join key. Please ask your GM for a valid key.');

      let skippedSame = 0;
      let skippedAssigned = 0;
      const eligible: Character[] = [];
      for (const character of roster) {
        if (character.campaign_id === campaign.id) {
          skippedSame += 1;
          continue;
        }
        if (character.campaign_id != null && !reassign) {
          skippedAssigned += 1;
          continue;
        }
        eligible.push(character);
      }

      let assigned = 0;
      let failed = 0;
      let firstError: string | undefined;
      for (const character of eligible) {
        try {
          await phase1Request('update-character', { id: character.id, campaign_id: campaign.id });
          assigned += 1;
        } catch (error) {
          failed += 1;
          if (!firstError) firstError = error instanceof Error ? error.message : 'update-character failed';
        }
      }

      return { assigned, skippedSame, skippedAssigned, failed, firstError, campaignName: campaign.name };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      void queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] });
      if (result.assigned === 0 && result.failed === 0) {
        setJoinStatus('Nothing to assign.');
        return;
      }
      const parts = [`Assigned ${result.assigned} to ${result.campaignName ?? 'campaign'}`];
      if (result.skippedSame) parts.push(`${result.skippedSame} already in campaign`);
      if (result.skippedAssigned) parts.push(`${result.skippedAssigned} already assigned`);
      if (result.failed) parts.push(`${result.failed} failed${result.firstError ? `: ${result.firstError}` : ''}`);
      setJoinStatus(parts.join(' · '));
    },
    onError: (error) => {
      setJoinStatus(error instanceof Error ? error.message : 'Could not add characters to join key.');
    },
  });

  const canAddAll = Boolean(joinKey.trim()) && Boolean(characters.data?.length) && !addAllToJoinKey.isPending;

  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <CampaignSignIn variant='phase1' />;
  return (
    <div className='min-h-screen bg-p1-page text-p1-text'>
      <WorkspaceHeader section='characters' />
      <main className='mx-auto max-w-5xl px-6 py-10'>
        <div className='mb-8 flex flex-wrap items-end justify-between gap-6 border-b border-p1-border pb-6'>
          <div>
            <Eyebrow>Phase 1</Eyebrow>
            <h1 className='mt-2 text-3xl font-semibold'>Character workspace</h1>
            <p className='mt-2 text-sm text-p1-muted'>Open a character sheet, or switch to Campaigns from the header.</p>
          </div>
          <div className='flex min-w-0 flex-col items-stretch gap-2 sm:items-end'>
            <div className='flex flex-wrap items-center gap-2'>
              <button type='button' className='toolbar-button' disabled={!canAddAll} onClick={() => addAllToJoinKey.mutate()}>
                <Plus size={15} />
                {addAllToJoinKey.isPending ? 'Adding…' : 'Add all'}
              </button>
              <div className='relative min-w-[12rem] flex-1'>
                <KeyRound className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-p1-faint' size={14} />
                <input
                  className='settings-input h-9 w-full pl-8'
                  aria-label='Join key'
                  placeholder='Join key'
                  value={joinKey}
                  disabled={addAllToJoinKey.isPending}
                  onChange={(event) => {
                    setJoinKey(event.target.value);
                    setJoinStatus(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canAddAll) addAllToJoinKey.mutate();
                  }}
                />
              </div>
            </div>
            <label className='flex items-center gap-2 text-sm text-p1-muted'>
              <input
                type='checkbox'
                checked={reassign}
                disabled={addAllToJoinKey.isPending}
                onChange={(event) => setReassign(event.target.checked)}
              />
              Reassign PCs to this join key
            </label>
            {joinStatus && <p className='max-w-md text-right text-xs text-p1-muted'>{joinStatus}</p>}
          </div>
        </div>
        {characters.isLoading && <EmptyState>Loading characters...</EmptyState>}
        {characters.error && <ErrorState error={characters.error} />}
        {characters.data?.length === 0 && <EmptyState>No characters are available.</EmptyState>}
        <div className='divide-y divide-p1-border border-y border-p1-border'>
          {characters.data?.map((character) => {
            const identity = [character.details?.ancestry?.name, character.details?.class?.name].filter(Boolean).join(' · ');
            return (
              <button key={character.id} className='group grid w-full grid-cols-[1fr_auto] items-center gap-6 px-2 py-5 text-left hover:bg-p1-hover' onClick={() => navigate(`/sheet/${character.id}`)}>
                <div>
                  <div className='font-semibold'>{character.name}</div>
                  <div className='mt-1 line-clamp-1 text-sm text-p1-muted'>Level {character.level}{identity ? ` · ${identity}` : ''}</div>
                </div>
                <ChevronRight className='text-p1-faint group-hover:text-p1-accent' size={18} />
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export function Phase1CampaignPage() {
  const session = useAuthSession();
  const location = useLocation();
  const { campaignId: rawCampaignId, encounterId: rawEncounterId, noteIndex: rawNoteIndex } = useParams();
  const campaignId = Number(rawCampaignId);
  const encounterId = rawEncounterId ? Number(rawEncounterId) : null;
  const viewingNotes = rawNoteIndex !== undefined;
  const viewingSettings = location.pathname.endsWith('/settings');
  const noteIndex = viewingNotes && Number.isFinite(Number(rawNoteIndex)) ? Number(rawNoteIndex) : null;
  const enabled = Boolean(session && Number.isFinite(campaignId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const encounterSaveChain = useRef(Promise.resolve<void>(undefined));
  const initiativeLogsRef = useRef(new Map<number, InitiativeRoundLog[]>());
  const campaignKey = ['phase1-campaign', campaignId, session?.user.id] as const;
  const encountersKey = ['phase1-encounters', campaignId, session?.user.id] as const;
  const playersKey = ['phase1-players', campaignId, session?.user.id] as const;
  const campaign = useQuery({ queryKey: campaignKey, enabled, queryFn: async () => (await phase1Request<Campaign[]>('find-campaign', { id: campaignId }))[0] ?? null });
  const players = useQuery({ queryKey: playersKey, enabled, queryFn: () => phase1Request<Character[]>('find-character', { campaign_id: campaignId }) });
  const encounters = useQuery({
    queryKey: encountersKey,
    enabled,
    queryFn: async () => overlayInitiativeLogs(await phase1Request<Encounter[]>('find-encounter', { campaign_id: campaignId }), initiativeLogsRef.current),
  });
  const updateEncounter = useMutation<boolean, Error, Encounter, { previous?: Encounter[] }>({
    mutationKey: ['phase1-update-encounter', campaignId],
    mutationFn: (encounter) => {
      const result = encounterSaveChain.current.then(() => phase1Request<boolean>('create-encounter', { ...encounter }));
      encounterSaveChain.current = result.then(() => undefined, () => undefined);
      return result;
    },
    onMutate: async (encounter) => {
      await queryClient.cancelQueries({ queryKey: encountersKey });
      const previous = queryClient.getQueryData<Encounter[]>(encountersKey);
      if (encounter.meta_data.initiative_log !== undefined) {
        initiativeLogsRef.current.set(encounter.id, encounter.meta_data.initiative_log);
      }
      queryClient.setQueryData<Encounter[]>(encountersKey, (current = []) => current.map((item) => item.id === encounter.id ? encounter : item));
      return { previous };
    },
    onError: (_error, _encounter, context) => {
      if (context?.previous) queryClient.setQueryData(encountersKey, context.previous);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ['phase1-update-encounter', campaignId] }) > 1) return;
      queryClient.invalidateQueries({ queryKey: encountersKey });
    },
  });

  const updateCharacter = useMutation<unknown, Error, { id: number; spells?: Character['spells']; details?: Character['details']; inventory?: Character['inventory']; hp_current?: number; hp_temp?: number; stamina_current?: number; resolve_current?: number }, { previous?: Character[] }>({
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
  const updateCampaign = useMutation<unknown, Error, Campaign, { previous?: Campaign | null }>({
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
  const resetJoinKey = useMutation({
    mutationFn: () => phase1Request<Campaign>('reset-campaign-key', { id: campaignId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKey }),
  });
  const kickPlayer = useMutation({
    mutationFn: (characterId: number) =>
      phase1Request('remove-from-campaign', { character_id: characterId, campaign_id: campaignId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: playersKey }),
  });
  const deleteCampaign = useMutation({
    mutationFn: () => phase1Request('delete-content', { id: campaignId, type: 'campaign' }),
    onSuccess: () => navigate('/phase1'),
  });
  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <CampaignSignIn variant='phase1' />;
  if (campaign.isLoading || players.isLoading || encounters.isLoading) return <LoadingScreen label='Loading campaign workspace' />;
  const error = campaign.error || players.error || encounters.error;
  if (error) return <PageError error={error} />;
  if (!campaign.data) return <PageError error={new Error('Campaign not found')} />;

  const campaignData = campaign.data;
  const isGm = campaignData.user_id === session.user.id;
  const ownIds = new Set((players.data ?? []).filter((item) => item.user_id === session.user.id).map((item) => item.id));
  const campaignEncounters = (encounters.data ?? []).filter((encounter) => encounter.campaign_id === campaignId);
  const visible = isGm ? campaignEncounters : campaignEncounters.filter((encounter) => encounter.combatants.list.some((item) => item.type === 'CHARACTER' && item.character && ownIds.has(item.character)));
  const notePages = visibleNotePages(campaignData, isGm);
  const selectedNote = noteIndex == null ? null : notePages.find((item) => item.index === noteIndex) ?? null;
  function handleDeleteNote(index: number) {
    const pages = [...(campaignData.notes?.pages ?? [])];
    pages.splice(index, 1);
    deleteNote.mutate({ ...campaignData, notes: { ...campaignData.notes, pages } });
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
  if (!viewingNotes && !viewingSettings && !encounterId && visible[0]) return <Navigate replace to={`/phase1/campaign/${campaignId}/encounters/${visible[0].id}`} />;
  if (viewingSettings && !isGm) return <PageError error={new Error('Campaign settings are only available to the game master.')} />;
  return (
    <EncounterWorkspace
      campaign={campaignData}
      encounters={visible}
      players={players.data ?? []}
      selectedEncounter={viewingNotes || viewingSettings ? null : visible.find((item) => item.id === encounterId) ?? null}
      notePages={notePages}
      selectedNote={selectedNote}
      viewingNotes={viewingNotes}
      viewingSettings={viewingSettings}
      isGm={isGm}
      sessionUserId={session.user.id}
      onUpdateEncounter={(encounter) => updateEncounter.mutate(encounter)}
      onUpdateCharacter={(id, fields) => updateCharacter.mutate({ id, ...fields })}
      onUpdateCampaign={(next) => updateCampaign.mutate(next)}
      onResetJoinKey={() => resetJoinKey.mutateAsync()}
      onKickPlayer={(characterId) => kickPlayer.mutateAsync(characterId)}
      onDeleteCampaign={() => deleteCampaign.mutateAsync()}
      onDeleteNote={handleDeleteNote}
      onDeleteEncounter={handleDeleteEncounter}
      rosterSaving={updateEncounter.isPending}
      campaignSaving={updateCampaign.isPending}
      rosterError={updateEncounter.error ?? updateCharacter.error ?? deleteEncounter.error ?? deleteNote.error}
      campaignError={updateCampaign.error ?? resetJoinKey.error ?? kickPlayer.error ?? deleteCampaign.error}
    />
  );
}


function EncounterWorkspace({ campaign, encounters, players, selectedEncounter, notePages, selectedNote, viewingNotes, viewingSettings, isGm, sessionUserId, onUpdateEncounter, onUpdateCharacter, onUpdateCampaign, onResetJoinKey, onKickPlayer, onDeleteCampaign, onDeleteNote, onDeleteEncounter, rosterSaving, campaignSaving, rosterError, campaignError }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; selectedEncounter: Encounter | null; notePages: IndexedNotePage[]; selectedNote: IndexedNotePage | null; viewingNotes: boolean; viewingSettings: boolean; isGm: boolean; sessionUserId: string; onUpdateEncounter: (encounter: Encounter) => void; onUpdateCharacter: (id: number, fields: { spells?: Character['spells']; details?: Character['details']; inventory?: Character['inventory']; hp_current?: number; hp_temp?: number; stamina_current?: number; resolve_current?: number }) => void; onUpdateCampaign: (campaign: Campaign) => void; onResetJoinKey: () => Promise<unknown>; onKickPlayer: (characterId: number) => Promise<unknown>; onDeleteCampaign: () => Promise<unknown>; onDeleteNote: (index: number) => void; onDeleteEncounter: (id: number) => void; rosterSaving: boolean; campaignSaving: boolean; rosterError: Error | null; campaignError: Error | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailWidth, setDetailWidth] = useState(readDetailWidth);
  const [activeTab, setActiveTab] = useState<DetailTab>('Health');
  const [initiativeOpen, setInitiativeOpen] = useState(false);
  const [creaturePickerOpen, setCreaturePickerOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const combatants = useMemo(() => populateCombatants(selectedEncounter?.combatants.list ?? [], players), [selectedEncounter, players]);
  const activeCombatants = useMemo(() => combatants.filter((combatant) => !isCombatantOut(combatant)), [combatants]);
  const outCombatants = useMemo(() => combatants.filter((combatant) => isCombatantOut(combatant)), [combatants]);
  const orderedCombatants = useMemo(() => sortCombatantsByInitiative(activeCombatants), [activeCombatants]);
  const selectedEncounterRef = useRef(selectedEncounter);
  const initiativeLogRef = useRef<InitiativeRoundLog[]>(selectedEncounter?.meta_data.initiative_log ?? []);
  const initiativeLogEncounterIdRef = useRef(selectedEncounter?.id ?? null);
  selectedEncounterRef.current = selectedEncounter;
  if (selectedEncounter && selectedEncounter.id !== initiativeLogEncounterIdRef.current) {
    initiativeLogEncounterIdRef.current = selectedEncounter.id;
    initiativeLogRef.current = selectedEncounter.meta_data.initiative_log ?? [];
  } else if (selectedEncounter?.meta_data.initiative_log && selectedEncounter.meta_data.initiative_log.length >= initiativeLogRef.current.length) {
    initiativeLogRef.current = selectedEncounter.meta_data.initiative_log;
  }
  const selected = combatants.find((item) => item._id === selectedId) ?? null;
  const statuses = useCombatantStatuses(selectedEncounter?.id ?? null, combatants);
  const encounterNote = notePages.find((item) => item.page.name.trim().toLowerCase() === selectedEncounter?.name.trim().toLowerCase());
  const noteEncounter = encounters.find((item) => item.name.trim().toLowerCase() === selectedNote?.page.name.trim().toLowerCase());
  const activeCharacterIds = new Set((selectedEncounter?.combatants.list ?? []).filter((combatant) => combatant.type === 'CHARACTER').map((combatant) => combatant.character));
  const benchPlayers = players.filter((player) => !activeCharacterIds.has(player.id));

  function persistRoster(list: Combatant[], metaPatch?: Partial<Encounter['meta_data']>) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm) return;
    const allies = populateCombatants(list, players).filter((combatant) => combatant.ally);
    const levels = allies.map((combatant) => combatant.data.level).filter(Number.isFinite);
    const initiative_log = metaPatch && 'initiative_log' in metaPatch
      ? metaPatch.initiative_log ?? []
      : encounter.meta_data.initiative_log ?? initiativeLogRef.current;
    initiativeLogRef.current = initiative_log;
    onUpdateEncounter({
      ...encounter,
      combatants: { list },
      meta_data: {
        ...encounter.meta_data,
        ...metaPatch,
        initiative_log,
        party_size: allies.length,
        party_level: levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0,
      },
    });
  }

  function updateRoster(list: Combatant[]) {
    if (rosterSaving) return;
    persistRoster(list);
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

  function addCreature(creature: Creature, ally: boolean) {
    if (!selectedEncounter) return;
    const id = crypto.randomUUID();
    updateRoster([
      ...selectedEncounter.combatants.list,
      {
        _id: id,
        type: 'CREATURE',
        ally,
        initiative: undefined,
        creature: structuredClone(creature),
        character: undefined,
        data: undefined,
      },
    ]);
    setSelectedId(id);
  }

  function cloneCreature(combatantId: string) {
    if (!selectedEncounter) return;
    const list = selectedEncounter.combatants.list;
    const index = list.findIndex((item) => item._id === combatantId);
    const source = index === -1 ? undefined : list[index];
    if (!source || source.type !== 'CREATURE') return;
    const copy = structuredClone(source);
    copy._id = crypto.randomUUID();
    copy.change_log = undefined;
    copy.action_log = undefined;
    copy.out = undefined;
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

  function updateInitiative(combatantId: string, initiative: number) {
    if (!selectedEncounter) return;
    persistRoster(selectedEncounter.combatants.list.map((combatant) => combatant._id === combatantId ? { ...combatant, initiative, initiative_roll: undefined } : combatant));
  }

  function rollInitiative(rollBonuses: Map<string, InitiativeRollChoice>) {
    const encounter = selectedEncounterRef.current;
    if (!encounter) return;
    const rolledIds = new Set<string>();
    const list = encounter.combatants.list.map((combatant) => {
      const choice = rollBonuses.get(combatant._id);
      if (!choice) return combatant;
      rolledIds.add(combatant._id);
      const die = rollDie('D20');
      return {
        ...combatant,
        initiative: die + choice.bonus,
        initiative_roll: { die, bonus: choice.bonus, source: choice.source },
      };
    });
    if (rolledIds.size === 0) {
      setInitiativeOpen(false);
      return;
    }
    const populated = populateCombatants(list, players).filter((combatant) => !isCombatantOut(combatant));
    const existingLog = initiativeLogRef.current.length ? initiativeLogRef.current : encounter.meta_data.initiative_log ?? [];
    const roundEntry = buildInitiativeRoundLog(nextInitiativeRoundNumber(existingLog), populated, rolledIds);
    persistRoster(list, { initiative_log: [...existingLog, roundEntry] });
    setInitiativeOpen(false);
  }

  function clearInitiative() {
    if (!selectedEncounter) return;
    persistRoster(selectedEncounter.combatants.list.map((combatant) => ({
      ...combatant,
      initiative: undefined,
      initiative_roll: undefined,
    })));
  }

  function clearInitiativeLog() {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm || rosterSaving) return;
    persistRoster(encounter.combatants.list, { initiative_log: [] });
  }

  function resetEncounterState() {
    if (!selectedEncounter || !isGm || rosterSaving) return;
    const populatedById = new Map(combatants.map((combatant) => [combatant._id, combatant]));
    persistRoster(
      selectedEncounter.combatants.list.map((combatant) => {
        const populated = populatedById.get(combatant._id);
        const maxHp = populated
          ? resolveResetMaxHp(populated.data, statuses.data?.[combatant._id]?.maxHp)
          : combatant.creature
            ? resolveResetMaxHp(combatant.creature)
            : 0;
        if (combatant.type === 'CHARACTER' && combatant.character) {
          const character = players.find((player) => player.id === combatant.character);
          if (character) {
            const resetEntity = resetEntityCombatState(character, maxHp);
            onUpdateCharacter(combatant.character, {
              hp_current: resetEntity.hp_current,
              hp_temp: resetEntity.hp_temp,
              details: resetEntity.details,
              spells: resetEntity.spells,
            });
          }
        }
        return resetCombatant(combatant, maxHp);
      }),
      { initiative_log: [] },
    );
    setResetOpen(false);
  }

  function maxEncounterStats() {
    if (!selectedEncounter || !isGm || rosterSaving) return;
    const populatedById = new Map(combatants.map((combatant) => [combatant._id, combatant]));
    persistRoster(
      selectedEncounter.combatants.list.map((combatant) => {
        const populated = populatedById.get(combatant._id);
        const maxHp = populated
          ? resolveResetMaxHp(populated.data, statuses.data?.[combatant._id]?.maxHp)
          : combatant.creature
            ? resolveResetMaxHp(combatant.creature)
            : 0;
        if (combatant.type === 'CHARACTER' && combatant.character) {
          const character = players.find((player) => player.id === combatant.character);
          if (character) {
            const maxed = maxEntityStats(character, maxHp);
            onUpdateCharacter(combatant.character, {
              hp_current: maxed.hp_current,
              stamina_current: maxed.stamina_current,
              resolve_current: maxed.resolve_current,
              spells: maxed.spells,
              inventory: maxed.inventory,
            });
          }
        }
        return maxCombatantStats(combatant, maxHp);
      }),
    );
  }

  function setCombatantOut(combatantId: string, out: Combatant['out']) {
    if (!selectedEncounter) return;
    persistRoster(selectedEncounter.combatants.list.map((combatant) => (
      combatant._id === combatantId ? { ...combatant, out } : combatant
    )));
  }

  function updateRoundNote(round: InitiativeRoundLog, entry: InitiativeRoundLogEntry, note: string) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm || rosterSaving) return;
    persistRoster(encounter.combatants.list, {
      initiative_log: setRoundLogEntryNote(initiativeLogRef.current, round, entry, note),
    });
  }

  const canManageCombatant = (combatant: PopulatedCombatant) => {
    if (isGm) return true;
    if (combatant.type === 'CHARACTER' && combatant.character) {
      const owner = players.find((player) => player.id === combatant.character);
      return owner?.user_id === sessionUserId;
    }
    return false;
  };

  const canManageSpells = useMemo(() => {
    if (!selected) return false;
    return canManageCombatant(selected);
  }, [selected, isGm, players, sessionUserId]);

  function persistCombatantChange(combatant: PopulatedCombatant, entity: LivingEntity, field: 'hp_current' | 'hp_temp' | 'conditions', from: unknown, to: unknown, note: string | null) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || rosterSaving) return;
    const rawCombatant = encounter.combatants.list.find((item) => item._id === combatant._id);
    if (!rawCombatant) return;
    const loggedCombatant = appendChangeLog(rawCombatant, createChangeLogEntry(field, from, to, note));
    const list = encounter.combatants.list.map((item) => (item._id === combatant._id ? loggedCombatant : item));
    if (combatant.type === 'CHARACTER' && combatant.character) {
      onUpdateCharacter(combatant.character, characterCombatFieldsFromEntity(entity));
      persistRoster(list);
      return;
    }
    if (combatant.type === 'CREATURE') {
      persistRoster(list.map((item) => (item._id === combatant._id ? { ...loggedCombatant, creature: entity as Creature } : item)));
    }
  }

  function persistHpCurrent(combatant: PopulatedCombatant, raw: string, note: string | null, maxHp: number) {
    const from = combatant.data.hp_current;
    const result = confirmHealth(raw, maxHp, combatant.data);
    if (!result || result.value === from) return;
    persistCombatantChange(combatant, result.entity, 'hp_current', from, result.value, note);
  }

  function persistTempHp(combatant: PopulatedCombatant, raw: string, note: string | null) {
    const from = combatant.data.hp_temp;
    const next = parseTempHpInput(raw);
    if (next === from) return;
    persistCombatantChange(combatant, { ...combatant.data, hp_temp: next }, 'hp_temp', from, next, note);
  }

  function persistHpCurrentById(combatantId: string, raw: string, note: string | null) {
    const combatant = combatants.find((item) => item._id === combatantId);
    if (!combatant || !canManageCombatant(combatant)) return;
    const maxHp = statuses.data?.[combatantId]?.maxHp ?? statsFor(combatant.data).maxHp;
    persistHpCurrent(combatant, raw, note, maxHp);
  }

  function persistCreature(entity: LivingEntity) {
    const encounter = selectedEncounterRef.current;
    if (!selected || !encounter || selected.type !== 'CREATURE') return;
    persistRoster(encounter.combatants.list.map((combatant) => combatant._id === selected._id ? { ...combatant, creature: entity } as Combatant : combatant));
  }

  function persistEntitySpells(entity: LivingEntity) {
    if (!selected || !selectedEncounter) return;
    if (selected.type === 'CHARACTER' && selected.character) {
      onUpdateCharacter(selected.character, { spells: entity.spells });
      return;
    }
    persistCreature(entity);
  }

  function persistConditions(conditions: Condition[], note: string | null = null) {
    if (!selected || !selectedEncounter) return;
    const from = selected.data.details?.conditions ?? [];
    if (JSON.stringify(from) === JSON.stringify(conditions)) return;
    const details = { ...selected.data.details, conditions };
    persistCombatantChange(selected, { ...selected.data, details }, 'conditions', from, conditions, note);
  }

  function persistCombatantRecord(next: Combatant) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || rosterSaving) return;
    const list = encounter.combatants.list.map((item) => (item._id === next._id ? next : item));
    if (isGm) {
      persistRoster(list);
      return;
    }
    onUpdateEncounter({
      ...encounter,
      combatants: { list },
      meta_data: { ...encounter.meta_data },
    });
  }

  function persistLogAction(draft: ActionLogDraft) {
    const encounter = selectedEncounterRef.current;
    if (!selected || !encounter) return;
    const raw = encounter.combatants.list.find((item) => item._id === selected._id);
    if (!raw) return;
    persistCombatantRecord(appendActionLog(raw, createActionLogEntry(draft, currentActionRound(encounter.meta_data.initiative_log))));
  }

  function persistDeleteLogEntry(entryId: string) {
    const encounter = selectedEncounterRef.current;
    if (!selected || !encounter) return;
    const raw = encounter.combatants.list.find((item) => item._id === selected._id);
    if (!raw) return;
    persistCombatantRecord(removeActionLogEntry(raw, entryId));
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
          if (!selected || !entry.spell) return;
          persistEntitySpells(await setEntityInnateSpent(selected as Phase1EntityCombatant, entry.spell.id, entry.rank, castsCurrent));
        },
        addToList: async (sourceName, spell, rank) => {
          if (!selected) return;
          persistEntitySpells(await addEntitySpellToList(selected as Phase1EntityCombatant, sourceName, spell, rank));
        },
        removeFromList: async (sourceName, spellId, rank) => {
          if (!selected) return;
          persistEntitySpells(await removeEntitySpellFromList(selected as Phase1EntityCombatant, sourceName, spellId, rank));
        },
        prepareSlot: async (sourceName, slotId, spell, rank) => {
          if (!selected) return;
          persistEntitySpells(await prepareEntitySpellSlot(selected as Phase1EntityCombatant, sourceName, slotId, spell, rank));
        },
        applyDivineFont: async (sourceName, choice) => {
          if (!selected) return;
          persistEntitySpells(await applyEntityDivineFont(selected as Phase1EntityCombatant, sourceName, choice));
        },
      }
    : undefined;
  useEffect(() => {
    setSelectedId(null);
    setInitiativeOpen(false);
    setCreaturePickerOpen(false);
    setResetOpen(false);
  }, [selectedEncounter?.id]);
  useEffect(() => window.localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth)), [detailWidth]);

  return (
    <div className='flex h-screen min-h-[680px] flex-col overflow-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader label={campaign.name} campaignId={campaign.id} encounterId={selectedEncounter?.id ?? null} noteIndex={selectedNote?.index ?? null} viewingSettings={viewingSettings} />
      <div className={`grid min-h-0 flex-1 ${viewingNotes || viewingSettings ? 'grid-cols-[248px_minmax(280px,1fr)]' : 'grid-cols-[248px_minmax(280px,1fr)_6px_auto]'}`}>
        <CampaignRail campaign={campaign} encounters={encounters} players={benchPlayers} outCombatants={outCombatants} selectedEncounter={selectedEncounter} selectedId={selectedId} notePages={notePages} selectedNoteIndex={selectedNote?.index ?? null} viewingSettings={viewingSettings} isGm={isGm} rosterSaving={rosterSaving} onRemovePlayer={removePlayer} onAddAllPlayers={addAllPlayers} onSelectCombatant={setSelectedId} onMarkOut={setCombatantOut} onDeleteNote={onDeleteNote} onDeleteEncounter={onDeleteEncounter} />
        <main className='min-w-0 overflow-auto bg-p1-surface'>
          {viewingSettings ? (
            <SettingsSurface
              campaign={campaign}
              players={players}
              onUpdateCampaign={onUpdateCampaign}
              onResetJoinKey={onResetJoinKey}
              onKickPlayer={onKickPlayer}
              onDeleteCampaign={onDeleteCampaign}
              saving={campaignSaving}
              error={campaignError}
            />
          ) : viewingNotes ? (
            <NoteSurface note={selectedNote} isGm={isGm} encounterLink={noteEncounter ? { href: `/phase1/campaign/${campaign.id}/encounters/${noteEncounter.id}`, name: noteEncounter.name } : undefined} />
          ) : (
            <>
              <EncounterHeader encounter={selectedEncounter} combatants={combatants} count={activeCombatants.length} isGm={isGm} noteLink={encounterNote ? { href: `/phase1/campaign/${campaign.id}/notes/${encounterNote.index}`, name: encounterNote.page.name } : undefined} canAddCreature={isGm && !rosterSaving} onAddCreature={() => setCreaturePickerOpen(true)} canRollInitiative={isGm && activeCombatants.length > 0} onRollInitiative={() => setInitiativeOpen(true)} canClearInitiative={isGm && activeCombatants.some((combatant) => combatant.initiative != null)} onClearInitiative={clearInitiative} canMaxStats={isGm && combatants.length > 0 && !rosterSaving} onMaxStats={maxEncounterStats} canReset={isGm && Boolean(selectedEncounter) && !rosterSaving} onReset={() => setResetOpen(true)} />
              {rosterError && <div className='border-b border-p1-danger/40 bg-p1-danger/10 px-5 py-2 text-xs text-p1-danger-soft'>Roster update failed: {rosterError.message}</div>}
              <div className='p-5'>
                <CombatantGrid combatants={orderedCombatants} selectedId={selectedId} onSelect={setSelectedId} statuses={statuses.data} calculating={statuses.isLoading} canManageRoster={isGm && !rosterSaving} canManageCombatant={canManageCombatant} onAddPlayer={addPlayer} onRemovePlayer={removePlayer} onCloneCreature={cloneCreature} onDeleteCreature={deleteCreature} onRestoreCombatant={(id) => setCombatantOut(id, undefined)} onMarkOut={setCombatantOut} onUpdateInitiative={updateInitiative} onUpdateHp={persistHpCurrentById} />
                <InitiativeRoundLogPanel log={selectedEncounter?.meta_data.initiative_log ?? []} canEdit={isGm && !rosterSaving} canClear={isGm && !rosterSaving} onClear={clearInitiativeLog} onUpdateNote={updateRoundNote} />
              </div>
              {initiativeOpen && selectedEncounter && (
                <InitiativeRollModal
                  combatants={activeCombatants}
                  onConfirm={rollInitiative}
                  onClose={() => setInitiativeOpen(false)}
                />
              )}
              {creaturePickerOpen && (
                <SelectCreatureModal
                  busy={rosterSaving}
                  onSelect={addCreature}
                  onClose={() => setCreaturePickerOpen(false)}
                />
              )}
              {resetOpen && (
                <ConfirmDialog
                  title='Reset encounter'
                  message='This restores every combatant to full HP and clears temp HP, conditions, spell usage, initiative, and logs. Player characters will also be updated on their character records.'
                  confirmLabel='Reset'
                  onCancel={() => setResetOpen(false)}
                  onConfirm={resetEncounterState}
                />
              )}
            </>
          )}
        </main>
        {!viewingNotes && !viewingSettings && (
          <>
            <ResizeRail onResize={(delta) => setDetailWidth((width) => clamp(width - delta, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX))} />
            <Inspector combatant={selected} width={detailWidth} activeTab={normalizeDetailTab(activeTab)} onTab={setActiveTab} hasMatchingCampaignNote={Boolean(encounterNote)} status={selected ? statuses.data?.[selected._id] : undefined} statusLoading={statuses.isLoading} canManageSpells={canManageSpells} spellActions={spellActions} onChangeConditions={canManageSpells ? persistConditions : undefined} onSaveGmNotes={isGm && selected?.type === 'CREATURE' ? persistGmNotes : undefined} onPersistHpCurrent={selected && canManageSpells ? (raw, note) => persistHpCurrent(selected, raw, note, statuses.data?.[selected._id]?.maxHp ?? statsFor(selected.data).maxHp) : undefined} onPersistTempHp={selected && canManageSpells ? (raw, note) => persistTempHp(selected, raw, note) : undefined} initiativeLog={selectedEncounter?.meta_data.initiative_log ?? []} canEditRoundNotes={isGm && !rosterSaving} onUpdateRoundNote={updateRoundNote} onLogAction={selected && canManageSpells ? persistLogAction : undefined} onDeleteLogEntry={selected && canManageSpells ? persistDeleteLogEntry : undefined} />
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
    queryKey: ['phase1-encounter-statuses', 'isolated-store', 'keep-encounter-ops', encounterId, signature],
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
function WorkspaceHeader({ label, section, campaignId, encounterId, noteIndex, viewingSettings }: { label?: string; section?: 'campaigns' | 'characters'; campaignId?: number | null; encounterId?: number | null; noteIndex?: number | null; viewingSettings?: boolean }) {
  const navClass = (active: boolean) => `text-sm ${active ? 'text-p1-text' : 'text-p1-muted hover:text-p1-text'}`;
  return (
    <header className='flex h-14 shrink-0 items-center gap-4 border-b border-p1-border bg-p1-header px-5'>
      <a href='/' className='font-semibold'>Wanderer's Guide</a>
      <span className='h-4 w-px bg-p1-border' />
      <Link to='/phase1' className={navClass(section === 'campaigns')}>Campaigns</Link>
      <Link to='/phase1/characters' className={navClass(section === 'characters')}>Characters</Link>
      {label && <><span className='text-p1-faint'>/</span><span className='truncate text-sm text-p1-muted'>{label}</span></>}
      <div className='ml-auto flex items-center gap-2'><Phase1ThemeToggle /><PhaseViewSwitch current='phase1' section={section} campaignId={campaignId} encounterId={encounterId} noteIndex={noteIndex} viewingSettings={viewingSettings} /><button className='icon-button' title='Switch account' onClick={() => supabase.auth.signOut()}><LogOut size={15} /></button></div>
    </header>
  );
}

function CampaignRail({ campaign, encounters, players, outCombatants, selectedEncounter, selectedId, notePages, selectedNoteIndex, viewingSettings, isGm, rosterSaving, onRemovePlayer, onAddAllPlayers, onSelectCombatant, onMarkOut, onDeleteNote, onDeleteEncounter }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; outCombatants: PopulatedCombatant[]; selectedEncounter: Encounter | null; selectedId: string | null; notePages: IndexedNotePage[]; selectedNoteIndex: number | null; viewingSettings: boolean; isGm: boolean; rosterSaving: boolean; onRemovePlayer: (combatantId: string) => void; onAddAllPlayers: () => void; onSelectCombatant: (id: string) => void; onMarkOut: (combatantId: string, out: Combatant['out']) => void; onDeleteNote: (index: number) => void; onDeleteEncounter: (id: number) => void;
}) {
  const [benchActive, setBenchActive] = useState(false);
  const [outActive, setOutActive] = useState(false);
  const [notesOpen, setNotesOpen] = useState(selectedNoteIndex != null);
  const [encountersOpen, setEncountersOpen] = useState(selectedEncounter != null);
  const [menu, setMenu] = useState<RailContextTarget | null>(null);
  const [benchMenu, setBenchMenu] = useState<{ x: number; y: number } | null>(null);
  const [outMenu, setOutMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RailContextTarget | null>(null);
  const canManageRoster = isGm && !rosterSaving && Boolean(selectedEncounter);

  function dropOnBench(event: ReactDragEvent<HTMLDivElement>) {
    const payload = readCombatantDrag(event);
    setBenchActive(false);
    if (!canManageRoster || payload?.source !== 'encounter' || !payload.combatantId || payload.characterId == null) return;
    event.preventDefault();
    onRemovePlayer(payload.combatantId);
  }

  function dropOnOut(event: ReactDragEvent<HTMLDivElement>) {
    const payload = readCombatantDrag(event);
    setOutActive(false);
    if (!canManageRoster || payload?.source !== 'encounter' || !payload.combatantId) return;
    event.preventDefault();
    onMarkOut(payload.combatantId, 'incapacitated');
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
    <aside className='min-h-0 overflow-y-auto border-r border-p1-border bg-p1-header'>
      <div className='border-b border-p1-border p-4'>
        <Link to='/phase1' className='mb-5 flex items-center gap-2 text-xs text-p1-muted hover:text-p1-text'><ArrowLeft size={14} /> Campaigns</Link>
        <Eyebrow>{isGm ? 'Game master' : 'Player'}</Eyebrow><h1 className='mt-2 text-lg font-semibold leading-tight'>{campaign.name}</h1>
      </div>
      <RailLabel icon={<BookOpen size={14} />} label='Notes' count={notePages.length} open={notesOpen} onToggle={() => setNotesOpen((value) => !value)} />
      {notesOpen && (
        <nav className='px-2 pb-4'>
          {notePages.map(({ page, index }) => (
            <Link
              key={`${page.name}-${index}`}
              to={`/phase1/campaign/${campaign.id}/notes/${index}`}
              onContextMenu={(event) => openRailMenu(event, { kind: 'note', id: index, name: page.name })}
              className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedNoteIndex === index ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
            >
              <span className='block truncate'>{page.name}</span>
              {isGm && <span className='mt-0.5 block text-[11px] text-p1-faint'>{page.shared ? 'Shared with party' : 'GM only'}</span>}
            </Link>
          ))}
          {notePages.length === 0 && <p className='px-3 py-4 text-xs leading-5 text-p1-faint'>{isGm ? 'No campaign notes yet.' : 'No shared campaign notes.'}</p>}
        </nav>
      )}
      <RailLabel icon={<Swords size={14} />} label='Encounters' count={encounters.length} open={encountersOpen} onToggle={() => setEncountersOpen((value) => !value)} />
      {encountersOpen && (
        <nav className='px-2 pb-4'>
          {encounters.map((encounter) => (
            <Link
              key={encounter.id}
              to={`/phase1/campaign/${campaign.id}/encounters/${encounter.id}`}
              onContextMenu={(event) => openRailMenu(event, { kind: 'encounter', id: encounter.id, name: encounter.name })}
              className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedEncounter?.id === encounter.id ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
            >
              <span className='block truncate'>{encounter.name}</span>
              <span className='mt-0.5 block text-[11px] text-p1-faint'>{encounter.combatants.list.length} combatants</span>
            </Link>
          ))}
          {encounters.length === 0 && <p className='px-3 py-4 text-xs leading-5 text-p1-faint'>No encounters are visible for this campaign.</p>}
        </nav>
      )}
      {isGm && (
        <>
          <RailLabel icon={<Settings size={14} />} label='Settings' />
          <nav className='px-2 pb-4'>
            <Link
              to={`/phase1/campaign/${campaign.id}/settings`}
              className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${viewingSettings ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
            >
              <span className='block truncate'>Campaign settings</span>
              <span className='mt-0.5 block text-[11px] text-p1-faint'>Player defaults and game config</span>
            </Link>
          </nav>
        </>
      )}
      {selectedEncounter && (
        <>
          <RailLabel icon={<UsersRound size={14} />} label='Party bench' count={players.length} onContextMenu={openBenchMenu} />
          <div className={`mx-2 min-h-16 border px-1 pb-4 pt-1 transition-colors ${benchActive ? 'border-p1-accent bg-p1-accent/[0.07]' : 'border-transparent'}`} onContextMenu={openBenchMenu} onDragOver={(event) => { if (canManageRoster && hasCombatantDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setBenchActive(true); } }} onDragLeave={() => setBenchActive(false)} onDrop={dropOnBench}>
            {players.map((player) => <a key={player.id} href={`/sheet/${player.id}`} target='_blank' rel='noreferrer' draggable={canManageRoster} onDragStart={(event) => writeCombatantDrag(event, { source: 'bench', characterId: player.id })} onDragEnd={() => setBenchActive(false)} className='flex items-center gap-2 px-2 py-2 text-sm text-p1-muted hover:bg-p1-hover hover:text-p1-text'>{canManageRoster && <GripVertical size={14} className='shrink-0 cursor-grab text-p1-faint' />}<UserRound size={15} /><span className='min-w-0 flex-1 truncate'>{player.name}</span><ExternalLink size={12} /></a>)}
            {players.length === 0 && <p className='px-2 py-3 text-xs text-p1-faint'>No PCs on the bench.</p>}
          </div>
          <RailLabel icon={<Skull size={14} />} label='Dead / Incapacitated' count={outCombatants.length} />
          <div className={`mx-2 min-h-16 border px-1 pb-4 pt-1 transition-colors ${outActive ? 'border-p1-accent bg-p1-accent/[0.07]' : 'border-transparent'}`} onDragOver={(event) => { if (canManageRoster && hasCombatantDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOutActive(true); } }} onDragLeave={() => setOutActive(false)} onDrop={dropOnOut}>
            {outCombatants.map((combatant) => (
              <button
                key={combatant._id}
                type='button'
                draggable={canManageRoster}
                onDragStart={(event) => writeCombatantDrag(event, { source: 'out', combatantId: combatant._id, characterId: combatant.character })}
                onDragEnd={() => setOutActive(false)}
                onClick={() => onSelectCombatant(combatant._id)}
                onContextMenu={(event) => {
                  if (!canManageRoster) return;
                  event.preventDefault();
                  setOutMenu({ id: combatant._id, x: event.clientX, y: event.clientY });
                }}
                className={`flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-p1-hover ${combatant._id === selectedId ? 'bg-p1-hover text-p1-text' : 'text-p1-muted hover:text-p1-text'}`}
              >
                {canManageRoster && <GripVertical size={14} className='shrink-0 cursor-grab text-p1-faint' />}
                <Skull size={15} className='shrink-0' />
                <span className='min-w-0 flex-1 truncate'>{combatant.data.name}</span>
                <span className='shrink-0 text-[10px] uppercase text-p1-faint'>{combatant.out === 'dead' ? 'Dead' : 'Incap.'}</span>
              </button>
            ))}
            {outCombatants.length === 0 && <p className='px-2 py-3 text-xs text-p1-faint'>No combatants out of the fight.</p>}
          </div>
        </>
      )}
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
      {outMenu && (
        <OutContextMenu
          x={outMenu.x}
          y={outMenu.y}
          onClose={() => setOutMenu(null)}
          onReturn={() => {
            setOutMenu(null);
            onMarkOut(outMenu.id, undefined);
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === 'note' ? 'Delete note' : 'Delete encounter'}
          message={`Are you sure you want to delete "${pendingDelete.name}"?`}
          confirmLabel='Delete'
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
function RailLabel({ icon, label, count, open, onToggle, onContextMenu }: { icon: ReactNode; label: string; count?: number; open?: boolean; onToggle?: () => void; onContextMenu?: (event: ReactMouseEvent) => void }) {
  const className = `flex w-full items-center gap-2 px-5 pb-2 pt-5 text-[10px] font-semibold uppercase text-p1-faint ${onToggle ? 'hover:text-p1-muted' : ''}`;
  const content = (
    <>
      {icon}{label}
      {count != null && <span className='ml-auto'>{count}</span>}
      {onToggle && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
    </>
  );
  if (onToggle) {
    return <button type='button' className={className} aria-expanded={open} onClick={onToggle} onContextMenu={onContextMenu}>{content}</button>;
  }
  return <div className={className} onContextMenu={onContextMenu}>{content}</div>;
}

type RailContextTarget = { kind: 'note' | 'encounter'; id: number; name: string; x: number; y: number };

function PlayerContextMenu({ x, y, onClose, onRemove, onIncapacitate, onMarkDead }: { x: number; y: number; onClose: () => void; onRemove: () => void; onIncapacitate: () => void; onMarkDead: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - 140);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onIncapacitate}>
          <Skull size={14} /> Move to incapacitated
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onMarkDead}>
          <Skull size={14} /> Mark dead
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onRemove}>
          <UserMinus size={14} /> Remove
        </button>
      </div>
    </>,
    document.body
  );
}

function CombatantContextMenu({ x, y, onClose, onClone, onIncapacitate, onMarkDead, onDelete }: { x: number; y: number; onClose: () => void; onClone: () => void; onIncapacitate: () => void; onMarkDead: () => void; onDelete: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - 168);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onClone}>
          <Copy size={14} /> Clone
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onIncapacitate}>
          <Skull size={14} /> Move to incapacitated
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onMarkDead}>
          <Skull size={14} /> Mark dead
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>,
    document.body
  );
}

function OutContextMenu({ x, y, onClose, onReturn }: { x: number; y: number; onClose: () => void; onReturn: () => void }) {
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
      <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onReturn}>
          <RotateCcw size={14} /> Return to encounter
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
      <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' disabled={disabled} className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint disabled:hover:bg-transparent' onClick={onAddAll}>
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
      <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>,
    document.body
  );
}

const COMBATANT_DRAG_TYPE = 'application/x-wanderers-guide-player';
type CombatantDragPayload = { source: 'bench' | 'encounter' | 'out'; combatantId?: string; characterId?: number };

function writeCombatantDrag(event: ReactDragEvent, payload: CombatantDragPayload) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(COMBATANT_DRAG_TYPE, JSON.stringify(payload));
}
function readCombatantDrag(event: ReactDragEvent): CombatantDragPayload | null {
  try {
    const value = event.dataTransfer.getData(COMBATANT_DRAG_TYPE);
    return value ? JSON.parse(value) as CombatantDragPayload : null;
  } catch {
    return null;
  }
}
function hasCombatantDrag(event: ReactDragEvent) {
  return Array.from(event.dataTransfer.types).includes(COMBATANT_DRAG_TYPE);
}
function EncounterDifficultyModal({ difficulty, onClose }: { difficulty: EncounterDifficulty; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  const partyLevelLabel = Number.isInteger(difficulty.partyLevel) ? String(difficulty.partyLevel) : difficulty.partyLevel.toFixed(1);
  const sum = difficulty.lines.map((line) => line.xp).join(' + ') || '0';
  return createPortal(
    <div
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='xp-challenge-title' className='flex max-h-[min(82vh,720px)] w-full max-w-xl flex-col border border-p1-border bg-p1-surface shadow-2xl'>
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <h2 id='xp-challenge-title' className='text-xl font-semibold'>XP challenge</h2>
              <span className='xp-challenge pointer-events-none'>
                <span className={`xp-challenge-dot xp-challenge-dot-${difficulty.color}`} />
                {difficulty.status} ({difficulty.xp} XP)
              </span>
            </div>
            <p className='mt-1 text-xs text-p1-muted'>Pathfinder 2e encounter budget from creature levels vs party level. Not an operations formula.</p>
          </div>
          <button type='button' className='icon-button shrink-0' onClick={onClose} title='Close'><X size={18} /></button>
        </header>
        <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4'>
          <div className='grid grid-cols-2 gap-3 text-sm'>
            <div className='border border-p1-border bg-p1-inset px-3 py-2'>
              <p className='text-[10px] uppercase text-p1-faint'>Party level</p>
              <p className='mt-0.5 font-semibold'>{partyLevelLabel}</p>
              <p className='text-xs text-p1-muted'>{difficulty.partyLevelFromEncounter ? 'Stored on the encounter' : 'Average of allies in the encounter'}</p>
            </div>
            <div className='border border-p1-border bg-p1-inset px-3 py-2'>
              <p className='text-[10px] uppercase text-p1-faint'>Party size</p>
              <p className='mt-0.5 font-semibold'>{difficulty.partySize}</p>
              <p className='text-xs text-p1-muted'>{difficulty.partySizeFromEncounter ? 'Stored on the encounter' : 'Allies in the encounter'} · thresholds use size − 4 = {difficulty.partySize - 4}</p>
            </div>
          </div>
          <div className='border border-p1-border'>
            <div className='border-b border-p1-border bg-p1-inset px-3 py-2 text-sm font-semibold'>Enemy XP</div>
            <table className='w-full border-collapse text-sm'>
              <thead>
                <tr className='border-b border-p1-border text-left text-[10px] uppercase text-p1-faint'>
                  <th className='px-3 py-2'>Creature</th>
                  <th className='px-3 py-2'>Level</th>
                  <th className='px-3 py-2'>Vs party</th>
                  <th className='px-3 py-2 text-right'>XP</th>
                </tr>
              </thead>
              <tbody>
                {difficulty.lines.map((line, index) => (
                  <tr key={`${line.name}-${index}`} className='border-b border-p1-border last:border-0'>
                    <td className='px-3 py-2'>{line.name}</td>
                    <td className='px-3 py-2 text-p1-muted'>{line.level}</td>
                    <td className='px-3 py-2 text-p1-muted'>{formatLevelDelta(line.delta)}</td>
                    <td className='px-3 py-2 text-right font-semibold'>{line.xp}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className='border-t border-p1-border bg-p1-inset'>
                  <td className='px-3 py-2 text-p1-muted' colSpan={3}>{sum} = {difficulty.xp}</td>
                  <td className='px-3 py-2 text-right font-semibold'>{difficulty.xp} XP</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className='border border-p1-border'>
            <div className='border-b border-p1-border bg-p1-inset px-3 py-2 text-sm font-semibold'>Difficulty bands</div>
            <ul className='divide-y divide-p1-border text-sm'>
              {difficulty.thresholds.map((band) => (
                <li key={band.status} className={`flex items-center justify-between px-3 py-2 ${band.status === difficulty.status ? 'bg-p1-accent/[0.08]' : ''}`}>
                  <span className={band.status === difficulty.status ? 'font-semibold' : 'text-p1-muted'}>{band.status}</span>
                  <span className='text-p1-muted'>{band.status === 'Trivial' ? `< ${difficulty.thresholds[1]?.min ?? 50}` : `≥ ${band.min}`}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function EncounterHeader({ encounter, combatants, count, isGm, noteLink, canAddCreature, onAddCreature, canRollInitiative, onRollInitiative, canClearInitiative, onClearInitiative, canMaxStats, onMaxStats, canReset, onReset }: { encounter: Encounter | null; combatants: PopulatedCombatant[]; count: number; isGm: boolean; noteLink?: { href: string; name: string }; canAddCreature?: boolean; onAddCreature?: () => void; canRollInitiative?: boolean; onRollInitiative?: () => void; canClearInitiative?: boolean; onClearInitiative?: () => void; canMaxStats?: boolean; onMaxStats?: () => void; canReset?: boolean; onReset?: () => void }) {
  const [xpOpen, setXpOpen] = useState(false);
  const difficulty = encounter && shouldDisplayEncounterDifficulty(combatants) ? calculateDifficulty(encounter, combatants) : null;
  return (
    <div className='sticky top-0 z-10 border-b border-p1-border bg-p1-surface/95 px-5 py-4 backdrop-blur'>
      <div className='flex items-center gap-5'>
        <div className='min-w-0 flex-1'><Eyebrow>{isGm ? 'GM encounter' : 'Assigned encounter'}</Eyebrow><h2 className='mt-1 truncate text-xl font-semibold'>{encounter?.name ?? 'No encounter selected'}</h2>{noteLink ? <Link to={noteLink.href} className='mt-1 block truncate text-xs text-p1-accent hover:underline'>See campaign Notes page: {noteLink.name}</Link> : <p className='mt-1 truncate text-xs text-p1-faint'>{encounter?.meta_data.description || `${count} combatants`}</p>}</div>
        {difficulty && (
          <button type='button' className='xp-challenge' title='Open XP budget math' onClick={() => setXpOpen(true)}>
            <span className={`xp-challenge-dot xp-challenge-dot-${difficulty.color}`} />
            {difficulty.status} ({difficulty.xp} XP)
          </button>
        )}
        {xpOpen && difficulty && <EncounterDifficultyModal difficulty={difficulty} onClose={() => setXpOpen(false)} />}
        {isGm && <button className='toolbar-button' disabled={!canAddCreature} title={canAddCreature ? 'Add a creature from the catalog' : 'Wait for the roster to finish saving'} onClick={onAddCreature}><Swords size={15} /> Add creature</button>}
        <button className='toolbar-button' disabled={!canRollInitiative} title={!isGm ? 'GM only' : count === 0 ? 'Add combatants first' : 'Roll initiative'} onClick={onRollInitiative}><GiDiceTwentyFacesTwenty size={15} /> Roll initiative</button>
        <button className='toolbar-button' disabled={!canClearInitiative} title={!isGm ? 'GM only' : canClearInitiative ? 'Clear initiative and restore roster order' : 'No initiative to clear'} onClick={onClearInitiative}><Eraser size={15} /> Clear init</button>
        <button className='toolbar-button' disabled={!canMaxStats} title={!isGm ? 'GM only' : canMaxStats ? 'Restore HP, spells, focus, wands/staves, and other encounter consumables' : count === 0 ? 'Add combatants first' : 'Wait for the roster to finish saving'} onClick={onMaxStats}><HeartPulse size={15} /> Max stats</button>
        <button className='toolbar-button' disabled={!canReset} title={!isGm ? 'GM only' : canReset ? 'Reset HP, temp HP, conditions, spells, initiative, and logs' : 'Wait for the roster to finish saving'} onClick={onReset}><RotateCcw size={15} /> Reset</button>
        <button className='toolbar-button' disabled title='Available after read-only parity'><Shield size={15} /> Group check</button>
      </div>
    </div>
  );
}

function CombatantGrid({ combatants, selectedId, onSelect, statuses, calculating, canManageRoster, canManageCombatant, onAddPlayer, onRemovePlayer, onCloneCreature, onDeleteCreature, onRestoreCombatant, onMarkOut, onUpdateInitiative, onUpdateHp }: { combatants: PopulatedCombatant[]; selectedId: string | null; onSelect: (id: string) => void; statuses?: CombatantStatusMap; calculating: boolean; canManageRoster: boolean; canManageCombatant: (combatant: PopulatedCombatant) => boolean; onAddPlayer: (characterId: number) => void; onRemovePlayer: (combatantId: string) => void; onCloneCreature: (combatantId: string) => void; onDeleteCreature: (combatantId: string) => void; onRestoreCombatant: (combatantId: string) => void; onMarkOut: (combatantId: string, out: Combatant['out']) => void; onUpdateInitiative: (combatantId: string, initiative: number) => void; onUpdateHp: (combatantId: string, raw: string, note: string | null) => void }) {
  const [encounterActive, setEncounterActive] = useState(false);
  const [menu, setMenu] = useState<{ id: string; type: Combatant['type']; x: number; y: number } | null>(null);
  const [hpEditor, setHpEditor] = useState<{ combatantId: string; name: string; currentHp: number; maxHp: number; rect: DOMRect } | null>(null);
  function dropOnEncounter(event: ReactDragEvent<HTMLDivElement>) {
    const payload = readCombatantDrag(event);
    setEncounterActive(false);
    if (!canManageRoster) return;
    if (payload?.source === 'bench' && payload.characterId != null) {
      event.preventDefault();
      onAddPlayer(payload.characterId);
      return;
    }
    if (payload?.source === 'out' && payload.combatantId) {
      event.preventDefault();
      onRestoreCombatant(payload.combatantId);
    }
  }
  return (
    <div className={`overflow-x-auto border bg-p1-inset transition-colors ${encounterActive ? 'border-p1-accent bg-p1-accent/[0.04]' : 'border-p1-border'}`} onDragOver={(event) => { if (canManageRoster && hasCombatantDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setEncounterActive(true); } }} onDragLeave={() => setEncounterActive(false)} onDrop={dropOnEncounter}>
      <table className='w-full min-w-[920px] table-fixed border-collapse text-sm'>
        <thead className='border-b border-p1-border bg-p1-header text-[10px] uppercase text-p1-faint'><tr><th className='w-20 px-3 py-3 text-left'>Init</th><th className='px-3 text-left'>Combatant</th><th className='w-44 px-3 text-left'>Conditions</th><th className='w-64 px-3 text-left'>Defenses</th><th className='w-32 px-3 text-left'>HP</th><th className='w-16 px-3 text-center'>Open</th></tr></thead>
        <tbody>
          {combatants.map((combatant) => {
            const detailsVisible = combatant.access?.details_revealed !== false;
            const calculable = detailsVisible && hasFullEntityDetails(combatant);
            const calculated = statuses?.[combatant._id];
            const stats = calculated ?? (!calculable ? fallbackStatus(combatant.data) : null);
            const draggable = canManageRoster;
            return (
              <tr key={combatant._id} draggable={draggable} onDragStart={(event) => { if (draggable) writeCombatantDrag(event, { source: 'encounter', combatantId: combatant._id, characterId: combatant.character }); }} onDragEnd={() => setEncounterActive(false)} onContextMenu={(event) => { if (!canManageRoster || (combatant.type !== 'CREATURE' && combatant.type !== 'CHARACTER')) return; event.preventDefault(); setMenu({ id: combatant._id, type: combatant.type, x: event.clientX, y: event.clientY }); }} className={`border-b border-p1-border last:border-0 ${draggable ? 'cursor-grab' : ''} ${combatant._id === selectedId ? 'bg-p1-accent/[0.07]' : 'hover:bg-p1-hover'}`}>
                <td className='px-3 py-3'><InitiativeCell key={`${combatant._id}:${combatant.initiative ?? ''}:${combatant.initiative_roll?.die ?? ''}`} combatant={combatant} canEdit={canManageRoster} onUpdate={(initiative) => onUpdateInitiative(combatant._id, initiative)} /></td>
                <td className='px-3 py-3'><button className='flex w-full items-center gap-3 text-left' onClick={() => openCombatant(combatant, onSelect)}>{draggable && <GripVertical size={14} className='shrink-0 text-p1-faint' />}<EntityIcon type={combatant.type} /><span className='min-w-0'><span className='block truncate font-semibold'>{combatant.data.name}</span><span className='block text-xs text-p1-faint'>Level {combatant.data.level} | {combatant.ally ? 'Ally' : 'Enemy'}</span></span></button></td>
                <td className='px-3 py-3'><CombatantConditionPills conditions={detailsVisible ? compiledConditions(combatant.data.details?.conditions ?? []) : []} onOpen={() => openCombatant(combatant, onSelect)} /></td>
                <td className='px-3 py-3 text-xs text-p1-muted'>{!detailsVisible ? <span className='text-p1-faint'>Not revealed</span> : stats ? <>{stats.ac} AC <span className='px-1 text-p1-faint'>|</span> Fort {signed(stats.fortitude)}, Ref {signed(stats.reflex)}, Will {signed(stats.will)}</> : calculating ? <span className='text-p1-faint'>Calculating...</span> : <span className='text-p1-danger-soft'>Unavailable</span>}</td>
                <td className='px-3 py-3'>
                  {!detailsVisible ? (
                    <span className='inline-flex h-9 min-w-24 items-center justify-center border border-p1-border bg-p1-raised text-p1-faint'>Hidden</span>
                  ) : (
                    <GridHpCell
                      combatant={combatant}
                      maxHp={stats?.maxHp ?? null}
                      calculating={calculating}
                      canEdit={canManageCombatant(combatant)}
                      onEdit={(rect) => {
                        const currentHp = combatant.data.hp_current ?? stats?.maxHp ?? 0;
                        const resolvedMaxHp = stats?.maxHp ?? currentHp;
                        setHpEditor({ combatantId: combatant._id, name: combatant.data.name, currentHp, maxHp: resolvedMaxHp, rect });
                      }}
                    />
                  )}
                </td>
                <td className='px-3 text-center'><button className='icon-button mx-auto' title={`Open ${combatant.data.name}`} onClick={() => openCombatant(combatant, onSelect)}><PanelRight size={16} /></button></td>
              </tr>
            );
          })}
          {combatants.length === 0 && <tr><td colSpan={6} className='p-12 text-center text-sm text-p1-faint'>No combatants in this encounter.</td></tr>}
        </tbody>
      </table>
      {menu?.type === 'CREATURE' && (
        <CombatantContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onClone={() => { setMenu(null); onCloneCreature(menu.id); }}
          onIncapacitate={() => { setMenu(null); onMarkOut(menu.id, 'incapacitated'); }}
          onMarkDead={() => { setMenu(null); onMarkOut(menu.id, 'dead'); }}
          onDelete={() => { setMenu(null); onDeleteCreature(menu.id); }}
        />
      )}
      {menu?.type === 'CHARACTER' && (
        <PlayerContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onIncapacitate={() => { setMenu(null); onMarkOut(menu.id, 'incapacitated'); }}
          onMarkDead={() => { setMenu(null); onMarkOut(menu.id, 'dead'); }}
          onRemove={() => { setMenu(null); onRemovePlayer(menu.id); }}
        />
      )}
      {hpEditor && (
        <GridHpEditPopover
          combatantName={hpEditor.name}
          currentHp={hpEditor.currentHp}
          maxHp={hpEditor.maxHp}
          anchorRect={hpEditor.rect}
          onCommit={(raw, note) => onUpdateHp(hpEditor.combatantId, raw, note)}
          onClose={() => setHpEditor(null)}
        />
      )}
    </div>
  );
}

function GridHpCell({ combatant, maxHp, calculating, canEdit, onEdit }: { combatant: PopulatedCombatant; maxHp: number | null; calculating: boolean; canEdit: boolean; onEdit: (rect: DOMRect) => void }) {
  const content = maxHp != null ? (
    <>
      {combatant.data.hp_current ?? maxHp}
      <span className='px-2 text-p1-faint'>/</span>
      {maxHp}
    </>
  ) : calculating ? (
    <span className='text-p1-faint'>...</span>
  ) : (
    <>
      {combatant.data.hp_current ?? '-'}
      <span className='px-2 text-p1-faint'>/</span>
      -
    </>
  );

  if (!canEdit) {
    return <span className='inline-flex h-9 min-w-24 items-center justify-center border border-p1-border bg-p1-raised'>{content}</span>;
  }

  return (
    <button
      type='button'
      className='inline-flex h-9 min-w-24 items-center justify-center border border-p1-border bg-p1-raised hover:border-p1-accent/40 hover:bg-p1-hover'
      onClick={(event) => onEdit(event.currentTarget.getBoundingClientRect())}
      title={`Edit ${combatant.data.name} hit points`}
    >
      {content}
    </button>
  );
}

function InitiativeCell({ combatant, canEdit, onUpdate }: { combatant: PopulatedCombatant; canEdit: boolean; onUpdate: (initiative: number) => void }) {
  const [value, setValue] = useState(combatant.initiative ?? '');
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const breakdown = combatant.initiative_roll && combatant.initiative !== undefined
    ? formatInitiativeRoll(combatant.initiative_roll, combatant.initiative)
    : undefined;
  useEffect(() => {
    setValue(combatant.initiative ?? '');
  }, [combatant.initiative, combatant.initiative_roll?.die, combatant.initiative_roll?.bonus]);

  function commit() {
    if (!canEdit) return;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed === combatant.initiative) return;
    onUpdate(parsed);
  }

  return (
    <div
      className='relative'
      onMouseEnter={(event) => {
        if (!breakdown) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setTip({ left: rect.left, top: rect.top });
      }}
      onMouseLeave={() => setTip(null)}
    >
      <input
        className='h-9 w-14 border border-p1-border bg-p1-raised px-2 text-center text-p1-text disabled:opacity-100'
        type='number'
        value={value}
        readOnly={!canEdit}
        disabled={!canEdit}
        aria-label={`${combatant.data.name} initiative`}
        title={breakdown}
        onChange={(event) => setValue(event.target.value === '' ? '' : Number(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
      {tip && breakdown && createPortal(
        <div
          role='tooltip'
          className='pointer-events-none fixed z-[200] whitespace-nowrap border border-p1-border bg-p1-surface px-2.5 py-1.5 text-[11px] text-p1-text shadow-xl'
          style={{ left: tip.left, top: tip.top - 8, transform: 'translateY(-100%)' }}
        >
          {breakdown}
        </div>,
        document.body
      )}
    </div>
  );
}

function sortRoundLogEntries(entries: InitiativeRoundLog['entries']) {
  return [...entries].sort((a, b) => {
    if (a.initiative == null && b.initiative == null) return a.name.localeCompare(b.name);
    if (a.initiative == null) return 1;
    if (b.initiative == null) return -1;
    if (a.initiative === b.initiative) return a.name.localeCompare(b.name);
    return b.initiative - a.initiative;
  });
}

function InitiativeRoundLogPanel({ log, canEdit, canClear, onClear, onUpdateNote }: { log: InitiativeRoundLog[]; canEdit?: boolean; canClear?: boolean; onClear?: () => void; onUpdateNote?: (round: InitiativeRoundLog, entry: InitiativeRoundLogEntry, note: string) => void }) {
  const [open, setOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  function handleClear() {
    if (!canClear || !onClear) return;
    if (log.length > 2) {
      setConfirmOpen(true);
      return;
    }
    onClear();
  }
  if (log.length === 0) {
    return <p className='mt-5 text-center text-xs text-p1-faint'>No rounds logged yet.</p>;
  }
  const rounds = [...log].reverse();
  return (
    <section className='mt-5 border border-p1-border bg-p1-inset'>
      <div className='flex items-center gap-2 border-b border-p1-border px-4 py-3'>
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-2 text-left hover:text-p1-text'
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <History size={15} className='text-p1-muted' />
          <span className='text-sm font-semibold'>Round log</span>
          <span className='text-xs text-p1-faint'>{log.length} round{log.length === 1 ? '' : 's'}</span>
          <ChevronDown size={14} className={`ml-auto text-p1-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {canClear && onClear && (
          <button type='button' className='toolbar-button shrink-0' title='Clear all logged rounds' onClick={handleClear}>
            <Eraser size={14} /> Clear log
          </button>
        )}
      </div>
      {confirmOpen && (
        <ConfirmDialog
          title='Clear round log'
          message={`This removes all ${log.length} logged rounds. Combatant initiative scores are not changed.`}
          confirmLabel='Clear log'
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onClear?.();
          }}
        />
      )}
      {open && rounds.map((round, index) => (
        <div key={round.id ?? `${round.round}-${index}`} className='border-b border-p1-border px-4 py-3 last:border-0'>
          <h3 className='mb-2 text-[10px] font-semibold uppercase tracking-wide text-p1-accent'>Round {round.round}</h3>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[820px] border-collapse text-xs'>
              <thead className='text-[10px] uppercase text-p1-faint'>
                <tr className='border-b border-p1-border'>
                  <th className='px-2 py-2 text-left font-semibold'>Combatant</th>
                  <th className='w-24 px-2 py-2 text-left font-semibold'>Side</th>
                  <th className='w-16 px-2 py-2 text-left font-semibold'>Init</th>
                  <th className='px-2 py-2 text-left font-semibold'>Calculation</th>
                  <th className='px-2 py-2 text-left font-semibold'>What happened</th>
                </tr>
              </thead>
              <tbody>
                {sortRoundLogEntries(round.entries).map((entry, entryIndex) => (
                  <tr key={`${round.id ?? round.round}-${entry.combatant_id ?? entry.name}-${entryIndex}`} className='border-b border-p1-border last:border-0'>
                    <td className='px-2 py-2 font-medium text-p1-text'>{entry.name}</td>
                    <td className='px-2 py-2 text-p1-muted'>{entry.ally ? 'Ally' : 'Enemy'}</td>
                    <td className='px-2 py-2 text-p1-text'>{entry.initiative ?? ''}</td>
                    <td className='px-2 py-2 text-p1-muted'>{entry.calculation}</td>
                    <td className='px-2 py-2'>
                      <RoundNoteField value={entry.note} disabled={!canEdit} onCommit={(note) => onUpdateNote?.(round, entry, note)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

function openCombatant(combatant: PopulatedCombatant, onSelect: (id: string) => void) {
  if (combatant.access?.details_revealed === false) return;
  onSelect(combatant._id);
}

const CONDITION_PILL_MAX = 2;
const CONDITION_PILL_CLASS = 'inline-flex max-w-[8.5rem] items-center truncate rounded-full border border-p1-border bg-p1-hover px-2 py-[3px] text-[10px] font-medium leading-none tracking-wide text-p1-text';

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
          className={`${CONDITION_PILL_CLASS} hover:border-p1-border hover:bg-p1-hover`}
          title={condition.source ? `${conditionLabel(condition)} from ${condition.source}` : conditionLabel(condition)}
          onClick={onOpen}
        >
          {conditionLabel(condition)}
        </button>
      ))}
      {extra.length > 0 && (
        <button
          type='button'
          className='inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-p1-border bg-p1-hover px-1.5 text-[9px] font-semibold text-p1-muted hover:border-p1-border hover:text-p1-text'
          title={extra.map(conditionLabel).join(', ')}
          onClick={onOpen}
        >
          +{extra.length}
        </button>
      )}
    </div>
  );
}

function Inspector({ combatant, width, activeTab, onTab, hasMatchingCampaignNote, status, statusLoading, canManageSpells, spellActions, onChangeConditions, onSaveGmNotes, onPersistHpCurrent, onPersistTempHp, initiativeLog, canEditRoundNotes, onUpdateRoundNote, onLogAction, onDeleteLogEntry }: {
  combatant: PopulatedCombatant | null; width: number; activeTab: DetailTab; onTab: (tab: DetailTab) => void; hasMatchingCampaignNote?: boolean; status?: Phase1CreatureStatus | null; statusLoading: boolean; canManageSpells: boolean; spellActions?: Phase1SpellActions; onChangeConditions?: (conditions: Condition[], note?: string | null) => void; onSaveGmNotes?: (text: string) => void; onPersistHpCurrent?: (raw: string, note: string | null) => void; onPersistTempHp?: (raw: string, note: string | null) => void; initiativeLog?: InitiativeRoundLog[]; canEditRoundNotes?: boolean; onUpdateRoundNote?: (round: InitiativeRoundLog, entry: InitiativeRoundLogEntry, note: string) => void; onLogAction?: (draft: ActionLogDraft) => void; onDeleteLogEntry?: (entryId: string) => void;
}) {
  return (
    <aside className='min-h-0 overflow-hidden bg-p1-inset' style={{ width }}>
      {!combatant ? (
        <div className='flex h-full flex-col items-center justify-center px-8 text-center'><PanelRight className='mb-4 text-p1-faint' size={28} /><p className='text-sm font-semibold'>Select a combatant</p><p className='mt-2 max-w-56 text-xs leading-5 text-p1-faint'>PCs, NPCs, and creatures open in this shared read-only inspector.</p></div>
      ) : (
        <div className='flex h-full min-w-0 flex-col'>
<div className='flex items-start gap-3 border-b border-p1-border px-4 py-3.5'><div className='min-w-0 flex-1'><Eyebrow>{combatant.type === 'CREATURE' ? (combatant.ally ? 'NPC / Creature' : 'Creature') : 'Player character'}</Eyebrow><h2 className='mt-1 truncate text-lg font-semibold leading-tight'>{combatant.data.name}</h2><p className='mt-1 text-xs text-p1-faint'>Level {combatant.data.level} | {canManageSpells ? 'Spell tracking' : 'Read only'}</p></div>{combatant.type === 'CHARACTER' && combatant.data.id && <a className='icon-button shrink-0' href={`/sheet/${combatant.data.id}`} target='_blank' rel='noreferrer' title='Open full character sheet'><ExternalLink size={16} /></a>}</div>
          <div className='grid grid-cols-4 border-b border-p1-border bg-p1-inset'>
            {DETAIL_TABS.map((tab) => <button key={tab} className={`border-b-2 px-2 py-2.5 text-[11px] ${activeTab === tab ? 'border-p1-accent text-p1-accent-soft' : 'border-transparent text-p1-faint hover:text-p1-text'}`} onClick={() => onTab(tab)}>{tab}</button>)}
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto p-4'><InspectorContent combatant={combatant} tab={activeTab} hasMatchingCampaignNote={hasMatchingCampaignNote} status={status} statusLoading={statusLoading} spellActions={spellActions} onChangeConditions={onChangeConditions} onSaveGmNotes={onSaveGmNotes} onPersistHpCurrent={onPersistHpCurrent} onPersistTempHp={onPersistTempHp} initiativeLog={initiativeLog} canEditRoundNotes={canEditRoundNotes} onUpdateRoundNote={onUpdateRoundNote} onLogAction={onLogAction} onDeleteLogEntry={onDeleteLogEntry} /></div>
          <CombatantChangeLogFooter entries={combatant.change_log ?? []} />
        </div>
      )}
    </aside>
  );
}

function NoteSurface({ note, isGm, encounterLink }: { note: IndexedNotePage | null; isGm: boolean; encounterLink?: { href: string; name: string } }) {
  const markdown = note ? noteContentsToMarkdown(note.page.contents) : '';
  return (
    <>
      <div className='sticky top-0 z-10 border-b border-p1-border bg-p1-surface/95 px-5 py-4 backdrop-blur'>
        <Eyebrow>{isGm ? 'Campaign notes' : 'Shared campaign notes'}</Eyebrow>
        <h2 className='mt-1 truncate text-xl font-semibold'>{note?.page.name ?? 'Note not found'}</h2>
        <p className='mt-1 truncate text-xs text-p1-faint'>{note ? (note.page.shared ? 'Shared with party' : 'Visible to the GM only') : 'This campaign note is unavailable.'}</p>
        {encounterLink && <Link to={encounterLink.href} className='mt-1 block truncate text-xs text-p1-accent hover:underline'>See encounter: {encounterLink.name}</Link>}
      </div>
      <div className='p-5'>
        {!note && <EmptyState>This campaign note could not be found, or it is not shared with you.</EmptyState>}
        {note && !markdown && <EmptyState>This note is empty.</EmptyState>}
        {note && markdown && <ProseMarkdown className='max-w-3xl'>{markdown}</ProseMarkdown>}
      </div>
    </>
  );
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
  return <button aria-label='Resize detail panel' className='cursor-col-resize bg-p1-raised hover:bg-p1-accent' onMouseDown={() => setDragging(true)} />;
}

function EntityIcon({ type }: { type: Combatant['type'] }) {
  return <span className={`grid h-9 w-9 shrink-0 place-items-center border ${type === 'CREATURE' ? 'border-p1-creature/50 text-p1-creature' : 'border-p1-pc/50 text-p1-pc'}`}>{type === 'CREATURE' ? <Swords size={16} /> : <UserRound size={16} />}</span>;
}
function Eyebrow({ children }: { children: ReactNode }) { return <div className='text-[10px] font-semibold uppercase text-p1-accent'>{children}</div>; }
function EmptyState({ children }: { children: ReactNode }) { return <div className='border border-p1-border p-8 text-center text-sm text-p1-muted'>{children}</div>; }
function ErrorState({ error }: { error: Error }) { return <div className='border border-p1-danger/40 bg-p1-danger/10 p-4 text-sm text-p1-danger-soft'>{error.message}</div>; }
function PageError({ error }: { error: Error }) { return <div className='min-h-screen bg-p1-page p-8 text-p1-text'><Link to='/phase1' className='text-sm text-p1-accent'>Back to campaigns</Link><div className='mt-6 max-w-xl'><ErrorState error={error} /></div></div>; }
function LoadingScreen({ label }: { label: string }) { return <div className='grid min-h-screen place-items-center bg-p1-page text-sm text-p1-muted'>{label}...</div>; }

function populateCombatants(combatants: Combatant[], players: Character[]): PopulatedCombatant[] {
  return combatants.map((combatant) => {
    const data = combatant.type === 'CHARACTER' ? players.find((player) => player.id === combatant.character) ?? combatant.data : combatant.creature ?? combatant.data;
    return data ? { ...combatant, data } : null;
  }).filter((combatant): combatant is PopulatedCombatant => Boolean(combatant));
}
function CampaignWorkspaceRow({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const hasKey = Boolean(campaign.join_key);

  async function revealAndCopy(event: ReactMouseEvent) {
    event.stopPropagation();
    if (!campaign.join_key) return;
    setVisible(true);
    setCopyState((await copyJoinKey(campaign.join_key)) ? 'copied' : 'failed');
  }

  return (
    <div className='group grid w-full grid-cols-[1fr_auto] items-center gap-6 px-2 py-5 hover:bg-p1-hover'>
      <button type='button' className='min-w-0 text-left' onClick={onOpen}>
        <div className='font-semibold'>{campaign.name}</div>
        <div className='mt-1 line-clamp-1 text-sm text-p1-muted'>{campaign.description || 'No campaign description'}</div>
      </button>
      <div className='flex items-center gap-2'>
        {hasKey && (
          <button type='button' className='toolbar-button' title='Reveal and copy join key' onClick={revealAndCopy}>
            {copyState === 'copied' ? <Check size={14} /> : visible ? <Copy size={14} /> : <KeyRound size={14} />}
            <span className={visible ? 'font-mono' : ''}>{visible ? campaign.join_key : 'Copy key'}</span>
          </button>
        )}
        <button type='button' className='icon-button' title={`Open ${campaign.name}`} onClick={onOpen}>
          <ChevronRight className='text-p1-faint group-hover:text-p1-accent' size={18} />
        </button>
      </div>
    </div>
  );
}

async function copyJoinKey(value: string) {
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
















