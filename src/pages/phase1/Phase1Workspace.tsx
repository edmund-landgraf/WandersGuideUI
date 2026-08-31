import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, ArrowUpDown, BookOpen, Calculator, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Crosshair, Download, Eraser, Eye, ExternalLink, Footprints, GripVertical, HeartPulse, History, KeyRound, ListChecks, LogOut, Package, PanelRight, Pencil, Plus, RotateCcw, Search, Settings, Shield, Skull, Sparkles, Swords, Trash2, Upload, UserMinus, UserRound, UsersRound, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { AmbaChallengeTable, Campaign, Character, Combatant, Condition, Creature, DiceCheckResult, DiceRollLog, DiceRollLogEntry, DiceRollSide, DiceRollState, Encounter, InitiativeRoundLog, InitiativeRoundLogEntry, LivingEntity } from '@schemas/content';
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
import { Phase1CssThemeToggle } from './Phase1CssThemeToggle';
import { Phase1ThemeToggle } from './Phase1ThemeToggle';
import { rollDie } from '@utils/random';
import { buildInitiativeRoundLog, formatInitiativeRoll, InitiativeRollModal, isCombatantOut, nextInitiativeRoundNumber, overlayInitiativeLogs, setRoundLogEntryNote, sortCombatantsByInitiative, type InitiativeRollChoice } from './phase1-initiative';
import { toLabel } from '@utils/strings';
import { sign } from '@utils/numbers';
import { DiceCheckResultToast, DiceCheckRollModal, DiceRollColorKey, DiceRollLogPanel } from './phase1-dice-rolls';
import { buildDiceRollLog, checkStatLabel, DICE_CHECK_OPTIONS, DICE_CHECK_VALUES, defaultStatForCombatant, degreeOfSuccess, filterCombatantsBySide, formatCheckRoll, loadAllCheckOptions, loadCheckOptions, outcomeLabel, outcomeRowClass, overlayDiceRollMeta, setDiceRollLogEntryNote } from './phase1-dice-check';
import { findAmbaChallenge, challengeCheckEntries, mapAmbaChallengeStat, mergeEncounterMeta, readAmbaChallenges } from './phase1-amba-challenges';
import { encounterDisplayName, encounterNamesMatch } from './phase1-encounter-title';
import { appendChangeLog, characterCombatFieldsFromEntity, createChangeLogEntry, parseTempHpInput } from './phase1-change-log';
import { appendActionLog, createActionLogEntry, currentActionRound, removeActionLogEntry, type ActionLogDraft } from './phase1-action-log';
import { maxCombatantStats, maxEntityStats, resetCombatant, resetEntityCombatState, resolveResetMaxHp } from './phase1-encounter-reset';
import { CombatantChangeLogFooter, EditableValueWithNote, GridHpEditPopover, RoundNoteField } from './phase1-change-log-ui';
import { PhaseViewSwitch } from '../phase-switch/PhaseViewSwitch';
import { ConfirmDialog, SettingsSurface } from './phase1-campaign-settings';
import { Phase1DiceButton, Phase1DiceModal } from './phase1-dice';
import { CAMPAIGN_SLOT_CAP, CHARACTER_SLOT_CAP, GUIDE_BLUE } from '@constants/data';
import { PATREON_URL } from '@constants/urls';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import { hasPatreonAccess } from '@utils/patreon';
import { getAllBackgroundImages } from '@utils/background-images';
import { getFileContents } from '@import/json/import-from-json';
import exportToJSON, { downloadObjectAsJson } from '@export/export-to-json';
import exportToPDF from '@export/export-to-pdf';
import importFromGUIDECHAR from '@import/guidechar/import-from-guidechar';
import { importFromFTC } from '@import/ftc/import-from-ftc';
import { importFromPathbuilder } from '@import/pathbuilder/import-from-pathbuilder';
import { Phase1RandomCharacterModal } from './phase1-random-character-modal';
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
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
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

  const ownedCampaigns = (campaigns.data ?? []).filter((campaign) => campaign.user_id === session?.user.id);

  async function createCampaign() {
    return phase1Request<Campaign>('create-campaign', {
      name: 'My Campaign',
      description: 'A new adventure begins...',
      meta_data: {
        settings: {
          show_party_member_status: 'STATUS',
        },
      },
    });
  }

  async function handleCreateCampaign() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const campaign = await createCampaign();
      await queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] });
      navigate(`/phase1/campaign/${campaign.id}`);
    } catch (error) {
      const atFreeCap = ownedCampaigns.length >= CAMPAIGN_SLOT_CAP && !hasPatreonAccess(getCachedPublicUser(), 2);
      if (isCampaignLimitError(error) || atFreeCap) {
        setLimitModalOpen(true);
      } else {
        setCreateError(error instanceof Error ? error.message : 'Could not create campaign.');
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteExistingAndCreateNew() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      for (const campaign of ownedCampaigns) {
        await phase1Request('delete-content', { id: campaign.id, type: 'campaign' });
      }
      await createCampaign();
      setLimitModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] });
      navigate('/phase1');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not replace campaign.');
    } finally {
      setCreating(false);
    }
  }

  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <CampaignSignIn variant='phase1' />;
  return (
    <div className='min-h-screen bg-p1-page text-p1-text'>
      <WorkspaceHeader section='campaigns' />
      <main className='mx-auto max-w-5xl px-6 py-10'>
        <div className='mb-8 flex items-end justify-between gap-6 border-b border-p1-border pb-6'>
          <div>
            <Eyebrow>Phase 1</Eyebrow>
            <h1 className='mt-2 text-3xl font-semibold'>Campaign workspace</h1>
            <p className='mt-2 text-sm text-p1-muted'>Choose an owned or joined campaign, or open Characters from the header.</p>
            {createError && <p className='mt-2 text-xs text-p1-danger-soft'>{createError}</p>}
          </div>
          <div className='flex items-center gap-2'>
            <button type='button' className='toolbar-button' disabled={creating} title='Create campaign' onClick={() => void handleCreateCampaign()}>
              <Plus size={15} />
              {creating ? 'Creating…' : 'Create campaign'}
            </button>
            <button className='icon-button' title='Sign out' onClick={() => supabase.auth.signOut()}><LogOut size={17} /></button>
          </div>
        </div>
        {campaigns.isLoading && <EmptyState>Loading campaigns...</EmptyState>}
        {campaigns.error && <ErrorState error={campaigns.error} />}
        {campaigns.data?.length === 0 && (
          <EmptyState>
            <div>No campaigns are available.</div>
            <button type='button' className='toolbar-button mt-4 inline-flex' disabled={creating} onClick={() => void handleCreateCampaign()}>
              <Plus size={15} />
              {creating ? 'Creating…' : 'Create campaign'}
            </button>
          </EmptyState>
        )}
        <div className='divide-y divide-p1-border border-y border-p1-border'>
          {campaigns.data?.map((campaign) => (
            <CampaignWorkspaceRow
              key={campaign.id}
              campaign={campaign}
              canDelete={campaign.user_id === session.user.id}
              onOpen={() => navigate(`/phase1/campaign/${campaign.id}`)}
              onDeleted={() => queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] })}
            />
          ))}
        </div>
      </main>
      {limitModalOpen && (
        <CampaignLimitModal
          busy={creating}
          slotCap={CAMPAIGN_SLOT_CAP}
          onClose={() => !creating && setLimitModalOpen(false)}
          onDeleteAndCreate={() => void deleteExistingAndCreateNew()}
        />
      )}
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
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [pathbuilderOpen, setPathbuilderOpen] = useState(false);
  const [pathbuilderId, setPathbuilderId] = useState('');
  const [characterMenu, setCharacterMenu] = useState<{ character: Character; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const guidecharInputRef = useRef<HTMLInputElement>(null);
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

  const deleteCharacter = useMutation({
    mutationFn: (id: number) => phase1Request('delete-content', { id, type: 'character' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      void queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] });
    },
    onError: (error) => {
      setJoinStatus(error instanceof Error ? error.message : 'Could not delete character.');
    },
  });

  async function loadCharacterForExport(id: number): Promise<Character> {
    const result = await phase1Request<Character | Character[]>('find-character', { id });
    const character = Array.isArray(result) ? result[0] : result;
    if (!character) throw new Error('Could not load character for export.');
    return character;
  }

  async function exportCharacter(kind: 'json' | 'pdf', source: Character) {
    if (exporting) return;
    setExporting(true);
    setJoinStatus(kind === 'json' ? `Exporting “${source.name}” to JSON…` : `Exporting “${source.name}” to PDF…`);
    try {
      const character = await loadCharacterForExport(source.id);
      if (kind === 'json') {
        try {
          await exportToJSON(character);
        } catch (error) {
          console.error(error);
          const fileName = character.name.trim().toLowerCase().replace(/([^a-z0-9]+)/gi, '-') || 'character';
          downloadObjectAsJson({ version: 4, character }, fileName);
          setJoinStatus(`Exported “${character.name}” as JSON (stats snapshot unavailable).`);
          return;
        }
        setJoinStatus(`Exported “${character.name}” as JSON.`);
        return;
      }
      await exportToPDF(character);
      setJoinStatus(`Exported “${character.name}” as PDF.`);
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : kind === 'json' ? 'JSON export failed.' : 'PDF export failed.');
    } finally {
      setExporting(false);
    }
  }

  const canAddAll = Boolean(joinKey.trim()) && Boolean(characters.data?.length) && !addAllToJoinKey.isPending;
  const reachedCharacterLimit =
    (characters.data?.length ?? 0) >= CHARACTER_SLOT_CAP && !hasPatreonAccess(getCachedPublicUser(), 2);
  const createDisabled = reachedCharacterLimit || creating || importing;

  async function createCharacter() {
    if (createDisabled) return;
    setCreating(true);
    setJoinStatus(null);
    try {
      const images = getAllBackgroundImages();
      const randomImageUrl = images[Math.floor(Math.random() * images.length)]?.url;
      const character = await phase1Request<Character>('create-character', {
        meta_data: { reset_hp: true },
        details: { background_image_url: randomImageUrl },
      });
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      navigate(`/builder/${character.id}`);
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Could not create character.');
    } finally {
      setCreating(false);
    }
  }

  async function createRandomCharacter(picks: { class?: string; ancestry?: string; level: number }) {
    if (createDisabled) return;
    setCreating(true);
    setJoinStatus('Creating random character. This may take a minute…');
    try {
      const character = await importFromFTC({
        version: '1.0',
        data: {
          name: 'RANDOM',
          class: picks.class ?? 'RANDOM',
          background: 'RANDOM',
          ancestry: picks.ancestry ?? 'RANDOM',
          level: picks.level,
          content_sources: 'ALL',
          selections: 'RANDOM',
          items: [],
          spells: [],
          conditions: [],
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      setRandomOpen(false);
      if (character) navigate(`/builder/${character.id}`);
      else setJoinStatus('Random character creation failed.');
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Could not create random character.');
    } finally {
      setCreating(false);
    }
  }

  function CreateMenu({ className }: { className?: string }) {
    return (
      <div className={`relative ${className ?? ''}`}>
        <button
          type='button'
          className='toolbar-button'
          disabled={createDisabled}
          title={reachedCharacterLimit ? 'Character slot limit reached' : 'Create character'}
          onClick={() => {
            setUploadOpen(false);
            setCreateOpen((open) => !open);
          }}
        >
          <Plus size={15} />
          {creating ? 'Creating…' : 'Create'}
          <ChevronDown size={14} />
        </button>
        {createOpen && (
          <div className='absolute left-0 z-20 mt-1 min-w-[14rem] border border-p1-border bg-p1-surface py-1'>
            <button
              type='button'
              className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
              onClick={() => {
                setCreateOpen(false);
                void createCharacter();
              }}
            >
              Normal create
            </button>
            <button
              type='button'
              className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
              onClick={() => {
                setCreateOpen(false);
                setRandomOpen(true);
              }}
            >
              Random create
            </button>
          </div>
        )}
      </div>
    );
  }

  async function importJsonFile(file: File | null) {
    if (!file) return;
    setImporting(true);
    setJoinStatus(null);
    try {
      const obj = JSON.parse(await getFileContents(file));
      if (obj.version !== 4 || !obj.character) throw new Error('Invalid JSON file');
      const { id: _id, ...character } = obj.character as Character & { id?: number };
      const created = await phase1Request<Character>('create-character', character);
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      setJoinStatus(`Imported “${created.name}”.`);
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'JSON import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function importGuidecharFile(file: File | null) {
    if (!file) return;
    setImporting(true);
    setJoinStatus(null);
    try {
      const character = await importFromGUIDECHAR(file);
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      setJoinStatus(character ? `Imported “${character.name}”.` : 'GUIDECHAR import failed.');
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'GUIDECHAR import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function importPathbuilder(id: number) {
    setPathbuilderOpen(false);
    setImporting(true);
    setJoinStatus(null);
    try {
      const character = await importFromPathbuilder(id);
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      setJoinStatus(character ? `Imported “${character.name}”.` : 'Pathbuilder import failed.');
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Pathbuilder import failed.');
    } finally {
      setImporting(false);
    }
  }

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
            {reachedCharacterLimit && <p className='mt-2 text-xs text-p1-muted'>{characters.data?.length}/{CHARACTER_SLOT_CAP} character slots used.</p>}
          </div>
          <div className='flex min-w-0 flex-col items-stretch gap-2 sm:items-end'>
            <div className='flex flex-wrap items-center gap-2'>
              <CreateMenu />
              <div className='relative'>
                <button type='button' className='toolbar-button' disabled={createDisabled} title={reachedCharacterLimit ? 'Character slot limit reached' : 'Upload character'} onClick={() => { setCreateOpen(false); setUploadOpen((open) => !open); }}>
                  <Upload size={15} />
                  {importing ? 'Uploading…' : 'Upload'}
                </button>
                {uploadOpen && (
                  <div className='absolute right-0 z-20 mt-1 min-w-[14rem] border border-p1-border bg-p1-surface py-1'>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => { setUploadOpen(false); jsonInputRef.current?.click(); }}>Import from JSON</button>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => { setUploadOpen(false); setPathbuilderOpen(true); }}>Import from Pathbuilder</button>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => { setUploadOpen(false); guidecharInputRef.current?.click(); }}>Import from GUIDECHAR</button>
                  </div>
                )}
              </div>
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
        {characters.data?.length === 0 && (
          <EmptyState>
            <div>No characters are available.</div>
            <CreateMenu className='mt-4 inline-flex' />
          </EmptyState>
        )}
        <div className='divide-y divide-p1-border border-y border-p1-border'>
          {characters.data?.map((character) => {
            const identity = [character.details?.ancestry?.name, character.details?.class?.name].filter(Boolean).join(' · ');
            return (
              <button
                key={character.id}
                className='group grid w-full grid-cols-[1fr_auto] items-center gap-6 px-2 py-5 text-left hover:bg-p1-hover'
                onClick={() => navigate(`/sheet/${character.id}`)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCharacterMenu({ character, x: event.clientX, y: event.clientY });
                }}
              >
                <div>
                  <div className='font-semibold'>{character.name}</div>
                  <div className='mt-1 line-clamp-1 text-sm text-p1-muted'>Level {character.level}{identity ? ` · ${identity}` : ''}</div>
                </div>
                <ChevronRight className='text-p1-faint group-hover:text-p1-accent' size={18} />
              </button>
            );
          })}
        </div>
        {characterMenu && (
          <CharacterGridContextMenu
            x={characterMenu.x}
            y={characterMenu.y}
            onClose={() => setCharacterMenu(null)}
            onExportJson={() => {
              const target = characterMenu.character;
              setCharacterMenu(null);
              void exportCharacter('json', target);
            }}
            onExportPdf={() => {
              const target = characterMenu.character;
              setCharacterMenu(null);
              void exportCharacter('pdf', target);
            }}
            onDelete={() => {
              setPendingDelete({ id: characterMenu.character.id, name: characterMenu.character.name });
              setCharacterMenu(null);
            }}
          />
        )}
        {pendingDelete && (
          <ConfirmDialog
            title='Delete character'
            message={`Are you sure you want to delete "${pendingDelete.name}"? They'll be gone for a very, very long time.`}
            confirmLabel={deleteCharacter.isPending ? 'Deleting…' : 'Delete'}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              const id = pendingDelete.id;
              setPendingDelete(null);
              deleteCharacter.mutate(id);
            }}
          />
        )}
        <input ref={jsonInputRef} type='file' accept='application/json,.json' className='hidden' onChange={(event) => { void importJsonFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
        <input ref={guidecharInputRef} type='file' accept='.guidechar' className='hidden' onChange={(event) => { void importGuidecharFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
      </main>
      {randomOpen && (
        <Phase1RandomCharacterModal
          generating={creating}
          onClose={() => {
            if (!creating) setRandomOpen(false);
          }}
          onConfirm={(picks) => void createRandomCharacter(picks)}
        />
      )}
      {pathbuilderOpen && (
        <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget) setPathbuilderOpen(false); }}>
          <section className='w-full max-w-md border border-p1-border bg-p1-surface p-5'>
            <h2 className='text-lg font-semibold'>Import from Pathbuilder 2e</h2>
            <p className='mt-2 text-sm text-p1-muted'>Enter the Pathbuilder JSON ID. Some selections may be missing after import.</p>
            <input
              className='settings-input mt-4 h-9 w-full'
              type='number'
              min={1}
              placeholder='123456'
              value={pathbuilderId}
              onChange={(event) => setPathbuilderId(event.target.value)}
            />
            <div className='mt-4 flex justify-end gap-2'>
              <button type='button' className='toolbar-button' onClick={() => setPathbuilderOpen(false)}>Cancel</button>
              <button
                type='button'
                className='toolbar-button'
                disabled={!Number.parseInt(pathbuilderId, 10)}
                style={{ background: 'var(--p1-accent)', color: 'var(--p1-accent-ink)', borderColor: 'var(--p1-accent)' }}
                onClick={() => void importPathbuilder(Number.parseInt(pathbuilderId, 10))}
              >
                Import
              </button>
            </div>
          </section>
        </div>
      )}
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
  const diceLogsRef = useRef(new Map<number, DiceRollLog[]>());
  const diceStatesRef = useRef(new Map<number, DiceRollState | undefined>());
  const campaignKey = ['phase1-campaign', campaignId, session?.user.id] as const;
  const encountersKey = ['phase1-encounters', campaignId, session?.user.id] as const;
  const playersKey = ['phase1-players', campaignId, session?.user.id] as const;
  const campaign = useQuery({ queryKey: campaignKey, enabled, queryFn: async () => (await phase1Request<Campaign[]>('find-campaign', { id: campaignId }))[0] ?? null });
  const players = useQuery({ queryKey: playersKey, enabled, queryFn: () => phase1Request<Character[]>('find-character', { campaign_id: campaignId }) });
  const encounters = useQuery({
    queryKey: encountersKey,
    enabled,
    queryFn: async () => overlayDiceRollMeta(
      overlayInitiativeLogs(await phase1Request<Encounter[]>('find-encounter', { campaign_id: campaignId }), initiativeLogsRef.current),
      diceLogsRef.current,
      diceStatesRef.current,
    ),
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
      if (encounter.meta_data.dice_roll_log !== undefined) {
        diceLogsRef.current.set(encounter.id, encounter.meta_data.dice_roll_log);
      }
      if ('dice_roll_state' in encounter.meta_data) {
        diceStatesRef.current.set(encounter.id, encounter.meta_data.dice_roll_state);
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
  const createEncounter = useMutation({
    mutationFn: (name: string) =>
      phase1Request<Encounter>('create-encounter', {
        id: -1,
        created_at: '',
        user_id: '',
        name,
        icon: 'combat',
        color: GUIDE_BLUE,
        campaign_id: campaignId,
        combatants: { list: [] },
        meta_data: { description: '' },
      }),
    onSuccess: (encounter) => {
      queryClient.invalidateQueries({ queryKey: encountersKey });
      if (encounter?.id != null && encounter.id !== -1) {
        navigate(`/phase1/campaign/${campaignId}/encounters/${encounter.id}`);
      }
    },
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
  function handleCreateNote(name: string) {
    const pages = [
      ...(campaignData.notes?.pages ?? []),
      { name: encounterDisplayName(name), icon: 'notebook', color: GUIDE_BLUE, contents: null, shared: false },
    ];
    updateCampaign.mutate({ ...campaignData, notes: { ...campaignData.notes, pages } });
    navigate(`/phase1/campaign/${campaignId}/notes/${pages.length - 1}`);
  }
  function handleCreateEncounter(name: string) {
    createEncounter.mutate(encounterDisplayName(name));
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
      onCreateNote={handleCreateNote}
      onCreateEncounter={handleCreateEncounter}
      rosterSaving={updateEncounter.isPending}
      campaignSaving={updateCampaign.isPending}
      rosterError={updateEncounter.error ?? updateCharacter.error ?? deleteEncounter.error ?? deleteNote.error}
      campaignError={updateCampaign.error ?? resetJoinKey.error ?? kickPlayer.error ?? deleteCampaign.error}
    />
  );
}


function EncounterWorkspace({ campaign, encounters, players, selectedEncounter, notePages, selectedNote, viewingNotes, viewingSettings, isGm, sessionUserId, onUpdateEncounter, onUpdateCharacter, onUpdateCampaign, onResetJoinKey, onKickPlayer, onDeleteCampaign, onDeleteNote, onDeleteEncounter, onCreateNote, onCreateEncounter, rosterSaving, campaignSaving, rosterError, campaignError }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; selectedEncounter: Encounter | null; notePages: IndexedNotePage[]; selectedNote: IndexedNotePage | null; viewingNotes: boolean; viewingSettings: boolean; isGm: boolean; sessionUserId: string; onUpdateEncounter: (encounter: Encounter) => void; onUpdateCharacter: (id: number, fields: { spells?: Character['spells']; details?: Character['details']; inventory?: Character['inventory']; hp_current?: number; hp_temp?: number; stamina_current?: number; resolve_current?: number }) => void; onUpdateCampaign: (campaign: Campaign) => void; onResetJoinKey: () => Promise<unknown>; onKickPlayer: (characterId: number) => Promise<unknown>; onDeleteCampaign: () => Promise<unknown>; onDeleteNote: (index: number) => void; onDeleteEncounter: (id: number) => void; onCreateNote: (name: string) => void; onCreateEncounter: (name: string) => void; rosterSaving: boolean; campaignSaving: boolean; rosterError: Error | null; campaignError: Error | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailWidth, setDetailWidth] = useState(readDetailWidth);
  const [activeTab, setActiveTab] = useState<DetailTab>('Health');
  const [initiativeOpen, setInitiativeOpen] = useState(false);
  const [initiativeRollNonce, setInitiativeRollNonce] = useState(0);
  const [creaturePickerOpen, setCreaturePickerOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const [encounterTab, setEncounterTab] = useState<'combat' | 'dice'>('combat');
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkToast, setCheckToast] = useState<{ log: DiceRollLog; x: number; y: number } | null>(null);
  const [titleDraft, setTitleDraft] = useState(selectedEncounter?.meta_data.dice_roll_state?.title ?? '');
  const [dcDraft, setDcDraft] = useState(selectedEncounter?.meta_data.dice_roll_state?.dc != null ? String(selectedEncounter.meta_data.dice_roll_state.dc) : '');
  const combatants = useMemo(() => populateCombatants(selectedEncounter?.combatants.list ?? [], players), [selectedEncounter, players]);
  const activeCombatants = useMemo(() => combatants.filter((combatant) => !isCombatantOut(combatant)), [combatants]);
  const outCombatants = useMemo(() => combatants.filter((combatant) => isCombatantOut(combatant)), [combatants]);
  const orderedCombatants = useMemo(() => sortCombatantsByInitiative(activeCombatants), [activeCombatants]);
  const selectedEncounterRef = useRef(selectedEncounter);
  const initiativeLogRef = useRef<InitiativeRoundLog[]>(selectedEncounter?.meta_data.initiative_log ?? []);
  const initiativeLogEncounterIdRef = useRef(selectedEncounter?.id ?? null);
  const diceLogRef = useRef<DiceRollLog[]>(selectedEncounter?.meta_data.dice_roll_log ?? []);
  const diceStateRef = useRef<DiceRollState | undefined>(selectedEncounter?.meta_data.dice_roll_state);
  selectedEncounterRef.current = selectedEncounter;
  if (selectedEncounter && selectedEncounter.id !== initiativeLogEncounterIdRef.current) {
    initiativeLogEncounterIdRef.current = selectedEncounter.id;
    initiativeLogRef.current = selectedEncounter.meta_data.initiative_log ?? [];
    diceLogRef.current = selectedEncounter.meta_data.dice_roll_log ?? [];
    diceStateRef.current = selectedEncounter.meta_data.dice_roll_state;
  } else if (selectedEncounter?.meta_data.initiative_log && selectedEncounter.meta_data.initiative_log.length >= initiativeLogRef.current.length) {
    initiativeLogRef.current = selectedEncounter.meta_data.initiative_log;
  }
  if (selectedEncounter?.meta_data.dice_roll_log && selectedEncounter.meta_data.dice_roll_log.length >= diceLogRef.current.length) {
    diceLogRef.current = selectedEncounter.meta_data.dice_roll_log;
  }
  if (selectedEncounter?.meta_data.dice_roll_state) {
    diceStateRef.current = selectedEncounter.meta_data.dice_roll_state;
  }
  const selected = combatants.find((item) => item._id === selectedId) ?? null;
  const statuses = useCombatantStatuses(selectedEncounter?.id ?? null, combatants);
  const encounterNote = notePages.find((item) => encounterNamesMatch(item.page.name, selectedEncounter?.name));
  const noteEncounter = encounters.find((item) => encounterNamesMatch(item.name, selectedNote?.page.name));
  const activeCharacterIds = new Set((selectedEncounter?.combatants.list ?? []).filter((combatant) => combatant.type === 'CHARACTER').map((combatant) => combatant.character));
  const benchPlayers = players.filter((player) => !activeCharacterIds.has(player.id));
  const diceState = selectedEncounter?.meta_data.dice_roll_state;
  const ambaChallenges = useMemo(() => readAmbaChallenges(selectedEncounter?.meta_data), [selectedEncounter?.meta_data]);
  const diceSide = diceState?.side;
  const diceStat = diceState?.stat;
  const diceDc = diceState?.dc ?? null;
  const diceRows = !diceSide || !diceStat ? [] : filterCombatantsBySide(activeCombatants, diceSide);
  const diceGridRows = diceSide ? filterCombatantsBySide(activeCombatants, diceSide) : activeCombatants;
  const canRollCheck = Boolean(isGm && !rosterSaving && diceSide && diceStat && diceDc != null && Number.isFinite(diceDc) && diceRows.length > 0);
  const canSingleCheck = Boolean(isGm && !rosterSaving && diceDc != null && Number.isFinite(diceDc));

  function persistRoster(list: Combatant[], metaPatch?: Partial<Encounter['meta_data']>) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm) return;
    const allies = populateCombatants(list, players).filter((combatant) => combatant.ally);
    const levels = allies.map((combatant) => combatant.data.level).filter(Number.isFinite);
    const initiative_log = metaPatch && 'initiative_log' in metaPatch
      ? metaPatch.initiative_log ?? []
      : encounter.meta_data.initiative_log ?? initiativeLogRef.current;
    initiativeLogRef.current = initiative_log;
    const dice_roll_log = metaPatch && 'dice_roll_log' in metaPatch
      ? metaPatch.dice_roll_log ?? []
      : encounter.meta_data.dice_roll_log ?? diceLogRef.current;
    diceLogRef.current = dice_roll_log;
    const dice_roll_state = metaPatch && 'dice_roll_state' in metaPatch
      ? metaPatch.dice_roll_state
      : encounter.meta_data.dice_roll_state ?? diceStateRef.current;
    diceStateRef.current = dice_roll_state;
    onUpdateEncounter({
      ...encounter,
      combatants: { list },
      meta_data: mergeEncounterMeta(
        encounter.meta_data,
        { ...metaPatch, initiative_log, dice_roll_log, dice_roll_state },
        {
          party_size: allies.length,
          party_level: levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0,
        },
      ),
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
    const sourceName = creatureCombatantName(source) ?? 'Creature';
    const { base, number: sourceNumber } = creatureNameParts(sourceName);
    const sameType = list.filter((item) => {
      const name = creatureCombatantName(item);
      return Boolean(name && creatureNameParts(name).base === base);
    });
    const firstOfType = sameType.length === 1 && sourceNumber === null;
    const copyName = firstOfType ? `${base} (2)` : nextCreatureCloneName(source, list);
    const namedCopy = withCreatureName(copy, copyName);
    const namedSource = firstOfType ? withCreatureName(source, `${base} (1)`) : source;
    updateRoster([...list.slice(0, index), namedSource, namedCopy, ...list.slice(index + 1)]);
    setSelectedId(namedCopy._id);
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
    setInitiativeRollNonce((value) => value + 1);
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

  function persistDiceState(patch: Partial<DiceRollState>) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm) return;
    const current = encounter.meta_data.dice_roll_state ?? diceStateRef.current ?? {};
    persistRoster(encounter.combatants.list, { dice_roll_state: { ...current, ...patch } });
  }

  function clearDiceRollLog() {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm || rosterSaving) return;
    persistRoster(encounter.combatants.list, { dice_roll_log: [] });
  }

  function removeDiceRollLog(entry: DiceRollLog) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm || rosterSaving) return;
    const existing = diceLogRef.current.length ? diceLogRef.current : encounter.meta_data.dice_roll_log ?? [];
    persistRoster(encounter.combatants.list, {
      dice_roll_log: existing.filter((item) => (entry.id && item.id ? item.id !== entry.id : item !== entry)),
    });
  }

  function rollGroupCheck(rollBonuses: Map<string, InitiativeRollChoice>) {
    const encounter = selectedEncounterRef.current;
    if (!encounter) return;
    const state = encounter.meta_data.dice_roll_state ?? diceStateRef.current;
    const dc = state?.dc;
    const stat = state?.stat;
    if (dc == null || !Number.isFinite(dc) || !stat) {
      setCheckOpen(false);
      return;
    }
    const results: Record<string, DiceCheckResult> = {};
    for (const [id, choice] of rollBonuses) {
      if (!choice) continue;
      const die = rollDie('D20');
      const total = die + choice.bonus;
      results[id] = {
        die,
        bonus: choice.bonus,
        source: choice.source,
        total,
        outcome: degreeOfSuccess(die, total, dc),
      };
    }
    if (Object.keys(results).length === 0) {
      setCheckOpen(false);
      return;
    }
    const rows = filterCombatantsBySide(activeCombatants, state.side);
    const existingLog = diceLogRef.current.length ? diceLogRef.current : encounter.meta_data.dice_roll_log ?? [];
    const challenge = findAmbaChallenge(readAmbaChallenges(encounter.meta_data), state.challenge_id);
    persistRoster(encounter.combatants.list, {
      dice_roll_state: { ...state, results },
      dice_roll_log: [...existingLog, buildDiceRollLog(titleDraft || state.title || '', dc, stat, rows, results, challenge)],
    });
    setCheckOpen(false);
  }

  async function rollSingleAgainst(combatantId: string, preferredStat: string, dc: number, title: string, challenge: AmbaChallengeTable | undefined, x: number, y: number) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm || rosterSaving) return;
    if (!Number.isFinite(dc)) return;
    const combatant = activeCombatants.find((item) => item._id === combatantId);
    if (!combatant) return;
    const options = await loadCheckOptions(combatant);
    const resolvedStat = defaultStatForCombatant(options, preferredStat);
    if (!resolvedStat) return;
    const option = options.find((item) => item.value === resolvedStat);
    const bonus = option?.num ?? 0;
    const source = option ? toLabel(option.value) : checkStatLabel(resolvedStat);
    const die = rollDie('D20');
    const total = die + bonus;
    const result: DiceCheckResult = {
      die,
      bonus,
      source,
      total,
      outcome: degreeOfSuccess(die, total, dc),
    };
    const log = buildDiceRollLog(title, dc, resolvedStat, [combatant], { [combatant._id]: result }, challenge);
    const existingLog = diceLogRef.current.length ? diceLogRef.current : encounter.meta_data.dice_roll_log ?? [];
    persistRoster(encounter.combatants.list, { dice_roll_log: [...existingLog, log] });
    setCheckToast({ log, x, y });
  }

  async function rollSingleCheck(combatantId: string, preferredStat: string, x: number, y: number) {
    const encounter = selectedEncounterRef.current;
    if (!encounter) return;
    const state = encounter.meta_data.dice_roll_state ?? diceStateRef.current;
    const dc = state?.dc;
    if (dc == null || !Number.isFinite(dc)) return;
    const challenge = findAmbaChallenge(readAmbaChallenges(encounter.meta_data), state?.challenge_id);
    await rollSingleAgainst(combatantId, preferredStat, dc, titleDraft || state?.title || '', challenge, x, y);
  }

  async function rollSingleChallenge(combatantId: string, challengeId: string, x: number, y: number, preferredStat?: string) {
    const challenge = findAmbaChallenge(ambaChallenges, challengeId);
    if (!challenge) return;
    const mapped = preferredStat || mapAmbaChallengeStat(challenge, DICE_CHECK_VALUES) || '';
    await rollSingleAgainst(combatantId, mapped, challenge.check.dc, challenge.title, challenge, x, y);
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
      { initiative_log: [], dice_roll_log: [], dice_roll_state: undefined },
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

  function updateDiceRollNote(round: DiceRollLog, entry: DiceRollLogEntry, note: string) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm || rosterSaving) return;
    const existing = diceLogRef.current.length ? diceLogRef.current : encounter.meta_data.dice_roll_log ?? [];
    persistRoster(encounter.combatants.list, {
      dice_roll_log: setDiceRollLogEntryNote(existing, round, entry, note),
    });
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

  function renameNote(index: number, name: string) {
    const trimmed = name.trim();
    const pages = [...(campaign.notes?.pages ?? [])];
    const page = pages[index];
    const nextName = encounterDisplayName(trimmed);
    if (!page || !nextName || page.name === nextName) return;
    pages[index] = { ...page, name: nextName };
    onUpdateCampaign({ ...campaign, notes: { ...campaign.notes, pages } });
  }

  function renameEncounter(id: number, name: string) {
    const trimmed = name.trim();
    const encounter = encounters.find((item) => item.id === id);
    const nextName = encounterDisplayName(trimmed);
    if (!encounter || !nextName || encounter.name === nextName) return;
    onUpdateEncounter({ ...encounter, name: nextName });
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
    setCheckOpen(false);
    setEncounterTab('combat');
    setTitleDraft(selectedEncounter?.meta_data.dice_roll_state?.title ?? '');
    setDcDraft(selectedEncounter?.meta_data.dice_roll_state?.dc != null ? String(selectedEncounter.meta_data.dice_roll_state.dc) : '');
  }, [selectedEncounter?.id]);
  useEffect(() => window.localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth)), [detailWidth]);

  return (
    <div className='flex h-screen min-h-[680px] flex-col overflow-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader label={campaign.name} campaignId={campaign.id} encounterId={selectedEncounter?.id ?? null} noteIndex={selectedNote?.index ?? null} viewingSettings={viewingSettings} />
      <div className={`grid min-h-0 flex-1 ${viewingNotes || viewingSettings ? 'grid-cols-[248px_minmax(280px,1fr)]' : 'grid-cols-[248px_minmax(280px,1fr)_6px_auto]'}`}>
        <CampaignRail campaign={campaign} encounters={encounters} players={benchPlayers} outCombatants={outCombatants} selectedEncounter={selectedEncounter} selectedId={selectedId} notePages={notePages} selectedNoteIndex={selectedNote?.index ?? null} viewingSettings={viewingSettings} isGm={isGm} rosterSaving={rosterSaving} onRemovePlayer={removePlayer} onAddAllPlayers={addAllPlayers} onSelectCombatant={setSelectedId} onMarkOut={setCombatantOut} onDeleteNote={onDeleteNote} onDeleteEncounter={onDeleteEncounter} onCreateNote={onCreateNote} onCreateEncounter={onCreateEncounter} onRenameNote={renameNote} onRenameEncounter={renameEncounter} />
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
              <EncounterHeader encounter={selectedEncounter} combatants={activeCombatants} count={activeCombatants.length} isGm={isGm} noteLink={encounterNote ? { href: `/phase1/campaign/${campaign.id}/notes/${encounterNote.index}`, name: encounterNote.page.name } : undefined} tab={encounterTab} onTab={setEncounterTab} canAddCreature={isGm && !rosterSaving} onAddCreature={() => setCreaturePickerOpen(true)} canRollInitiative={isGm && activeCombatants.length > 0} onRollInitiative={() => setInitiativeOpen(true)} canClearInitiative={isGm && activeCombatants.some((combatant) => combatant.initiative != null)} onClearInitiative={clearInitiative} canMaxStats={isGm && combatants.length > 0 && !rosterSaving} onMaxStats={maxEncounterStats} canReset={isGm && Boolean(selectedEncounter) && !rosterSaving} onReset={() => setResetOpen(true)} onOpenDice={() => setDiceOpen(true)} />
              {rosterError && <div className='border-b border-p1-danger/40 bg-p1-danger/10 px-5 py-2 text-xs text-p1-danger-soft'>Roster update failed: {rosterError.message}</div>}
              {encounterTab === 'dice' && (
                <DiceRollToolbar
                  isGm={isGm}
                  side={diceSide}
                  title={titleDraft}
                  dc={dcDraft}
                  stat={diceStat ?? ''}
                  challenges={ambaChallenges}
                  challengeId={diceState?.challenge_id ?? ''}
                  canRoll={canRollCheck}
                  canClear={isGm && !rosterSaving && Object.keys(diceState?.results ?? {}).length > 0}
                  onSide={(side) => persistDiceState({ side, results: {} })}
                  onTitle={setTitleDraft}
                  onTitleCommit={(title) => persistDiceState({ title, challenge_id: undefined })}
                  onDc={setDcDraft}
                  onDcCommit={(dc) => persistDiceState({ dc, results: {}, challenge_id: undefined })}
                  onStat={(stat) => persistDiceState({ stat: stat || undefined, results: {}, challenge_id: undefined })}
                  onChallenge={(id) => {
                    if (!id) {
                      setTitleDraft('');
                      persistDiceState({ challenge_id: undefined, title: '' });
                      return;
                    }
                    const challenge = findAmbaChallenge(ambaChallenges, id);
                    if (!challenge) return;
                    const mapped = mapAmbaChallengeStat(challenge, DICE_CHECK_VALUES);
                    setTitleDraft(challenge.title);
                    setDcDraft(String(challenge.check.dc));
                    persistDiceState({
                      challenge_id: id,
                      title: challenge.title,
                      dc: challenge.check.dc,
                      ...(mapped ? { stat: mapped } : {}),
                      results: {},
                    });
                  }}
                  onRoll={() => setCheckOpen(true)}
                  onClear={() => persistDiceState({ results: {} })}
                />
              )}
              {encounterTab === 'dice' && <DiceRollColorKey />}
              <div className='p-5'>
                {encounterTab === 'combat' ? (
                  <>
                    <CombatantGrid combatants={orderedCombatants} encounterId={selectedEncounter?.id ?? null} initiativeRollNonce={initiativeRollNonce} selectedId={selectedId} onSelect={setSelectedId} statuses={statuses.data} calculating={statuses.isLoading} canManageRoster={isGm && !rosterSaving} canManageCombatant={canManageCombatant} onAddPlayer={addPlayer} onRemovePlayer={removePlayer} onCloneCreature={cloneCreature} onDeleteCreature={deleteCreature} onRestoreCombatant={(id) => setCombatantOut(id, undefined)} onMarkOut={setCombatantOut} onUpdateInitiative={updateInitiative} onUpdateHp={persistHpCurrentById} />
                    <InitiativeRoundLogPanel log={selectedEncounter?.meta_data.initiative_log ?? []} canEdit={isGm && !rosterSaving} canClear={isGm && !rosterSaving} onClear={clearInitiativeLog} onUpdateNote={updateRoundNote} />
                  </>
                ) : (
                  <>
                    <CombatantGrid combatants={diceGridRows} encounterId={selectedEncounter?.id ?? null} initiativeRollNonce={0} selectedId={selectedId} onSelect={setSelectedId} statuses={statuses.data} calculating={statuses.isLoading} canManageRoster={isGm && !rosterSaving} canManageCombatant={canManageCombatant} onAddPlayer={addPlayer} onRemovePlayer={removePlayer} onCloneCreature={cloneCreature} onDeleteCreature={deleteCreature} onRestoreCombatant={(id) => setCombatantOut(id, undefined)} onMarkOut={setCombatantOut} onUpdateInitiative={updateInitiative} onUpdateHp={persistHpCurrentById} onSingleCheck={canSingleCheck ? rollSingleCheck : undefined} onSingleChallenge={isGm && !rosterSaving && ambaChallenges.length > 0 ? rollSingleChallenge : undefined} challenges={ambaChallenges} dice={{ challengeId: diceState?.challenge_id, checkStat: diceStat, columnLabel: checkStatLabel(diceStat), dc: diceDc, results: diceState?.results ?? {}, emptyMessage: diceGridRows.length === 0 ? 'No matching combatants for this filter.' : 'Right-click a combatant to roll a check. Group rolls still use the toolbar.' }} />
                    <DiceRollLogPanel log={selectedEncounter?.meta_data.dice_roll_log ?? []} canClear={isGm && !rosterSaving} canEdit={isGm && !rosterSaving} onClear={clearDiceRollLog} onRemove={removeDiceRollLog} onUpdateNote={updateDiceRollNote} />
                  </>
                )}
              </div>
              {initiativeOpen && selectedEncounter && (
                <InitiativeRollModal
                  combatants={activeCombatants}
                  onConfirm={rollInitiative}
                  onClose={() => setInitiativeOpen(false)}
                />
              )}
              {checkToast && (
                <DiceCheckResultToast log={checkToast.log} x={checkToast.x} y={checkToast.y} onClose={() => setCheckToast(null)} />
              )}
              {checkOpen && selectedEncounter && diceStat && diceDc != null && (
                <DiceCheckRollModal
                  combatants={diceRows}
                  defaultStat={diceStat}
                  title={titleDraft || diceState?.title || ''}
                  dc={diceDc}
                  onConfirm={rollGroupCheck}
                  onClose={() => setCheckOpen(false)}
                />
              )}
              {creaturePickerOpen && (
                <SelectCreatureModal
                  busy={rosterSaving}
                  onSelect={addCreature}
                  onClose={() => setCreaturePickerOpen(false)}
                />
              )}
              {diceOpen && (
                <Phase1DiceModal
                  hint='Table rolls stay in this window until you close it. 3D dice remain on the original sheet.'
                  onClose={() => setDiceOpen(false)}
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

const NUMBERED_CREATURE_NAME = /^(.*) \((\d+)\)$/;

function creatureCombatantName(combatant: Combatant): string | undefined {
  if (combatant.type !== 'CREATURE') return undefined;
  return combatant.creature?.name ?? combatant.data?.name;
}

function withCreatureName(combatant: Combatant, name: string): Combatant {
  return {
    ...combatant,
    creature: combatant.creature ? { ...combatant.creature, name } : combatant.creature,
    data: combatant.data ? { ...combatant.data, name } : combatant.data,
  };
}

function creatureNameParts(name: string): { base: string; number: number | null } {
  const match = name.match(NUMBERED_CREATURE_NAME);
  if (!match) return { base: name, number: null };
  return { base: match[1], number: Number.parseInt(match[2], 10) };
}

/** Next "(n)" for this creature type: fill gaps first, else max used + 1. Unnumbered names count as 1. */
function nextCreatureCloneName(source: Combatant, roster: Combatant[]): string {
  const sourceName = creatureCombatantName(source) ?? 'Creature';
  const { base } = creatureNameParts(sourceName);
  const used = new Set<number>();
  for (const combatant of roster) {
    const name = creatureCombatantName(combatant);
    if (!name) continue;
    const parts = creatureNameParts(name);
    if (parts.base !== base) continue;
    used.add(parts.number ?? 1);
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return `${base} (${next})`;
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
  const user = useQuery({
    queryKey: ['phase1-public-user'],
    queryFn: () => getPublicUser(),
    staleTime: 60_000,
  });
  const patreonTier = user.data?.patreon?.tier ?? null;
  return (
    <header className='flex h-14 shrink-0 items-center gap-4 border-b border-p1-border bg-p1-header px-5'>
      <a href='/' className='font-semibold'>Wanderer's Guide</a>
      <span className='h-4 w-px bg-p1-border' />
      <Link to='/phase1' className={navClass(section === 'campaigns')}>Campaigns</Link>
      <Link to='/phase1/characters' className={navClass(section === 'characters')}>Characters</Link>
      {label && <><span className='text-p1-faint'>/</span><span className='truncate text-sm text-p1-muted'>{label}</span></>}
      <div className='ml-auto flex items-center gap-2'>
        <span className='hidden text-[11px] uppercase tracking-[0.14em] text-p1-faint sm:inline' title='patreon.tier from get-user'>
          {user.isPending ? 'Patreon…' : patreonTier ?? 'no Patreon tier'}
        </span>
        <Phase1ThemeToggle />
        <Phase1CssThemeToggle />
        <PhaseViewSwitch current='phase1' section={section} campaignId={campaignId} encounterId={encounterId} noteIndex={noteIndex} viewingSettings={viewingSettings} />
        <button className='icon-button' title='Switch account' onClick={() => supabase.auth.signOut()}><LogOut size={15} /></button>
      </div>
    </header>
  );
}

function CampaignRail({ campaign, encounters, players, outCombatants, selectedEncounter, selectedId, notePages, selectedNoteIndex, viewingSettings, isGm, rosterSaving, onRemovePlayer, onAddAllPlayers, onSelectCombatant, onMarkOut, onDeleteNote, onDeleteEncounter, onCreateNote, onCreateEncounter, onRenameNote, onRenameEncounter }: {
  campaign: Campaign; encounters: Encounter[]; players: Character[]; outCombatants: PopulatedCombatant[]; selectedEncounter: Encounter | null; selectedId: string | null; notePages: IndexedNotePage[]; selectedNoteIndex: number | null; viewingSettings: boolean; isGm: boolean; rosterSaving: boolean; onRemovePlayer: (combatantId: string) => void; onAddAllPlayers: () => void; onSelectCombatant: (id: string) => void; onMarkOut: (combatantId: string, out: Combatant['out']) => void; onDeleteNote: (index: number) => void; onDeleteEncounter: (id: number) => void; onCreateNote: (name: string) => void; onCreateEncounter: (name: string) => void; onRenameNote: (index: number, name: string) => void; onRenameEncounter: (id: number, name: string) => void;
}) {
  const [benchActive, setBenchActive] = useState(false);
  const [outActive, setOutActive] = useState(false);
  const [notesOpen, setNotesOpen] = useState(selectedNoteIndex != null);
  const [encountersOpen, setEncountersOpen] = useState(selectedEncounter != null);
  const [menu, setMenu] = useState<RailContextTarget | null>(null);
  const [sectionMenu, setSectionMenu] = useState<{ kind: 'note' | 'encounter'; x: number; y: number } | null>(null);
  const [createKind, setCreateKind] = useState<'note' | 'encounter' | null>(null);
  const [benchMenu, setBenchMenu] = useState<{ x: number; y: number } | null>(null);
  const [outMenu, setOutMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RailContextTarget | null>(null);
  const [pendingRename, setPendingRename] = useState<RailContextTarget | null>(null);
  const canManageRoster = isGm && !rosterSaving && Boolean(selectedEncounter);

  function openSectionMenu(event: ReactMouseEvent, kind: 'note' | 'encounter') {
    if (!isGm) return;
    event.preventDefault();
    setMenu(null);
    setSectionMenu({ kind, x: event.clientX, y: event.clientY });
  }

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
    event.stopPropagation();
    setSectionMenu(null);
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
      <RailLabel icon={<BookOpen size={14} />} label='Notes' count={notePages.length} open={notesOpen} onToggle={() => setNotesOpen((value) => !value)} onContextMenu={(event) => openSectionMenu(event, 'note')} />
      {notesOpen && (
        <nav className='px-2 pb-4' onContextMenu={(event) => openSectionMenu(event, 'note')}>
          {notePages.map(({ page, index }) => (
            <Link
              key={`${page.name}-${index}`}
              to={`/phase1/campaign/${campaign.id}/notes/${index}`}
              onContextMenu={(event) => openRailMenu(event, { kind: 'note', id: index, name: encounterDisplayName(page.name) })}
              className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedNoteIndex === index ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
            >
              <span className='block truncate'>{encounterDisplayName(page.name)}</span>
              {isGm && <span className='mt-0.5 block text-[11px] text-p1-faint'>{page.shared ? 'Shared with party' : 'GM only'}</span>}
            </Link>
          ))}
          {notePages.length === 0 && <p className='px-3 py-4 text-xs leading-5 text-p1-faint'>{isGm ? 'No campaign notes yet.' : 'No shared campaign notes.'}</p>}
        </nav>
      )}
      <RailLabel icon={<Swords size={14} />} label='Encounters' count={encounters.length} open={encountersOpen} onToggle={() => setEncountersOpen((value) => !value)} onContextMenu={(event) => openSectionMenu(event, 'encounter')} />
      {encountersOpen && (
        <nav className='px-2 pb-4' onContextMenu={(event) => openSectionMenu(event, 'encounter')}>
          {encounters.map((encounter) => (
            <Link
              key={encounter.id}
              to={`/phase1/campaign/${campaign.id}/encounters/${encounter.id}`}
              onContextMenu={(event) => openRailMenu(event, { kind: 'encounter', id: encounter.id, name: encounterDisplayName(encounter.name) })}
              className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedEncounter?.id === encounter.id ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
            >
              <span className='block truncate'>{encounterDisplayName(encounter.name)}</span>
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
          onRename={() => {
            setMenu(null);
            setPendingRename(menu);
          }}
          onDelete={() => {
            setMenu(null);
            setPendingDelete(menu);
          }}
        />
      )}
      {sectionMenu && (
        <SectionContextMenu
          x={sectionMenu.x}
          y={sectionMenu.y}
          onClose={() => setSectionMenu(null)}
          onNew={() => {
            const kind = sectionMenu.kind;
            setSectionMenu(null);
            if (kind === 'note') setNotesOpen(true);
            else setEncountersOpen(true);
            setCreateKind(kind);
          }}
        />
      )}
      {createKind && (
        <CreateNameModal
          title={createKind === 'note' ? 'New note' : 'New encounter'}
          label={createKind === 'note' ? 'Note name' : 'Encounter name'}
          confirmLabel='Create'
          onCancel={() => setCreateKind(null)}
          onConfirm={(name) => {
            if (createKind === 'note') onCreateNote(name);
            else onCreateEncounter(name);
            setCreateKind(null);
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
      {pendingRename && (
        <RenameDialog
          title={pendingRename.kind === 'note' ? 'Rename note' : 'Rename encounter'}
          initialName={pendingRename.name}
          onCancel={() => setPendingRename(null)}
          onConfirm={(name) => {
            if (pendingRename.kind === 'note') onRenameNote(pendingRename.id, name);
            else onRenameEncounter(pendingRename.id, name);
            setPendingRename(null);
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

const CHECK_MENU_GROUPS = ['Senses', 'Saves', 'Ability', 'Skill'] as const;

function challengeMenuGroups(challenges: Array<{ id: string; title: string; check?: AmbaChallengeTable['check']; effect?: AmbaChallengeTable['effect'] }>) {
  return challenges.map((challenge) => {
    const entries = challengeCheckEntries(challenge as AmbaChallengeTable, DICE_CHECK_VALUES);
    return {
      key: challenge.id,
      title: challenge.title,
      items: entries.map((entry, index) => ({
        key: `${challenge.id}:${entry.stat ?? entry.skill}:${index}`,
        challengeId: challenge.id,
        skill: entry.skill,
        skillLabel: entry.stat ? checkStatLabel(entry.stat) : (entry.skill ? toLabel(entry.skill) : 'Check'),
        stat: entry.stat,
      })),
    };
  });
}

function DiceCombatantContextMenu({ x, y, combatant, canCheck, challenges, canChallenge, selectedChallengeId, selectedStat, onClose, onCheck, onChallenge }: {
  x: number;
  y: number;
  combatant: PopulatedCombatant;
  canCheck: boolean;
  challenges: Array<{ id: string; title: string; check?: AmbaChallengeTable['check']; effect?: AmbaChallengeTable['effect'] }>;
  canChallenge: boolean;
  selectedChallengeId?: string;
  selectedStat?: string;
  onClose: () => void;
  onCheck: (stat: string) => void;
  onChallenge: (id: string, stat?: string) => void;
}) {
  const [openMenu, setOpenMenu] = useState<'check' | 'challenge' | null>(null);
  const [openGroup, setOpenGroup] = useState<(typeof CHECK_MENU_GROUPS)[number] | null>(null);
  const [openChallengeKey, setOpenChallengeKey] = useState<string | null>(null);
  const [skillMenuTop, setSkillMenuTop] = useState(0);
  const [checkOptions, setCheckOptions] = useState<Array<{ value: string; num: number }> | null>(null);
  const [hoverTip, setHoverTip] = useState<{ text: string; left: number; top: number } | null>(null);
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    void loadCheckOptions(combatant).then((options) => {
      if (!cancelled) setCheckOptions(options.map((option) => ({ value: option.value, num: option.num })));
    });
    return () => {
      cancelled = true;
    };
  }, [combatant]);
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 120);
  const cascadeRight = left + 200 + 176 < window.innerWidth;
  const groupLeft = cascadeRight ? left + 200 : Math.max(8, left - 176);
  const statLeft = cascadeRight ? Math.min(groupLeft + 152, window.innerWidth - 176) : Math.max(8, groupLeft - 152);
  const skillLeft = cascadeRight ? Math.min(groupLeft + 176, window.innerWidth - 160) : Math.max(8, groupLeft - 160);
  const challengeTop = top + 72;
  const groups = useMemo(() => challengeMenuGroups(challenges), [challenges]);
  const openChallengeGroup = groups.find((group) => group.key === openChallengeKey && group.items.length > 1);
  const selectedChallenge = selectedChallengeId ? challenges.find((challenge) => challenge.id === selectedChallengeId) : undefined;
  const canRollToolbarCheck = Boolean(canCheck && selectedStat);
  const canRollSelected = Boolean((canChallenge && selectedChallenge) || canRollToolbarCheck);

  function modifierTip(stat: string | undefined, skill: string) {
    const label = stat ? checkStatLabel(stat) : skill || 'check';
    if (!checkOptions) return `Loading ${label}…`;
    const option = stat ? checkOptions.find((item) => item.value === stat) : undefined;
    if (option) return `${sign(option.num)} ${label}`;
    return `${label} modifier unavailable`;
  }

  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-48 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button
          type='button'
          role='menuitem'
          disabled={!canRollSelected}
          className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint'
          title={
            selectedChallenge
              ? `Roll ${selectedChallenge.title} for this combatant`
              : canRollToolbarCheck
                ? `Roll ${checkStatLabel(selectedStat)} for this combatant`
                : 'Set a DC and check in the toolbar first'
          }
          onMouseEnter={() => { setOpenMenu(null); setOpenGroup(null); setOpenChallengeKey(null); setHoverTip(null); }}
          onClick={() => {
            if (canChallenge && selectedChallenge && selectedChallengeId) {
              onChallenge(selectedChallengeId, selectedStat);
              return;
            }
            if (canRollToolbarCheck && selectedStat) onCheck(selectedStat);
          }}
        >
          Roll this challenge
        </button>
        <button
          type='button'
          role='menuitem'
          disabled={!canCheck}
          className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint'
          title={canCheck ? 'Roll this combatant against a check' : 'Set a DC in the toolbar first'}
          onMouseEnter={() => { if (canCheck) { setOpenMenu('check'); setOpenGroup(null); setOpenChallengeKey(null); setHoverTip(null); } }}
          onClick={() => { if (canCheck) { setOpenMenu('check'); setOpenGroup(null); setOpenChallengeKey(null); } }}
        >
          Check
          <ChevronRight size={14} className='text-p1-faint' />
        </button>
        <button
          type='button'
          role='menuitem'
          disabled={!canChallenge}
          className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint'
          title={canChallenge ? 'Roll this combatant against a challenge' : 'No challenges on this encounter'}
          onMouseEnter={() => { if (canChallenge) { setOpenMenu('challenge'); setOpenChallengeKey(null); setHoverTip(null); } }}
          onClick={() => { if (canChallenge) { setOpenMenu('challenge'); setOpenChallengeKey(null); } }}
        >
          Challenge
          <ChevronRight size={14} className='text-p1-faint' />
        </button>
      </div>
      {openMenu === 'check' && canCheck && (
        <div role='menu' className='fixed z-[110] min-w-36 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left: groupLeft, top }}>
          {CHECK_MENU_GROUPS.map((group) => (
            <button
              key={group}
              type='button'
              role='menuitem'
              className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
              onMouseEnter={() => setOpenGroup(group)}
              onClick={() => setOpenGroup(group)}
            >
              {group}
              <ChevronRight size={14} className='text-p1-faint' />
            </button>
          ))}
        </div>
      )}
      {openMenu === 'check' && canCheck && openGroup && (
        <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left: statLeft, top }}>
          {DICE_CHECK_OPTIONS.filter((option) => option.group === openGroup).map((option) => (
            <button
              key={option.value}
              type='button'
              role='menuitem'
              className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
              onClick={() => onCheck(option.value)}
            >
              {checkStatLabel(option.value)}
            </button>
          ))}
        </div>
      )}
      {openMenu === 'challenge' && canChallenge && (
        <div role='menu' className='fixed z-[110] min-w-44 max-w-52 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left: groupLeft, top: challengeTop }}>
          {groups.map((group) => {
            const nested = group.items.length > 1;
            const only = group.items[0];
            const tip = !nested && only ? modifierTip(only.stat, only.skill) : undefined;
            return (
              <button
                key={group.key}
                type='button'
                role='menuitem'
                title={tip}
                className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
                onMouseEnter={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (nested) {
                    setOpenChallengeKey(group.key);
                    setSkillMenuTop(rect.top);
                    setHoverTip(null);
                    return;
                  }
                  setOpenChallengeKey(null);
                  if (tip) setHoverTip({ text: tip, left: rect.right + 8, top: rect.top });
                }}
                onMouseMove={(event) => {
                  if (nested || !tip) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoverTip({ text: tip, left: rect.right + 8, top: rect.top });
                }}
                onMouseLeave={() => { if (!nested) setHoverTip(null); }}
                onClick={() => {
                  if (nested) {
                    setOpenChallengeKey(group.key);
                    return;
                  }
                  if (only) onChallenge(only.challengeId, only.stat);
                }}
              >
                <span className='min-w-0 whitespace-normal'>{group.title}</span>
                {nested && <ChevronRight size={14} className='shrink-0 text-p1-faint' />}
              </button>
            );
          })}
        </div>
      )}
      {openMenu === 'challenge' && canChallenge && openChallengeGroup && (
        <div role='menu' className='fixed z-[110] min-w-36 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left: skillLeft, top: skillMenuTop || challengeTop }}>
          {openChallengeGroup.items.map((item) => {
            const tip = modifierTip(item.stat, item.skill);
            return (
              <button
                key={item.key}
                type='button'
                role='menuitem'
                title={tip}
                className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
                onMouseEnter={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoverTip({ text: tip, left: rect.right + 8, top: rect.top });
                }}
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoverTip({ text: tip, left: rect.right + 8, top: rect.top });
                }}
                onMouseLeave={() => setHoverTip(null)}
                onClick={() => onChallenge(item.challengeId, item.stat)}
              >
                {item.skillLabel}
              </button>
            );
          })}
        </div>
      )}
      {hoverTip && (
        <div
          role='tooltip'
          className='pointer-events-none fixed z-[111] max-w-xs border border-p1-border bg-p1-raised px-2 py-1 text-xs text-p1-text shadow-2xl'
          style={{ left: Math.min(hoverTip.left, window.innerWidth - 180), top: hoverTip.top }}
        >
          {hoverTip.text}
        </div>
      )}
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

function SectionContextMenu({ x, y, onClose, onNew }: { x: number; y: number; onClose: () => void; onNew: () => void }) {
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
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onNew}>
          <Plus size={14} /> New
        </button>
      </div>
    </>,
    document.body
  );
}

function CreateNameModal({ title, label, confirmLabel, onCancel, onConfirm }: { title: string; label: string; confirmLabel: string; onCancel: () => void; onConfirm: (name: string) => void }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  const trimmed = name.trim();
  function submit() {
    if (!trimmed) return;
    onConfirm(trimmed);
  }
  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='create-name-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='create-name-title' className='text-lg font-semibold'>{title}</h2>
        <label className='mt-3 block text-xs text-p1-muted'>
          {label}
          <input
            ref={inputRef}
            className='settings-input mt-1 w-full'
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </label>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onCancel}>Cancel</button>
          <button type='button' className='toolbar-button' disabled={!trimmed} onClick={submit}>{confirmLabel}</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function CharacterGridContextMenu({ x, y, onClose, onExportJson, onExportPdf, onDelete }: { x: number; y: number; onClose: () => void; onExportJson: () => void; onExportPdf: () => void; onDelete: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - 120);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onPointerDown={onClose} />
      <div
        role='menu'
        className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl'
        style={{ left, top }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onExportJson(); }}>
          <Download size={14} /> Export to JSON
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onExportPdf(); }}>
          <Download size={14} /> Export to PDF
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onDelete(); }}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>,
    document.body
  );
}

function RailContextMenu({ x, y, onClose, onRename, onDelete }: { x: number; y: number; onClose: () => void; onRename?: () => void; onDelete: () => void }) {
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
      <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        {onRename && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onRename}>
            <Pencil size={14} /> Rename
          </button>
        )}
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </>,
    document.body
  );
}

function RenameDialog({ title, initialName, onCancel, onConfirm }: { title: string; initialName: string; onCancel: () => void; onConfirm: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== initialName;
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='rename-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='rename-title' className='text-lg font-semibold'>{title}</h2>
        <label className='mt-3 block'>
          <span className='text-[10px] uppercase text-p1-faint'>Name</span>
          <input
            className='mt-1 h-10 w-full border border-p1-border bg-p1-inset px-3 text-base text-p1-text outline-none focus:border-p1-accent/60'
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSave) onConfirm(trimmed);
            }}
          />
        </label>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onCancel}>Cancel</button>
          <button type='button' className='toolbar-button' disabled={!canSave} onClick={() => onConfirm(trimmed)}>Rename</button>
        </div>
      </section>
    </div>,
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

function EncounterHeader({ encounter, combatants, count, isGm, noteLink, tab, onTab, canAddCreature, onAddCreature, canRollInitiative, onRollInitiative, canClearInitiative, onClearInitiative, canMaxStats, onMaxStats, canReset, onReset, onOpenDice }: { encounter: Encounter | null; combatants: PopulatedCombatant[]; count: number; isGm: boolean; noteLink?: { href: string; name: string }; tab: 'combat' | 'dice'; onTab: (tab: 'combat' | 'dice') => void; canAddCreature?: boolean; onAddCreature?: () => void; canRollInitiative?: boolean; onRollInitiative?: () => void; canClearInitiative?: boolean; onClearInitiative?: () => void; canMaxStats?: boolean; onMaxStats?: () => void; canReset?: boolean; onReset?: () => void; onOpenDice?: () => void }) {
  const [xpOpen, setXpOpen] = useState(false);
  const difficulty = encounter && shouldDisplayEncounterDifficulty(combatants) ? calculateDifficulty(encounter, combatants) : null;
  return (
    <div className='sticky top-0 z-10 border-b border-p1-border bg-p1-surface/95 px-5 py-4 backdrop-blur'>
      <div className='flex items-center gap-5'>
        <div className='min-w-0 flex-1'><Eyebrow>{isGm ? 'GM encounter' : 'Assigned encounter'}</Eyebrow><h2 className='mt-1 truncate text-xl font-semibold'>{encounter ? encounterDisplayName(encounter.name) : 'No encounter selected'}</h2>{noteLink ? <Link to={noteLink.href} className='mt-1 block truncate text-xs text-p1-accent hover:underline'>See campaign Notes page: {encounterDisplayName(noteLink.name)}</Link> : <p className='mt-1 truncate text-xs text-p1-faint'>{encounter?.meta_data.description || `${count} combatants`}</p>}
          <div className='mt-3 flex gap-1'>
            {(['combat', 'dice'] as const).map((item) => (
              <button
                key={item}
                type='button'
                className={`border-b-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${tab === item ? 'border-p1-accent text-p1-accent-soft' : 'border-transparent text-p1-faint hover:text-p1-text'}`}
                onClick={() => onTab(item)}
              >
                {item === 'combat' ? 'Combat' : 'Dice Rolls'}
              </button>
            ))}
          </div>
        </div>
        {difficulty && (
          <button type='button' className='xp-challenge' title='Open XP budget math' onClick={() => setXpOpen(true)}>
            <span className={`xp-challenge-dot xp-challenge-dot-${difficulty.color}`} />
            {difficulty.status} ({difficulty.xp} XP)
          </button>
        )}
        {xpOpen && difficulty && <EncounterDifficultyModal difficulty={difficulty} onClose={() => setXpOpen(false)} />}
        {tab === 'combat' && (
          <>
            <Phase1DiceButton onOpen={() => onOpenDice?.()} />
            {isGm && <button className='toolbar-button' disabled={!canAddCreature} title={canAddCreature ? 'Add a creature from the catalog' : 'Wait for the roster to finish saving'} onClick={onAddCreature}><Swords size={15} /> Add creature</button>}
            <button className='toolbar-button' disabled={!canRollInitiative} title={!isGm ? 'GM only' : count === 0 ? 'Add combatants first' : 'Roll initiative'} onClick={onRollInitiative}><GiDiceTwentyFacesTwenty size={15} /> Roll initiative</button>
            <button className='toolbar-button' disabled={!canClearInitiative} title={!isGm ? 'GM only' : canClearInitiative ? 'Clear initiative and restore roster order' : 'No initiative to clear'} onClick={onClearInitiative}><Eraser size={15} /> Clear init</button>
            <button className='toolbar-button' disabled={!canMaxStats} title={!isGm ? 'GM only' : canMaxStats ? 'Restore HP, spells, focus, wands/staves, and other encounter consumables' : count === 0 ? 'Add combatants first' : 'Wait for the roster to finish saving'} onClick={onMaxStats}><HeartPulse size={15} /> Max stats</button>
            <button className='toolbar-button' disabled={!canReset} title={!isGm ? 'GM only' : canReset ? 'Reset HP, temp HP, conditions, spells, initiative, and logs' : 'Wait for the roster to finish saving'} onClick={onReset}><RotateCcw size={15} /> Reset</button>
            <button className='toolbar-button' disabled title='Available after read-only parity'><Shield size={15} /> Group check</button>
          </>
        )}
      </div>
    </div>
  );
}

function DiceRollToolbar({ isGm, side, title, dc, stat, challenges, challengeId, canRoll, canClear, onSide, onTitle, onTitleCommit, onDc, onDcCommit, onStat, onChallenge, onRoll, onClear }: {
  isGm: boolean;
  side: DiceRollSide | undefined;
  title: string;
  dc: string;
  stat: string;
  challenges: Array<{ id: string; title: string }>;
  challengeId: string;
  canRoll: boolean;
  canClear: boolean;
  onSide: (side: DiceRollSide) => void;
  onTitle: (title: string) => void;
  onTitleCommit: (title: string) => void;
  onDc: (dc: string) => void;
  onDcCommit: (dc: number | null) => void;
  onStat: (stat: string) => void;
  onChallenge: (id: string) => void;
  onRoll: () => void;
  onClear: () => void;
}) {
  const groups = ['Senses', 'Saves', 'Ability', 'Skill'] as const;
  const challengesEmpty = challenges.length === 0;
  return (
    <div className='flex flex-wrap items-end gap-3 border-b border-p1-border bg-p1-surface px-5 py-3'>
      <fieldset className='flex items-center gap-3'>
        <legend className='sr-only'>Who to include</legend>
        {(['enemies', 'allies', 'both'] as const).map((value) => (
          <label key={value} className='flex items-center gap-1.5 text-xs text-p1-muted'>
            <input type='radio' name='dice-roll-side' checked={side === value} disabled={!isGm} onChange={() => onSide(value)} />
            {value === 'enemies' ? 'Enemies' : value === 'allies' ? 'Allies' : 'Both'}
          </label>
        ))}
      </fieldset>
      <label className='min-w-[12rem]'>
        <span className='text-[10px] uppercase text-p1-faint'>Challenge</span>
        <select
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-sm text-p1-text disabled:cursor-not-allowed disabled:opacity-50'
          value={challengesEmpty ? '' : challengeId}
          disabled={!isGm || challengesEmpty}
          onChange={(event) => onChallenge(event.target.value)}
        >
          {challengesEmpty ? (
            <option value=''>No challenges</option>
          ) : (
            <>
              <option value=''>Ad hoc</option>
              {challenges.map((challenge) => (
                <option key={challenge.id} value={challenge.id}>{challenge.title}</option>
              ))}
            </>
          )}
        </select>
      </label>
      <label className='min-w-[12rem] flex-1'>
        <span className='text-[10px] uppercase text-p1-faint'>Title</span>
        <input
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-sm text-p1-text'
          value={title}
          disabled={!isGm}
          placeholder='Party against flying blade trap'
          onChange={(event) => onTitle(event.target.value)}
          onBlur={() => onTitleCommit(title)}
        />
      </label>
      <label className='w-20'>
        <span className='text-[10px] uppercase text-p1-faint'>DC</span>
        <input
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-center text-sm text-p1-text'
          type='number'
          value={dc}
          disabled={!isGm}
          onChange={(event) => onDc(event.target.value)}
          onBlur={() => {
            const parsed = Number.parseInt(dc, 10);
            onDcCommit(Number.isFinite(parsed) ? parsed : null);
          }}
        />
      </label>
      <label className='min-w-[14rem]'>
        <span className='text-[10px] uppercase text-p1-faint'>Check</span>
        <select
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-base text-p1-text'
          value={stat}
          disabled={!isGm}
          onChange={(event) => onStat(event.target.value)}
        >
          <option value=''>Select a check</option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {DICE_CHECK_OPTIONS.filter((option) => option.group === group).map((option) => (
                <option key={option.value} value={option.value}>{checkStatLabel(option.value)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <button type='button' className='toolbar-button' disabled={!canRoll} title={!isGm ? 'GM only' : !canRoll ? 'Pick a side, check, and DC first' : 'Choose per-combatant bonuses, then roll'} onClick={onRoll}>
        <GiDiceTwentyFacesTwenty size={15} /> Roll
      </button>
      <button type='button' className='toolbar-button' disabled={!canClear} title={!isGm ? 'GM only' : canClear ? 'Clear current roll results from the grid. The roll log is not changed.' : 'No results to clear'} onClick={onClear}>
        <Eraser size={14} /> Clear
      </button>
    </div>
  );
}

type GridSortKey = 'name' | 'init';
type GridSort = { key: GridSortKey; dir: 'asc' | 'desc' } | null;

function compareCombatantNames(a: PopulatedCombatant, b: PopulatedCombatant) {
  return a.data.name.localeCompare(b.data.name, undefined, { numeric: true, sensitivity: 'base' });
}

function initiativeValue(combatant: PopulatedCombatant) {
  return combatant.initiative == null || Number.isNaN(combatant.initiative) ? null : combatant.initiative;
}

function compareCombatantInitiative(a: PopulatedCombatant, b: PopulatedCombatant, dir: 'asc' | 'desc') {
  const aInit = initiativeValue(a);
  const bInit = initiativeValue(b);
  if (aInit == null && bInit == null) return compareCombatantNames(a, b);
  if (aInit == null) return 1;
  if (bInit == null) return -1;
  if (aInit === bInit) return compareCombatantNames(a, b);
  return dir === 'asc' ? aInit - bInit : bInit - aInit;
}

function cycleGridSort(current: GridSort, key: GridSortKey): GridSort {
  const firstDir: 'asc' | 'desc' = key === 'init' ? 'desc' : 'asc';
  if (current?.key !== key) return { key, dir: firstDir };
  if (current.dir === firstDir) return { key, dir: firstDir === 'asc' ? 'desc' : 'asc' };
  return null;
}

function SortGlyph({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (dir === 'asc') return <ChevronUp size={12} />;
  if (dir === 'desc') return <ChevronDown size={12} />;
  return <ArrowUpDown size={12} className='opacity-50' />;
}

function CombatantGrid({ combatants, encounterId, initiativeRollNonce, selectedId, onSelect, statuses, calculating, canManageRoster, canManageCombatant, onAddPlayer, onRemovePlayer, onCloneCreature, onDeleteCreature, onRestoreCombatant, onMarkOut, onUpdateInitiative, onUpdateHp, onSingleCheck, onSingleChallenge, challenges, dice }: { combatants: PopulatedCombatant[]; encounterId: number | null; initiativeRollNonce: number; selectedId: string | null; onSelect: (id: string) => void; statuses?: CombatantStatusMap; calculating: boolean; canManageRoster: boolean; canManageCombatant: (combatant: PopulatedCombatant) => boolean; onAddPlayer: (characterId: number) => void; onRemovePlayer: (combatantId: string) => void; onCloneCreature: (combatantId: string) => void; onDeleteCreature: (combatantId: string) => void; onRestoreCombatant: (combatantId: string) => void; onMarkOut: (combatantId: string, out: Combatant['out']) => void; onUpdateInitiative: (combatantId: string, initiative: number) => void; onUpdateHp: (combatantId: string, raw: string, note: string | null) => void; onSingleCheck?: (combatantId: string, stat: string, x: number, y: number) => void; onSingleChallenge?: (combatantId: string, challengeId: string, x: number, y: number, preferredStat?: string) => void; challenges?: Array<{ id: string; title: string }>; dice?: { challengeId?: string; checkStat?: string; columnLabel: string; dc: number | null; results: Record<string, DiceCheckResult>; emptyMessage: string } }) {
  const [encounterActive, setEncounterActive] = useState(false);
  const [gridSort, setGridSort] = useState<GridSort>(() => (
    dice ? null : combatants.some((combatant) => initiativeValue(combatant) != null) ? { key: 'init', dir: 'desc' } : null
  ));
  const [menu, setMenu] = useState<{ id: string; type: Combatant['type']; x: number; y: number } | null>(null);
  const [hpEditor, setHpEditor] = useState<{ combatantId: string; name: string; currentHp: number; maxHp: number; rect: DOMRect } | null>(null);
  const [checkMods, setCheckMods] = useState<Record<string, number | null>>({});
  const [checkModsLoading, setCheckModsLoading] = useState(false);
  const checkStat = dice?.checkStat;
  const combatantIds = combatants.map((combatant) => combatant._id).join(',');
  useEffect(() => {
    setGridSort(dice ? null : combatants.some((combatant) => initiativeValue(combatant) != null) ? { key: 'init', dir: 'desc' } : null);
  }, [encounterId]);
  useEffect(() => {
    if (initiativeRollNonce > 0) setGridSort({ key: 'init', dir: 'desc' });
  }, [initiativeRollNonce]);
  useEffect(() => {
    if (!dice || !checkStat) {
      setCheckMods({});
      setCheckModsLoading(false);
      return;
    }
    let cancelled = false;
    setCheckModsLoading(true);
    void loadAllCheckOptions(combatants).then((optionsById) => {
      if (cancelled) return;
      const next: Record<string, number | null> = {};
      for (const combatant of combatants) {
        const options = optionsById[combatant._id] ?? [];
        const resolved = defaultStatForCombatant(options, checkStat);
        const option = resolved ? options.find((item) => item.value === resolved) : undefined;
        next[combatant._id] = option == null ? null : option.num;
      }
      setCheckMods(next);
      setCheckModsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dice ? 'dice' : 'combat', checkStat, combatantIds, encounterId]);
  const rows = gridSort
    ? [...combatants].sort((a, b) => (
      gridSort.key === 'name'
        ? (gridSort.dir === 'asc' ? compareCombatantNames(a, b) : compareCombatantNames(b, a))
        : compareCombatantInitiative(a, b, gridSort.dir)
    ))
    : combatants;
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
      <table className='w-full min-w-[1020px] table-fixed border-collapse text-sm'>
        <thead className='border-b border-p1-border bg-p1-header text-[10px] uppercase text-p1-faint'><tr>{!dice && <th className='w-20 px-0 text-left'><button type='button' className='inline-flex w-full items-center gap-1 px-3 py-3 uppercase hover:text-p1-muted' onClick={() => setGridSort((value) => cycleGridSort(value, 'init'))} aria-label='Cycle initiative sort' title={gridSort?.key === 'init' && gridSort.dir === 'desc' ? 'Sorted high to low. Click for low to high.' : gridSort?.key === 'init' && gridSort.dir === 'asc' ? 'Sorted low to high. Click to clear sort.' : 'Click to sort by initiative, high to low.'}>Init<SortGlyph dir={gridSort?.key === 'init' ? gridSort.dir : null} /></button></th>}<th className='px-0 text-left'><button type='button' className='inline-flex w-full items-center gap-1 px-3 py-3 uppercase hover:text-p1-muted' onClick={() => setGridSort((value) => cycleGridSort(value, 'name'))} aria-label='Cycle combatant name sort' title={gridSort?.key === 'name' && gridSort.dir === 'asc' ? 'Sorted A–Z. Click for Z–A.' : gridSort?.key === 'name' && gridSort.dir === 'desc' ? 'Sorted Z–A. Click to clear sort.' : 'Click to sort by name A–Z.'}>Combatant<SortGlyph dir={gridSort?.key === 'name' ? gridSort.dir : null} /></button></th><th className='w-44 px-3 text-left'>Conditions</th><th className='w-64 px-3 text-left'>Defenses</th>{dice && <th className='w-24 px-3 text-left'>Check</th>}<th className='w-32 px-3 text-left'>{dice ? 'Roll / DC' : 'HP'}</th>{dice && <th className='w-72 px-3 text-left'>{dice.columnLabel}{dice.dc != null ? ` vs DC ${dice.dc}` : ''}</th>}<th className='w-16 px-3 text-center'>Open</th></tr></thead>
        <tbody>
          {rows.map((combatant) => {
            const detailsVisible = combatant.access?.details_revealed !== false;
            const calculable = detailsVisible && hasFullEntityDetails(combatant);
            const calculated = statuses?.[combatant._id];
            const stats = calculated ?? (!calculable ? fallbackStatus(combatant.data) : null);
            const draggable = canManageRoster;
            const result = dice?.results[combatant._id];
            const outcomeTone = dice ? outcomeRowClass(result?.outcome) : '';
            const rowTone = outcomeTone || (combatant._id === selectedId ? 'bg-p1-accent/[0.07]' : 'hover:bg-p1-hover');
            const critInk = result?.outcome === 'critical-success';
            return (
              <tr key={combatant._id} draggable={draggable} onDragStart={(event) => { if (draggable) writeCombatantDrag(event, { source: 'encounter', combatantId: combatant._id, characterId: combatant.character }); }} onDragEnd={() => setEncounterActive(false)} onContextMenu={(event) => { if (!canManageRoster || (combatant.type !== 'CREATURE' && combatant.type !== 'CHARACTER')) return; event.preventDefault(); setMenu({ id: combatant._id, type: combatant.type, x: event.clientX, y: event.clientY }); }} className={`border-b border-p1-border last:border-0 ${draggable ? 'cursor-grab' : ''} ${rowTone}`}>
                {!dice && <td className='px-3 py-3'><InitiativeCell key={`${combatant._id}:${combatant.initiative ?? ''}:${combatant.initiative_roll?.die ?? ''}`} combatant={combatant} canEdit={canManageRoster} onUpdate={(initiative) => onUpdateInitiative(combatant._id, initiative)} /></td>}
                <td className='px-3 py-3'><button className={`flex w-full items-center gap-3 text-left ${critInk ? 'text-[#152214]' : ''}`} onClick={() => openCombatant(combatant, onSelect)}>{draggable && <GripVertical size={14} className={`shrink-0 ${critInk ? 'text-[#234028]' : 'text-p1-faint'}`} />}<EntityIcon type={combatant.type} /><span className='min-w-0'><span className='block truncate font-semibold'>{combatant.data.name}</span><span className={`block text-xs ${critInk ? 'text-[#234028]' : 'text-p1-faint'}`}>Level {combatant.data.level} | {combatant.ally ? 'Ally' : 'Enemy'}</span></span></button></td>
                <td className='px-3 py-3'>
                  <div className='flex flex-wrap items-center gap-1'>
                    {dice && (
                      <span className={`inline-flex items-center truncate rounded-full border border-p1-border px-2 py-[3px] text-[10px] font-medium leading-none tracking-wide ${result ? outcomeRowClass(result.outcome) : 'text-p1-faint'} ${critInk ? 'text-[#234028]' : ''}`}>
                        {result ? outcomeLabel(result.outcome) : 'Not rolled'}
                      </span>
                    )}
                    <CombatantConditionPills conditions={detailsVisible ? compiledConditions(combatant.data.details?.conditions ?? []) : []} onOpen={() => openCombatant(combatant, onSelect)} maxVisible={dice ? 5 : 2} />
                  </div>
                </td>
                <td className={`px-3 py-3 text-xs ${critInk ? 'text-[#234028]' : 'text-p1-muted'}`}>{!detailsVisible ? <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>Not revealed</span> : stats ? <>{stats.ac} AC <span className={`px-1 ${critInk ? 'text-[#234028]' : 'text-p1-faint'}`}>|</span> Fort {signed(stats.fortitude)}, Ref {signed(stats.reflex)}, Will {signed(stats.will)}</> : calculating ? <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>Calculating...</span> : <span className='text-p1-danger-soft'>Unavailable</span>}</td>
                {dice && (
                  <td className={`px-3 py-3 text-sm ${critInk ? 'text-[#234028]' : 'text-p1-text'}`}>
                    {!checkStat ? (
                      <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>—</span>
                    ) : checkModsLoading && !(combatant._id in checkMods) ? (
                      <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>…</span>
                    ) : checkMods[combatant._id] == null ? (
                      <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>—</span>
                    ) : (
                      <span title={`${checkStatLabel(checkStat)} modifier`}>{sign(checkMods[combatant._id]!)}</span>
                    )}
                  </td>
                )}
                <td className='px-3 py-3'>
                  {dice ? (
                    <span className='inline-flex h-9 min-w-24 items-center justify-center border border-p1-border bg-p1-raised'>
                      {result ? result.total : '—'}
                      <span className='px-2 text-p1-faint'>/</span>
                      {dice.dc ?? '—'}
                    </span>
                  ) : !detailsVisible ? (
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
                {dice && (
                  <td className={`px-3 py-3 text-xs ${critInk ? 'text-[#234028]' : 'text-p1-muted'}`}>
                    {result ? formatCheckRoll(result, result.total, dice.dc ?? undefined) : <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>Not rolled</span>}
                  </td>
                )}
                <td className='px-3 text-center'><button className='icon-button mx-auto' title={`Open ${combatant.data.name}`} onClick={() => openCombatant(combatant, onSelect)}><PanelRight size={16} /></button></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={dice ? 7 : 6} className='p-12 text-center text-sm text-p1-faint'>{dice?.emptyMessage ?? 'No combatants in this encounter.'}</td></tr>}
        </tbody>
      </table>
      {menu && dice && (() => {
        const menuCombatant = combatants.find((combatant) => combatant._id === menu.id);
        if (!menuCombatant) return null;
        return (
        <DiceCombatantContextMenu
          x={menu.x}
          y={menu.y}
          combatant={menuCombatant}
          canCheck={Boolean(onSingleCheck)}
          canChallenge={Boolean(onSingleChallenge)}
          selectedChallengeId={dice.challengeId}
          selectedStat={dice.checkStat}
          challenges={challenges ?? []}
          onClose={() => setMenu(null)}
          onCheck={(stat) => {
            const { id, x, y } = menu;
            setMenu(null);
            onSingleCheck?.(id, stat, x, y);
          }}
          onChallenge={(challengeId, preferredStat) => {
            const { id, x, y } = menu;
            setMenu(null);
            onSingleChallenge?.(id, challengeId, x, y, preferredStat);
          }}
        />
        );
      })()}
      {menu?.type === 'CREATURE' && !dice && (
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
      {menu?.type === 'CHARACTER' && !dice && (
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
    setConfirmOpen(true);
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

function CombatantConditionPills({ conditions, onOpen, maxVisible = CONDITION_PILL_MAX }: { conditions: Condition[]; onOpen: () => void; maxVisible?: number }) {
  if (conditions.length === 0) return null;
  const visible = conditions.slice(0, maxVisible);
  const extra = conditions.slice(maxVisible);
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
        <h2 className='mt-1 truncate text-xl font-semibold'>{note ? encounterDisplayName(note.page.name) : 'Note not found'}</h2>
        <p className='mt-1 truncate text-xs text-p1-faint'>{note ? (note.page.shared ? 'Shared with party' : 'Visible to the GM only') : 'This campaign note is unavailable.'}</p>
        {encounterLink && <Link to={encounterLink.href} className='mt-1 block truncate text-xs text-p1-accent hover:underline'>See encounter: {encounterDisplayName(encounterLink.name)}</Link>}
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
function CampaignWorkspaceRow({ campaign, canDelete, onOpen, onDeleted }: { campaign: Campaign; canDelete: boolean; onOpen: () => void; onDeleted: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const hasKey = Boolean(campaign.join_key);

  async function revealAndCopy(event: ReactMouseEvent) {
    event.stopPropagation();
    if (!campaign.join_key) return;
    setVisible(true);
    setCopyState((await copyJoinKey(campaign.join_key)) ? 'copied' : 'failed');
  }

  function openMenu(event: ReactMouseEvent) {
    if (!canDelete) return;
    event.preventDefault();
    event.stopPropagation();
    setDeleteError(null);
    setMenu({ x: event.clientX, y: event.clientY });
  }

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await phase1Request('delete-content', { id: campaign.id, type: 'campaign' });
      setPendingDelete(false);
      onDeleted();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete campaign.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className='group grid w-full grid-cols-[1fr_auto] items-center gap-6 px-2 py-5 hover:bg-p1-hover' onContextMenu={openMenu}>
      <button type='button' className='min-w-0 text-left' onClick={onOpen} onContextMenu={openMenu}>
        <div className='font-semibold'>{campaign.name}</div>
        <div className='mt-1 line-clamp-1 text-sm text-p1-muted'>{campaign.description || 'No campaign description'}</div>
        {deleteError && <div className='mt-1 text-xs text-p1-danger-soft'>{deleteError}</div>}
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
      {menu && (
        <RailContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onDelete={() => {
            setMenu(null);
            setPendingDelete(true);
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title='Delete campaign'
          message={`Are you sure you want to delete "${campaign.name}"? This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          onCancel={() => {
            if (!deleting) setPendingDelete(false);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
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

function CampaignLimitModal({
  busy,
  slotCap,
  onClose,
  onDeleteAndCreate,
}: {
  busy: boolean;
  slotCap: number;
  onClose: () => void;
  onDeleteAndCreate: () => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='campaign-limit-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='campaign-limit-title' className='text-lg font-semibold'>
          Campaign limit
        </h2>
        <p className='mt-2 text-sm leading-6 text-p1-muted'>
          Free Wanderer’s Guide accounts can own {slotCap} campaign{slotCap === 1 ? '' : 's'}. Delete your existing campaign to make a new one, or upgrade Wanderer’s Guide on Patreon for more slots.
        </p>
        <div className='mt-5 flex flex-col gap-2'>
          <button
            type='button'
            className='toolbar-button border-p1-danger/50 text-p1-danger-soft'
            disabled={busy}
            onClick={onDeleteAndCreate}
          >
            {busy ? 'Replacing…' : 'Delete existing and create new'}
          </button>
          <a className='toolbar-button text-center' href={PATREON_URL} rel='noreferrer' target='_blank'>
            Upgrade WG on Patreon
          </a>
        </div>
      </section>
    </div>,
    document.body
  );
}

function isCampaignLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /patreon|patron|campaign slot|too many campaign|campaign limit/i.test(message);
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
















