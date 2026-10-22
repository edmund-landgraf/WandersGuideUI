import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlignLeft, ArrowLeft, ArrowUpDown, BookOpen, Calculator, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Crosshair, Crown, Download, Eraser, Eye, EyeOff, ExternalLink, Folder, FolderDown, FolderOpen, Footprints, GripVertical, HeartPulse, History, Image as ImageIcon, KeyRound, ListChecks, LogOut, Maximize2, Menu, Minimize2, Package, PanelRight, Pencil, Plus, RotateCcw, Settings, Shield, Skull, Sparkles, Swords, Trash2, TriangleAlert, Upload, User, UserMinus, UserPlus, UserRound, UsersRound, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { AmbaChallengeTable, Campaign, Character, Combatant, Condition, Creature, DiceCheckResult, DiceRollLog, DiceRollLogEntry, DiceRollSide, DiceRollState, Encounter, Hazard, InitiativeRoundLog, InitiativeRoundLogEntry, LivingEntity } from '@schemas/content';
import { CampaignSignIn } from '@auth/CampaignSignIn';
import { signOut } from '@auth/campaign-auth';
import { useAuthSession } from '@auth/useAuthSession';
import { confirmHealth } from '@pages/character_sheet/entity-handler';
import { phase1Request, ensurePhase1PublicUser, joinPhase1CharacterByKey, asRecordList, loadPhase1Campaigns, loadPhase1CampaignEncounters, loadPhase1CampaignPlayers, numericId, ownCharacterIds, sameUserId, visibleCampaignEncounters } from './phase1-api';
import { isEnemyCreature, playerAllyRoundLog, playerEnemyLabel, playerVisibleCombatants } from './phase1-player-combat';
import { TacticsPublisher } from './tactics/TacticsPublisher';
import { loadEntityAbilities, type Phase1Ability } from './phase1-abilities';
import { readStoredDefenses } from './phase1-creature-defenses';
import { calculateEntityStatus, type Phase1CreatureStatus } from './phase1-stats';
import type { Phase1EntityCombatant } from './phase1-entity';
import { StatDetailModal, type Phase1StatKey, type Phase1StatTarget } from './phase1-stat-modal';
import { loadEntityDetails, type Phase1ProfRow } from './phase1-details';
import { loadEntitySkillsActions, type Phase1ActionGroup, type Phase1Skill } from './phase1-skills';
import {
  addEntitySpellToList,
  applyEntityDivineFont,
  clearEntitySpellSlot,
  prepareEntitySpellSlot,
  removeEntitySpellFromList,
  setEntityFocusSpent,
  setEntityInnateSpent,
  setEntityPreparedEntrySpent,
  setEntitySpellCast,
  setEntitySpellRankSpent,
} from './phase1-spells';
import { addStaffChargesFromSlot, setStaffCharges, setStaffSpellCast, setWandSpellCast } from './phase1-item-spells';
import { flattenInvItems, inventoryItemToPhase1, loadEntityInventory, matchesInvItem, type Phase1InvItem } from './phase1-inventory';
import { EntityNotesPanel, ProseMarkdown, SourceImportNotesPanel, noteContentsToMarkdown } from './phase1-markdown';
import { PlateNotesEditor } from './phase1-plate-notes';
import { isContentStackOpen, useContentLinks } from './phase1-content-links';
import { getBestShield, getItemHealth } from '@items/inv-utils';
import { toGmNotes } from '@pages/character_sheet/panels/gm-notes';
import { lookupMonsterArt, type Phase1MonsterArt } from './phase1-monster-image';
import { Icon } from '@common/Icon';
import { parseIconValue } from '@common/IconDisplay';
import { addConditionWithSpawns, compiledConditions, removeConditionWithSpawns } from '@conditions/condition-handler';
import { ConditionDetailModal, SelectConditionModal } from './phase1-conditions';
import { SelectCreatureModal, SelectHazardModal } from './phase1-creatures';
import { ActionSymbol } from '@common/Actions';
import { abilityNameAndCost } from '@utils/actions';
import { toStandard2eProse } from '@utils/foundry-text';
import { GiDiceTwentyFacesTwenty } from '@common/game-icons-inline';
import { Phase1CssThemeToggle } from './Phase1CssThemeToggle';
import { Phase1ThemeToggle } from './Phase1ThemeToggle';
import { rollDie } from '@utils/random';
import { buildInitiativeRoundLog, combatantDisplayName, formatInitiativeRoll, InitiativeRollModal, isCombatantOut, nextInitiativeRoundNumber, overlayInitiativeLogs, setRoundLogEntryNote, sortCombatantsByInitiative, type InitiativeRollChoice } from './phase1-initiative';
import { toLabel } from '@utils/strings';
import { sign } from '@utils/numbers';
import { DiceCheckResultToast, DiceCheckRollModal, DiceRollColorKey, DiceRollLogPanel } from './phase1-dice-rolls';
import { Dice3dOverlay, dice3dThrowsFromCheckLog, dice3dThrowsFromInitiativeRound, diceCheckOverlayTitle, diceRollLogKey, initiativeRoundDiceKey, type Dice3dThrow } from './phase1-dice-3d';
import { adoptServerDiceLogs, buildDiceRollLog, checkStatLabel, DICE_CHECK_OPTIONS, DICE_CHECK_VALUES, defaultStatForCombatant, degreeOfSuccess, filterCombatantsBySide, formatCheckRoll, gmDiceAudience, loadAllCheckOptions, loadCheckOptions, outcomeLabel, outcomeRowClass, overlayDiceRollMeta, playerPartyDiceCombatants, playerVisibleDiceRollLog, setDiceRollLogEntryNote } from './phase1-dice-check';
import { findAmbaChallenge, challengeCheckEntries, mapAmbaChallengeStat, mergeEncounterMeta, readAmbaChallenges } from './phase1-amba-challenges';
import { encounterDisplayName, encounterNamesMatch } from './phase1-encounter-title';
import { nextEncounterName } from './phase1-encounter-name';
import { appendChangeLog, characterCombatFieldsFromEntity, createChangeLogEntry, parseTempHpInput } from './phase1-change-log';
import { appendActionLog, createActionLogEntry, currentActionRound, removeActionLogEntry, type ActionLogDraft } from './phase1-action-log';
import { maxCombatantStats, maxEntityStats, resetCombatant, resetEntityCombatState, resolveResetMaxHp } from './phase1-encounter-reset';
import { CombatantChangeLogFooter, EditableValueWithNote, GridHpEditPopover, RoundNoteField } from './phase1-change-log-ui';
import { PhaseViewSwitch } from '../phase-switch/PhaseViewSwitch';
import { ConfirmDialog, SettingsSurface } from './phase1-campaign-settings';
import { Phase1PcStatBlocksModal } from './phase1-pc-stat-blocks';
import { CAMPAIGN_SLOT_CAP, CHARACTER_SLOT_CAP, GUIDE_BLUE } from '@constants/data';
import { PATREON_URL } from '@constants/urls';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import { hasPatreonAccess } from '@utils/patreon';
import { getAllBackgroundImages } from '@utils/background-images';
import { Phase1ArtworkOverlay, Phase1ArtworkPreview } from './phase1-background-modal';
import { PHASE1_SHEET_ART_TONE_EVENT, persistSheetArtTone, readStoredSheetArtTone, type Phase1SheetArtTone } from './phase1-theme';
import { uploadImage } from '@upload/image-upload';
import { getFileContents } from '@import/json/import-from-json';
import exportToJSON, { downloadObjectAsJson } from '@export/export-to-json';
import exportToPDF from '@export/export-to-pdf';
import { canPickExportDirectory, downloadBlob, openExportDirectory, pickExportDirectory, writeFileToDirectory, zipStored } from '@export/export-to-directory';
import { buildJsonV4Export, characterExportFileStem } from '@export/json/json-v4';
import importFromGUIDECHAR from '@import/guidechar/import-from-guidechar';
import { importFromFTC } from '@import/ftc/import-from-ftc';
import { importFromPathbuilder } from '@import/pathbuilder/import-from-pathbuilder';
import { Phase1RandomCharacterModal } from './phase1-random-character-modal';
import OfficialImportDialog from './OfficialImportDialog';
import { Phase1PortraitModal } from './phase1-portrait-modal';
import { calculateDifficulty, formatLevelDelta, shouldDisplayEncounterDifficulty, type EncounterDifficulty } from '@utils/encounter-difficulty';
import { createHazardCombatant, getHazardCurrentHp, getHazardInitiativeModifier, isHazardCombatant, updateHazardHp } from '@utils/encounter-hazard';
import { InspectorContent, HazardInspector, DETAIL_TABS, defensesForRow, fallbackStatus, hasFullEntityDetails, normalizeDetailTab, signed, statsFor, type DetailTab, type Phase1SpellActions } from './phase1-entity-panels';
type CampaignNotePage = NonNullable<Campaign['notes']>['pages'][number];
type IndexedNotePage = { page: CampaignNotePage; index: number };

const PHONE_LAYOUT_QUERY = '(max-width: 767px)';
const RAIL_DRAWER_QUERY = '(max-width: 1099px)';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function useNarrowLayout() {
  return useMediaQuery(PHONE_LAYOUT_QUERY);
}

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
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [artFrame, setArtFrame] = useState<{ id: number; preview: string; savedUrl?: string; focus: number; error?: string } | null>(null);
  const [artFrameBusy, setArtFrameBusy] = useState(false);
  const [emailVisible, setEmailVisible] = useState(() => {
    try {
      return sessionStorage.getItem('phase1-show-account-email') !== '0';
    } catch {
      return true;
    }
  });
  const [campaignLayout, setCampaignLayout] = useState<CampaignLayout>(() => readCampaignLayout());
  const [expandedOwnerFolders, setExpandedOwnerFolders] = useState<Set<string>>(() => new Set());
  const campaigns = useQuery({
    queryKey: ['phase1-campaigns', session?.user.id],
    enabled: Boolean(session?.access_token),
    queryFn: () => loadPhase1Campaigns(session!.user.id, session!.access_token),
  });

  const ownedCampaigns = (campaigns.data ?? []).filter((campaign) => sameUserId(campaign.user_id, session?.user.id));
  const otherOwnerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const campaign of campaigns.data ?? []) {
      if (campaign.user_id && !sameUserId(campaign.user_id, session?.user.id)) ids.add(campaign.user_id);
    }
    return [...ids].sort();
  }, [campaigns.data, session?.user.id]);
  const ownerProfiles = useQuery({
    queryKey: ['phase1-campaign-owners', otherOwnerIds],
    enabled: otherOwnerIds.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        otherOwnerIds.map(async (id) => {
          const user = await getPublicUser(id);
          return [id, user?.display_name?.trim() || ''] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, string>;
    },
  });
  const ownerEmails = useQuery({
    queryKey: ['phase1-campaign-owner-emails', otherOwnerIds],
    enabled: otherOwnerIds.length > 0 && Boolean(session?.access_token),
    queryFn: async () => {
      try {
        const rows = await phase1Request<{ user_id: string; email: string; display_name: string }[]>(
          'wgui-ext-campaign-owner-email',
          { user_ids: otherOwnerIds },
          session!.access_token
        );
        return Object.fromEntries(rows.map((row) => [row.user_id, { email: row.email?.trim() || '', name: row.display_name?.trim() || '' }]));
      } catch {
        return {} as Record<string, { email: string; name: string }>;
      }
    },
  });
  const ownerFolders = useMemo(() => {
    const groups = new Map<string, Campaign[]>();
    for (const campaign of campaigns.data ?? []) {
      const key = campaign.user_id || 'unknown';
      const members = groups.get(key) ?? [];
      members.push(campaign);
      groups.set(key, members);
    }
    return [...groups.entries()]
      .map(([userId, members]) => {
        const mine = sameUserId(userId, session?.user.id);
        const profileName = ownerProfiles.data?.[userId]?.trim();
        const lookedUp = ownerEmails.data?.[userId];
        return {
          key: userId,
          name: mine ? 'Me' : profileName || lookedUp?.name || 'Another GM',
          email: mine ? session?.user.email ?? '' : lookedUp?.email ?? '',
          mine,
          members: members.slice().sort((left, right) => left.name.localeCompare(right.name)),
        };
      })
      .sort((left, right) => Number(right.mine) - Number(left.mine) || left.name.localeCompare(right.name));
  }, [campaigns.data, ownerEmails.data, ownerProfiles.data, session?.user.email, session?.user.id]);
  const characters = useQuery({
    queryKey: ['phase1-characters', session?.user.id],
    enabled: Boolean(session),
    queryFn: () => phase1Request<Character[]>('find-character', { user_id: session!.user.id }),
  });
  const charactersByCampaign = useMemo(() => {
    const names = new Map<number, Character[]>();
    for (const character of characters.data ?? []) {
      const campaignId = numericId(character.campaign_id);
      if (campaignId == null) continue;
      const list = names.get(campaignId) ?? [];
      list.push(character);
      names.set(campaignId, list);
    }
    return names;
  }, [characters.data]);

  function nextCampaignName() {
    const used = new Set((campaigns.data ?? []).map((campaign) => campaign.name.trim().toLowerCase()));
    const base = 'My Campaign';
    if (!used.has(base.toLowerCase())) return base;
    let index = 1;
    while (used.has(`${base} (${index})`.toLowerCase())) index += 1;
    return `${base} (${index})`;
  }

  async function createCampaign(name?: string) {
    const accessToken = session?.access_token;
    await ensurePhase1PublicUser(accessToken);
    return phase1Request<Campaign>(
      'create-campaign',
      {
        name: name?.trim() || nextCampaignName(),
        description: 'A new adventure begins...',
        meta_data: {
          settings: {
            show_party_member_status: 'STATUS',
          },
        },
      },
      accessToken
    );
  }

  async function handleCreateCampaign(name?: string) {
    if (creating) return;
    setCreating(true);
    setCreateOpen(false);
    setCreateError(null);
    try {
      const campaign = await createCampaign(name);
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
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader section='campaigns' />
      <main className='mx-auto max-w-5xl px-6 py-10'>
        <div className='mb-8 flex items-end justify-between gap-6 border-b border-p1-border pb-6'>
          <div>
            <Eyebrow>Phase 1</Eyebrow>
            <h1 className='mt-2 text-3xl font-semibold'>Campaign workspace</h1>
            <p className='mt-2 text-sm text-p1-muted'>Choose an owned or joined campaign, or open Characters from the header.</p>
            {createError && <p className='mt-2 text-xs text-p1-danger-soft'>{createError}</p>}
          </div>
          <div className='flex flex-col items-end gap-2'>
            <div className='flex items-center gap-1'>
              {emailVisible && (
                <span className='max-w-64 truncate text-xs text-p1-muted' title={session.user.email ?? undefined}>
                  {session.user.email}
                </span>
              )}
              <button
                type='button'
                className='icon-button'
                title={emailVisible ? 'Hide email' : 'Show email'}
                aria-label={emailVisible ? 'Hide email' : 'Show email'}
                onClick={() => {
                  const next = !emailVisible;
                  setEmailVisible(next);
                  try {
                    sessionStorage.setItem('phase1-show-account-email', next ? '1' : '0');
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {emailVisible ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <div className='flex items-center gap-2'>
              <button type='button' className='toolbar-button' disabled={creating} title='Create campaign' onClick={() => setCreateOpen(true)}>
                <Plus size={15} />
                {creating ? 'Creating…' : 'Create campaign'}
              </button>
              <button className='icon-button' title='Sign out' onClick={() => void signOut()}><LogOut size={17} /></button>
            </div>
          </div>
        </div>
        {(campaigns.isLoading || (session && !session.access_token)) && <EmptyState>Loading campaigns...</EmptyState>}
        {campaigns.error && <ErrorState error={campaigns.error} />}
        {campaigns.data?.length === 0 && (
          <EmptyState>
            <div>No campaigns are available.</div>
            <button type='button' className='toolbar-button mt-4 inline-flex' disabled={creating} onClick={() => setCreateOpen(true)}>
              <Plus size={15} />
              {creating ? 'Creating…' : 'Create campaign'}
            </button>
          </EmptyState>
        )}
        {(campaigns.data?.length ?? 0) > 0 && (
          <div className='mb-4 flex items-center justify-end'>
            <div className='phase1-theme-switch stat-block-layout-switch' role='radiogroup' aria-label='Campaign list layout'>
              {([
                ['list', 'List'],
                ['owner', 'By owner'],
              ] as const).map(([id, label]) => {
                const selected = campaignLayout === id;
                return (
                  <button
                    key={id}
                    type='button'
                    role='radio'
                    aria-checked={selected}
                    className={selected ? 'is-active' : undefined}
                    onClick={() => {
                      persistCampaignLayout(id);
                      setCampaignLayout(id);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {campaignLayout === 'owner' && (campaigns.data?.length ?? 0) > 0 ? (
          <div className='divide-y divide-p1-border border-y border-p1-border'>
            {ownerFolders.map((folder) => {
              const expanded = expandedOwnerFolders.has(folder.key);
              return (
                <div key={folder.key} className='group/owner relative'>
                  <button
                    type='button'
                    className='flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-p1-hover'
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${folder.name}`}
                    onClick={() => {
                      setExpandedOwnerFolders((current) => {
                        const next = new Set(current);
                        if (next.has(folder.key)) next.delete(folder.key);
                        else next.add(folder.key);
                        return next;
                      });
                    }}
                  >
                    {expanded ? (
                      <FolderOpen size={40} strokeWidth={1.25} className='shrink-0 text-p1-accent' aria-hidden />
                    ) : (
                      <Folder size={40} strokeWidth={1.25} className='shrink-0 text-p1-muted' aria-hidden />
                    )}
                    <span className='min-w-0 truncate text-base font-semibold'>{folder.name}</span>
                    <span className='text-sm text-p1-muted'>{folder.members.length}</span>
                  </button>
                  {folder.email && (
                    <span className='pointer-events-none absolute left-14 top-0 z-20 border border-p1-border bg-p1-surface px-2 py-1 text-xs text-p1-text opacity-0 shadow-lg transition-opacity duration-150 delay-0 group-hover/owner:opacity-100 group-hover/owner:delay-[3000ms]'>
                      {folder.email}
                    </span>
                  )}
                  {expanded && (
                    <div className='divide-y divide-p1-border border-t border-p1-border'>
                      {folder.members.map((campaign) => (
                        <CampaignWorkspaceRow
                          key={campaign.id}
                          campaign={campaign}
                          canDelete={sameUserId(campaign.user_id, session.user.id)}
                          members={charactersByCampaign.get(numericId(campaign.id) ?? -1) ?? []}
                          ownedCampaigns={ownedCampaigns}
                          onOpen={() => navigate(`/phase1/campaign/${campaign.id}`)}
                          onDeleted={() => queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] })}
                          onFrame={(url) => setArtFrame({ id: campaign.id, preview: url, focus: campaignFocusY(campaign.meta_data?.image_focus_y) })}
                          onUploaded={(url) => setArtFrame((current) => (current?.id === campaign.id ? { ...current, savedUrl: url, error: undefined } : current))}
                          onFrameError={(message) => setArtFrame((current) => (current?.id === campaign.id ? { ...current, error: message } : current))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
        <div className='divide-y divide-p1-border border-y border-p1-border'>
          {campaigns.data?.map((campaign) => (
            <CampaignWorkspaceRow
              key={campaign.id}
              campaign={campaign}
              canDelete={sameUserId(campaign.user_id, session.user.id)}
              members={charactersByCampaign.get(numericId(campaign.id) ?? -1) ?? []}
              ownedCampaigns={ownedCampaigns}
              onOpen={() => navigate(`/phase1/campaign/${campaign.id}`)}
              onDeleted={() => queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] })}
              onFrame={(url) => setArtFrame({ id: campaign.id, preview: url, focus: campaignFocusY(campaign.meta_data?.image_focus_y) })}
              onUploaded={(url) => setArtFrame((current) => (current?.id === campaign.id ? { ...current, savedUrl: url, error: undefined } : current))}
              onFrameError={(message) => setArtFrame((current) => (current?.id === campaign.id ? { ...current, error: message } : current))}
            />
          ))}
        </div>
        )}
      </main>
      {createOpen && (
        <CreateNameModal
          title='New campaign'
          label='Campaign name'
          confirmLabel='Create'
          skipLabel='Skip'
          onCancel={() => setCreateOpen(false)}
          onSkip={() => { void handleCreateCampaign(); }}
          onConfirm={(name) => { void handleCreateCampaign(name); }}
        />
      )}
      {limitModalOpen && (
        <CampaignLimitModal
          busy={creating}
          slotCap={CAMPAIGN_SLOT_CAP}
          onClose={() => !creating && setLimitModalOpen(false)}
          onDeleteAndCreate={() => void deleteExistingAndCreateNew()}
        />
      )}
      {artFrame && (
        <CampaignStripDialog
          url={artFrame.preview}
          initial={artFrame.focus}
          busy={artFrameBusy || !artFrame.savedUrl}
          error={artFrame.error}
          onCancel={() => {
            if (artFrameBusy) return;
            if (artFrame.preview.startsWith('blob:')) URL.revokeObjectURL(artFrame.preview);
            setArtFrame(null);
          }}
          onConfirm={(focus) => {
            const savedUrl = artFrame.savedUrl;
            if (!savedUrl) return;
            const framed = artFrame;
            const current = campaigns.data?.find((item) => item.id === framed.id);
            if (!current) {
              setArtFrame(null);
              return;
            }
            setArtFrameBusy(true);
            void phase1Request('create-campaign', {
              ...current,
              meta_data: { ...current.meta_data, image_url: savedUrl, image_focus_y: focus },
            })
              .then(() => {
                queryClient.setQueriesData<Campaign[]>({ queryKey: ['phase1-campaigns'] }, (list) =>
                  list?.map((item) =>
                    item.id === framed.id
                      ? { ...item, meta_data: { ...item.meta_data, image_url: savedUrl, image_focus_y: focus } }
                      : item
                  )
                );
                if (framed.preview.startsWith('blob:')) URL.revokeObjectURL(framed.preview);
                setArtFrame(null);
                return queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] });
              })
              .finally(() => setArtFrameBusy(false));
          }}
        />
      )}
    </div>
  );
}

type CampaignLayout = 'list' | 'owner';

const CAMPAIGN_LAYOUT_KEY = 'phase1-campaign-layout-v2';

function readCampaignLayout(): CampaignLayout {
  try {
    return localStorage.getItem(CAMPAIGN_LAYOUT_KEY) === 'owner' ? 'owner' : 'list';
  } catch {
    return 'list';
  }
}

function persistCampaignLayout(layout: CampaignLayout) {
  try {
    localStorage.setItem(CAMPAIGN_LAYOUT_KEY, layout);
  } catch {
    /* private mode */
  }
}

type CharacterLayout = 'list' | 'campaign';

const CHARACTER_LAYOUT_KEY = 'phase1-character-layout-v2';

function readCharacterLayout(): CharacterLayout {
  try {
    return localStorage.getItem(CHARACTER_LAYOUT_KEY) === 'campaign' ? 'campaign' : 'list';
  } catch {
    return 'list';
  }
}

function persistCharacterLayout(layout: CharacterLayout) {
  try {
    localStorage.setItem(CHARACTER_LAYOUT_KEY, layout);
  } catch {
    /* private mode */
  }
}

const SHOW_CAMPAIGN_ART_KEY = 'phase1-character-show-campaign-art';

function readShowCampaignArt(): boolean {
  try {
    return localStorage.getItem(SHOW_CAMPAIGN_ART_KEY) !== '0';
  } catch {
    return true;
  }
}

function persistShowCampaignArt(show: boolean) {
  try {
    localStorage.setItem(SHOW_CAMPAIGN_ART_KEY, show ? '1' : '0');
  } catch {
    /* private mode */
  }
}

type AddAllJoinResult = {
  assigned: number;
  skippedSame: number;
  failed: number;
  firstError?: string;
  campaignName?: string;
};

function CharacterRosterRow({
  character,
  showCampaign,
  campaignName,
  unresolvedCampaign,
  onOpen,
  onContextMenu,
  onPortrait,
  onAssign,
  className,
  compact,
  ownedCampaign,
}: {
  character: Character;
  showCampaign: boolean;
  campaignName?: string;
  unresolvedCampaign?: boolean;
  onOpen: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onPortrait: () => void;
  onAssign: () => void;
  className?: string;
  compact?: boolean;
  ownedCampaign?: boolean;
}) {
  const identity = [character.details?.ancestry?.name, character.details?.background?.name, character.details?.class?.name].filter(Boolean).join(' · ');
  const portraitUrl = character.details?.image_url?.trim();
  const sheetArtUrl = character.details?.background_image_url?.trim();
  return (
    <div
      className={`p1-char-row group grid w-full items-center gap-4 px-2 text-left${compact ? ' py-1' : ' py-4'}${showCampaign ? ' grid-cols-[auto_1fr_minmax(7.5rem,11rem)_auto]' : ' grid-cols-[auto_1fr_auto]'}${sheetArtUrl ? ' p1-char-row-has-art' : ''}${className ? ` ${className}` : ''}`}
      onContextMenu={onContextMenu}
    >
      {sheetArtUrl && (
        <div className='p1-char-row-art' aria-hidden>
          <img src={sheetArtUrl} alt='' loading='lazy' decoding='async' />
          <div className='p1-char-row-art-veil' />
        </div>
      )}
      {portraitUrl ? (
        <button
          type='button'
          className='h-14 w-14 shrink-0 overflow-hidden border border-p1-border bg-p1-inset hover:border-p1-accent/60'
          title={`View portrait for ${character.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onPortrait();
          }}
        >
          <img src={portraitUrl} alt='' className='h-full w-full object-cover' />
        </button>
      ) : (
        <button
          type='button'
          className='grid h-14 w-14 shrink-0 place-items-center border border-p1-border bg-p1-inset text-p1-faint hover:border-p1-accent/60 hover:text-p1-muted'
          title={`Choose portrait for ${character.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onPortrait();
          }}
        >
          <User size={22} />
        </button>
      )}
      <button type='button' className='min-w-0 text-left' onClick={onOpen}>
        <div className='font-semibold'>{character.name}</div>
        <div className={`${compact ? 'mt-0.5' : 'mt-1'} line-clamp-1 text-sm text-p1-muted`}>Level {character.level}{identity ? ` · ${identity}` : ''}</div>
      </button>
      {showCampaign && (
        <div className='min-w-0 text-right'>
          {campaignName ? (
            <button
              type='button'
              className='toolbar-button h-8 max-w-full px-2 text-xs'
              title={campaignName}
              onClick={(event) => {
                event.stopPropagation();
                onAssign();
              }}
            >
              <span className='truncate'>{campaignName}</span>
              {ownedCampaign && <Crown size={12} className='shrink-0 text-p1-accent' aria-label='You own this campaign' />}
            </button>
          ) : unresolvedCampaign ? null : (
            <button
              type='button'
              className='toolbar-button h-8 px-2 text-xs'
              onClick={(event) => {
                event.stopPropagation();
                onAssign();
              }}
            >
              Assign
            </button>
          )}
        </div>
      )}
      <button
        type='button'
        className='grid h-10 w-10 place-items-center text-p1-faint group-hover:text-p1-accent'
        aria-label={`Open ${character.name}`}
        onClick={onOpen}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export function Phase1CharactersPage() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [joinKey, setJoinKey] = useState('');
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [pendingAddAll, setPendingAddAll] = useState<string | null>(null);
  const [checkingAddAll, setCheckingAddAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [pathbuilderOpen, setPathbuilderOpen] = useState(false);
  const [officialImportOpen, setOfficialImportOpen] = useState(false);
  const [pathbuilderId, setPathbuilderId] = useState('');
  const [pathbuilderFile, setPathbuilderFile] = useState<File | null>(null);
  const pathbuilderFileRef = useRef<HTMLInputElement>(null);
  const [characterMenu, setCharacterMenu] = useState<{ character: Character; x: number; y: number } | null>(null);
  const [joinResult, setJoinResult] = useState<{ title: string; message: string; ok: boolean } | null>(null);
  const [assignPicker, setAssignPicker] = useState<Character | null>(null);
  const [joinOtherPicker, setJoinOtherPicker] = useState<Character | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<Character | null>(null);
  const [portraitPickerOpen, setPortraitPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const [pendingRename, setPendingRename] = useState<Character | null>(null);
  const [exporting, setExporting] = useState(false);
  const [characterLayout, setCharacterLayout] = useState<CharacterLayout>(() => readCharacterLayout());
  const [showCampaignArt, setShowCampaignArt] = useState(() => readShowCampaignArt());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [exportAllOpen, setExportAllOpen] = useState(false);
  const [exportAllProgress, setExportAllProgress] = useState<{
    kind: 'json' | 'pdf';
    total: number;
    current: number;
    name: string;
    succeeded: number;
    failed: number;
    done: boolean;
    summary: string;
    directory?: FileSystemDirectoryHandle;
  } | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const guidecharInputRef = useRef<HTMLInputElement>(null);
  const characters = useQuery({
    queryKey: ['phase1-characters', session?.user.id],
    enabled: Boolean(session),
    queryFn: () => phase1Request<Character[]>('find-character', { user_id: session!.user.id }),
  });
  const campaigns = useQuery({
    queryKey: ['phase1-campaigns', session?.user.id],
    enabled: Boolean(session?.access_token),
    queryFn: () => loadPhase1Campaigns(session!.user.id, session!.access_token),
  });
  const campaignById = useMemo(
    () =>
      new Map(
        (campaigns.data ?? [])
          .map((campaign) => [numericId(campaign.id), campaign] as const)
          .filter((entry): entry is readonly [number, Campaign] => entry[0] !== null)
      ),
    [campaigns.data]
  );
  const campaignFolders = useMemo(() => {
    const groups = new Map<number, Character[]>();
    const unassigned: Character[] = [];
    for (const character of characters.data ?? []) {
      const campaignId = numericId(character.campaign_id);
      if (campaignId == null) {
        unassigned.push(character);
        continue;
      }
      const members = groups.get(campaignId) ?? [];
      members.push(character);
      groups.set(campaignId, members);
    }
    const folders = [...groups.entries()]
      .map(([id, members]) => ({
        key: String(id),
        name: campaignById.get(id)?.name?.trim() || `Campaign ${id}`,
        members,
        campaign: campaignById.get(id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (unassigned.length > 0) folders.push({ key: 'unassigned', name: 'Unassigned', members: unassigned, campaign: undefined });
    return folders;
  }, [campaignById, characters.data]);
  const ownedCampaignFolders = useMemo(
    () => campaignFolders.filter((folder) => folder.campaign && sameUserId(folder.campaign.user_id, session?.user.id)),
    [campaignFolders, session?.user.id]
  );
  const joinedCampaignFolders = useMemo(
    () => campaignFolders.filter((folder) => !folder.campaign || !sameUserId(folder.campaign.user_id, session?.user.id)),
    [campaignFolders, session?.user.id]
  );
  const assignableCampaigns = useMemo(
    () => (campaigns.data ?? []).filter((campaign) => sameUserId(campaign.user_id, session?.user.id)).slice(0, 6),
    [campaigns.data, session?.user.id]
  );

  const addAllToJoinKey = useMutation({
    mutationFn: async (): Promise<AddAllJoinResult> => {
      const key = joinKey.trim();
      if (!key) throw new Error('Enter a join key.');
      const roster = characters.data ?? [];
      const campaigns = await phase1Request<Campaign[]>('find-campaign', { join_key: key });
      const campaign = campaigns?.[0];
      if (!campaign) throw new Error('Invalid join key. Please ask your GM for a valid key.');

      let skippedSame = 0;
      const eligible: Character[] = [];
      for (const character of roster) {
        if (numericId(character.campaign_id) === numericId(campaign.id)) {
          skippedSame += 1;
          continue;
        }
        eligible.push(character);
      }

      let assigned = 0;
      let failed = 0;
      let firstError: string | undefined;
      for (const character of eligible) {
        try {
          const id = numericId(character.id);
          if (id == null) throw new Error('Character is missing an id.');
          await joinPhase1CharacterByKey(id, key);
          assigned += 1;
        } catch (error) {
          failed += 1;
          if (!firstError) firstError = error instanceof Error ? error.message : 'join-campaign failed';
        }
      }

      return { assigned, skippedSame, failed, firstError, campaignName: campaign.name };
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
      if (result.failed) parts.push(`${result.failed} failed${result.firstError ? `: ${result.firstError}` : ''}`);
      setJoinStatus(parts.join(' · '));
    },
    onError: (error) => {
      setJoinStatus(error instanceof Error ? error.message : 'Could not add characters to join key.');
    },
  });

  function rememberCharacterCampaign(characterId: number, campaign: Campaign | null) {
    const campaignId = campaign ? numericId(campaign.id) : null;
    queryClient.setQueryData<Character[]>(['phase1-characters', session?.user.id], (roster) =>
      (roster ?? []).map((item) => (numericId(item.id) === characterId ? { ...item, campaign_id: campaignId } : item))
    );
    if (campaign && campaignId != null) {
      queryClient.setQueryData<Campaign[]>(['phase1-campaigns', session?.user.id], (current) => {
        const list = current ?? [];
        if (list.some((item) => numericId(item.id) === campaignId)) return list;
        return [...list, campaign];
      });
    }
  }

  async function invalidateCharacterCampaigns() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] }),
      queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] }),
    ]);
  }

  async function assignCharacterToCampaign(character: Character, campaign: Campaign) {
    const campaignId = numericId(campaign.id);
    if (campaignId == null) throw new Error('Campaign is missing an id.');
    if (numericId(character.campaign_id) === campaignId) return { already: true as const, campaign };
    const updated = await phase1Request<Character | Character[]>('update-character', {
      id: character.id,
      campaign_id: campaignId,
    });
    const saved = asRecordList(updated)[0];
    if (numericId(saved?.campaign_id) !== campaignId) {
      throw new Error('Could not assign that campaign. Try joining with the campaign key instead.');
    }
    return { already: false as const, campaign };
  }

  async function joinCharacterWithKey(character: Character, key: string) {
    const trimmed = key.trim();
    if (!trimmed) {
      setJoinResult({
        ok: false,
        title: 'Could not join campaign',
        message: 'Enter a join key.',
      });
      return;
    }
    try {
      const result = await joinPhase1CharacterByKey(numericId(character.id) ?? character.id, trimmed);
      rememberCharacterCampaign(numericId(result.character.id) ?? character.id, result.campaign);
      await invalidateCharacterCampaigns();
      setJoinResult({
        ok: true,
        title: 'Joined campaign',
        message: result.already
          ? `${character.name} is already in the ${result.campaign.name} campaign.`
          : `${character.name} successfully added to the ${result.campaign.name} campaign.`,
      });
    } catch (error) {
      setJoinResult({
        ok: false,
        title: 'Could not join campaign',
        message: error instanceof Error ? error.message : `Could not add ${character.name} to the campaign.`,
      });
    }
  }

  async function unassignCharacterFromCampaign(character: Character) {
    if (numericId(character.campaign_id) == null) return;
    const campaign = campaignById.get(numericId(character.campaign_id)!);
    const isOwnCampaign = sameUserId(campaign?.user_id, session?.user.id);
    if (isOwnCampaign) {
      await phase1Request('remove-from-campaign', { character_id: character.id, campaign_id: character.campaign_id });
    } else {
      await phase1Request('update-character', { id: character.id, campaign_id: null });
    }
    queryClient.setQueryData<Character[]>(['phase1-characters', session?.user.id], (roster) =>
      (roster ?? []).map((item) => (item.id === character.id ? { ...item, campaign_id: null } : item))
    );
    await invalidateCharacterCampaigns();
  }

  async function assignCharacterFromPicker(character: Character, campaign: Campaign) {
    try {
      const result = await assignCharacterToCampaign(character, campaign);
      rememberCharacterCampaign(numericId(character.id) ?? character.id, campaign);
      await invalidateCharacterCampaigns();
      setAssignPicker(null);
      setJoinResult({
        ok: true,
        title: 'Assigned to campaign',
        message: result.already
          ? `${character.name} is already in the ${campaign.name} campaign.`
          : `${character.name} successfully added to the ${campaign.name} campaign.`,
      });
    } catch (error) {
      setAssignPicker(null);
      setJoinResult({
        ok: false,
        title: 'Could not assign campaign',
        message: error instanceof Error ? error.message : `Could not add ${character.name} to the campaign.`,
      });
    }
  }

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
          downloadObjectAsJson({ version: 4, character }, characterExportFileStem(character.name));
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

  async function exportAll(kind: 'json' | 'pdf') {
    const roster = characters.data ?? [];
    if (!roster.length || exporting) return;
    setExportAllOpen(false);
    const folderExport = canPickExportDirectory();
    let directory: FileSystemDirectoryHandle | null = null;
    if (folderExport) {
      try {
        directory = await pickExportDirectory();
      } catch (error) {
        setJoinStatus(error instanceof Error ? error.message : 'Could not open the export folder.');
        return;
      }
      if (!directory) return;
    }
    const zipFiles: { name: string; data: Uint8Array }[] = [];
    const usedNames = new Set<string>();

    const format = kind === 'json' ? 'JSON' : 'PDF';
    setExporting(true);
    setExportAllProgress({
      kind,
      total: roster.length,
      current: 0,
      name: roster[0]?.name ?? '',
      succeeded: 0,
      failed: 0,
      done: false,
          summary: `Exporting ${roster.length} ${format} file${roster.length === 1 ? '' : 's'}…`,
          directory: directory ?? undefined,
        });
    let succeeded = 0;
    let failed = 0;
    try {
      for (let index = 0; index < roster.length; index += 1) {
        const source = roster[index];
        setExportAllProgress({
          kind,
          total: roster.length,
          current: index + 1,
          name: source.name,
          succeeded,
          failed,
          done: false,
          summary: `Exporting ${index + 1} of ${roster.length}: “${source.name}”`,
          directory: directory ?? undefined,
        });
        try {
          const character = await loadCharacterForExport(source.id);
          const stem = characterExportFileStem(character.name);
          const extension = kind === 'json' ? 'json' : 'pdf';
          let fileName = `${stem}.${extension}`;
          if (usedNames.has(fileName)) {
            let copy = 2;
            while (usedNames.has(`${stem}-${copy}.${extension}`)) copy += 1;
            fileName = `${stem}-${copy}.${extension}`;
          }
          usedNames.add(fileName);
          if (kind === 'json') {
            let payload: Record<string, unknown>;
            try {
              payload = await buildJsonV4Export(character);
            } catch (error) {
              console.error(error);
              payload = { version: 4, character };
            }
            const json = JSON.stringify(payload);
            if (directory) await writeFileToDirectory(directory, fileName, json, 'application/json');
            else zipFiles.push({ name: fileName, data: new TextEncoder().encode(json) });
          } else {
            const { pdfV2Bytes } = await import('@export/pdf/pdf-v2');
            const bytes = await pdfV2Bytes(character);
            if (directory) await writeFileToDirectory(directory, fileName, bytes, 'application/pdf');
            else zipFiles.push({ name: fileName, data: bytes });
          }
          succeeded += 1;
        } catch (error) {
          console.error(error);
          failed += 1;
        }
      }
      let summary = failed
        ? `Exported ${succeeded} ${format} file${succeeded === 1 ? '' : 's'}; ${failed} failed.`
        : `Exported ${succeeded} ${format} file${succeeded === 1 ? '' : 's'}.`;
      if (!directory && zipFiles.length > 0) {
        const zipName = `characters-${kind}.zip`;
        downloadBlob(zipStored(zipFiles), zipName);
        summary = `${summary} Downloaded ${zipName}.`;
      }
      setJoinStatus(summary);
      setExportAllProgress({
        kind,
        total: roster.length,
        current: roster.length,
        name: '',
        succeeded,
        failed,
        done: true,
        summary,
        directory: directory ?? undefined,
      });
    } finally {
      setExporting(false);
    }
  }

  const canAddAll =
    Boolean(joinKey.trim()) && Boolean(characters.data?.length) && !addAllToJoinKey.isPending && !checkingAddAll;

  async function requestAddAll() {
    if (!canAddAll) return;
    const key = joinKey.trim();
    const roster = characters.data ?? [];
    setCheckingAddAll(true);
    try {
      const found = await phase1Request<Campaign[]>('find-campaign', { join_key: key });
      const campaign = found?.[0];
      if (!campaign) {
        addAllToJoinKey.mutate();
        return;
      }
      const elsewhere = roster.filter((character) => character.campaign_id != null && character.campaign_id !== campaign.id);
      if (elsewhere.length > 0) {
        const noun = elsewhere.length === 1 ? 'character is' : 'characters are';
        setPendingAddAll(`${elsewhere.length} ${noun} already in another campaign. Add all will move them to this join key.`);
        return;
      }
      addAllToJoinKey.mutate();
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Could not add characters to join key.');
    } finally {
      setCheckingAddAll(false);
    }
  }
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
      const accessToken = session?.access_token;
      await ensurePhase1PublicUser(accessToken);
      const character = await phase1Request<Character>(
        'create-character',
        {
          meta_data: { reset_hp: true },
          details: { background_image_url: randomImageUrl },
        },
        accessToken
      );
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      navigate(`/builder/${character.id}`);
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Could not create character.');
    } finally {
      setCreating(false);
    }
  }

  async function createRandomCharacter(picks: { class?: string; ancestry?: string; background?: string; level: number }) {
    if (createDisabled) return;
    setCreating(true);
    setJoinStatus('Creating random character. This may take a minute…');
    try {
      const character = await importFromFTC({
        version: '1.0',
        data: {
          name: 'RANDOM',
          class: picks.class ?? 'RANDOM',
          background: picks.background ?? 'RANDOM',
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
            setExportAllOpen(false);
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
      const accessToken = session?.access_token;
      await ensurePhase1PublicUser(accessToken);
      const created = await phase1Request<Character>('create-character', character, accessToken);
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

  async function importPathbuilder() {
    const id = Number.parseInt(pathbuilderId, 10);
    if (!pathbuilderFile && !id) return;
    setPathbuilderOpen(false);
    setImporting(true);
    setJoinStatus(null);
    try {
      const character = await importFromPathbuilder(pathbuilderFile ? { file: pathbuilderFile } : id, {
        notify: false,
      });
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
      setJoinStatus(character ? `Imported “${character.name}”.` : 'Pathbuilder import failed.');
    } catch (error) {
      setJoinStatus(error instanceof Error ? error.message : 'Pathbuilder import failed.');
    } finally {
      setImporting(false);
      setPathbuilderFile(null);
      setPathbuilderId('');
    }
  }

  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <CampaignSignIn variant='phase1' />;
  return (
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader section='characters' />
      <main className='mx-auto max-w-5xl px-6 py-10'>
        <div className='mb-3 flex flex-wrap items-end justify-between gap-6 border-b border-p1-border pb-3'>
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
                <button
                  type='button'
                  className='toolbar-button'
                  disabled={exporting || !(characters.data?.length)}
                  title='Export all characters'
                  onClick={() => {
                    setCreateOpen(false);
                    setUploadOpen(false);
                    setExportAllOpen((open) => !open);
                  }}
                >
                  <FolderDown size={15} />
                  {exporting ? 'Exporting…' : 'Export all'}
                </button>
                {exportAllOpen && (
                  <div className='absolute right-0 z-20 mt-1 min-w-[14rem] border border-p1-border bg-p1-surface py-1'>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => void exportAll('pdf')}>Export all as PDF</button>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => void exportAll('json')}>Export all as JSON</button>
                  </div>
                )}
              </div>
              <div className='relative'>
                <button type='button' className='toolbar-button' disabled={createDisabled} title={reachedCharacterLimit ? 'Character slot limit reached' : 'Upload character'} onClick={() => { setCreateOpen(false); setExportAllOpen(false); setUploadOpen((open) => !open); }}>
                  <Upload size={15} />
                  {importing ? 'Uploading…' : 'Upload/Import'}
                </button>
                {uploadOpen && (
                  <div className='absolute right-0 z-20 mt-1 min-w-[14rem] border border-p1-border bg-p1-surface py-1'>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => { setUploadOpen(false); jsonInputRef.current?.click(); }}>Import from JSON</button>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => { setUploadOpen(false); setPathbuilderOpen(true); }}>Import from Pathbuilder</button>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => { setUploadOpen(false); guidecharInputRef.current?.click(); }}>Import from GUIDECHAR</button>
                    <button type='button' className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => { setUploadOpen(false); setOfficialImportOpen(true); }}>Import from wanderersguide.app</button>
                  </div>
                )}
              </div>
              <button type='button' className='toolbar-button' disabled={!canAddAll} onClick={() => void requestAddAll()}>
                <Plus size={15} />
                {addAllToJoinKey.isPending || checkingAddAll ? 'Adding…' : 'Add all'}
              </button>
              <div className='min-w-[12rem] flex-1'>
                <input
                  className='settings-input h-9 w-full'
                  aria-label='Join key'
                  placeholder='Join key'
                  value={joinKey}
                  disabled={addAllToJoinKey.isPending}
                  onChange={(event) => {
                    setJoinKey(event.target.value);
                    setJoinStatus(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canAddAll) void requestAddAll();
                  }}
                />
              </div>
              {(characters.data?.length ?? 0) > 0 && (
                <>
                  {campaignFolders.some((folder) => campaignHasRowArt(folder.campaign)) && (
                    <label className={`flex items-center gap-2 text-sm text-p1-muted${characterLayout === 'list' ? ' opacity-50' : ' cursor-pointer'}`}>
                      <input
                        type='checkbox'
                        className='accent-[var(--p1-accent)]'
                        disabled={characterLayout === 'list'}
                        checked={showCampaignArt}
                        onChange={(event) => {
                          persistShowCampaignArt(event.target.checked);
                          setShowCampaignArt(event.target.checked);
                        }}
                      />
                      Campaign art
                    </label>
                  )}
                  <div className='phase1-theme-switch stat-block-layout-switch' role='radiogroup' aria-label='Character list layout'>
                    {([
                      ['list', 'List'],
                      ['campaign', 'By campaign'],
                    ] as const).map(([id, label]) => {
                      const selected = characterLayout === id;
                      return (
                        <button
                          key={id}
                          type='button'
                          role='radio'
                          aria-checked={selected}
                          className={selected ? 'is-active' : undefined}
                          onClick={() => {
                            persistCharacterLayout(id);
                            setCharacterLayout(id);
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
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
        {characterLayout === 'campaign' && (characters.data?.length ?? 0) > 0 ? (
          <div className='divide-y divide-p1-border border-y border-p1-border'>
            {([
              ['Campaigns I own', ownedCampaignFolders],
              ["Campaigns I'm on", joinedCampaignFolders],
            ] as const).map(([heading, folders]) => (
              <div key={heading}>
                <div className='px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-p1-muted'>{heading}</div>
                {folders.length === 0 && <p className='px-2 pb-2 text-sm text-p1-muted'>None</p>}
                <div className='divide-y divide-p1-border border-t border-p1-border'>
                {folders.map((folder) => {
              const expanded = expandedFolders.has(folder.key);
              const artUrl = folder.campaign?.meta_data?.image_url?.trim();
              const rowColor = normalizeRowColor(folder.campaign?.meta_data?.row_color);
              const showStrip = showCampaignArt && Boolean(artUrl || rowColor);
              const focusY = campaignFocusY(folder.campaign?.meta_data?.image_focus_y);
              return (
                <div key={folder.key}>
                  <button
                    type='button'
                    className={`flex w-full items-center gap-3 px-2 py-2 text-left${showStrip ? ' p1-char-row p1-char-row-has-art' : ' hover:bg-p1-hover'}`}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${folder.name}`}
                    onClick={() => {
                      setExpandedFolders((current) => {
                        const next = new Set(current);
                        if (next.has(folder.key)) next.delete(folder.key);
                        else next.add(folder.key);
                        return next;
                      });
                    }}
                  >
                    {showStrip && (
                      <div className='p1-char-row-art' aria-hidden>
                        {artUrl ? (
                          <CampaignStripArt url={artUrl} focusY={focusY} />
                        ) : (
                          <div className='h-full w-full' style={{ backgroundColor: rowColor }} />
                        )}
                        <div className='p1-char-row-art-veil' />
                      </div>
                    )}
                    {expanded ? (
                      <FolderOpen size={40} strokeWidth={1.25} className='shrink-0 text-p1-accent' aria-hidden />
                    ) : (
                      <Folder size={40} strokeWidth={1.25} className='shrink-0 text-p1-muted' aria-hidden />
                    )}
                    <span className='min-w-0 truncate text-base font-semibold'>{folder.name}</span>
                    {folder.campaign && sameUserId(folder.campaign.user_id, session.user.id) && (
                      <Crown size={14} className='shrink-0 text-p1-accent' aria-label='You own this campaign' />
                    )}
                    <span className='text-sm text-p1-muted'>{folder.members.length}</span>
                  </button>
                  {expanded && (
                    <div className='divide-y divide-p1-border border-t border-p1-border'>
                      {folder.members.length === 0 ? (
                        <p className='px-10 py-3 text-sm text-p1-muted'>No characters</p>
                      ) : (
                        folder.members.map((character) => (
                          <CharacterRosterRow
                            key={character.id}
                            character={character}
                            className='pl-8'
                            compact
                            showCampaign={false}
                            campaignName={undefined}
                            onOpen={() => navigate(`/sheet/${character.id}`)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setCharacterMenu({ character, x: event.clientX, y: event.clientY });
                            }}
                            onPortrait={() => {
                              setPortraitPreview(character);
                              setPortraitPickerOpen(!character.details?.image_url?.trim());
                            }}
                            onAssign={() => setAssignPicker(character)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='divide-y divide-p1-border border-y border-p1-border'>
            {characters.data?.map((character) => {
              const campaignId = numericId(character.campaign_id);
              const assignedCampaign = campaignId != null ? campaignById.get(campaignId) : undefined;
              return (
                <CharacterRosterRow
                  key={character.id}
                  character={character}
                  showCampaign
                  campaignName={assignedCampaign?.name}
                  ownedCampaign={Boolean(assignedCampaign && sameUserId(assignedCampaign.user_id, session.user.id))}
                  unresolvedCampaign={campaignId != null && !assignedCampaign}
                  onOpen={() => navigate(`/sheet/${character.id}`)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCharacterMenu({ character, x: event.clientX, y: event.clientY });
                  }}
                  onPortrait={() => {
                    setPortraitPreview(character);
                    setPortraitPickerOpen(!character.details?.image_url?.trim());
                  }}
                  onAssign={() => setAssignPicker(character)}
                />
              );
            })}
          </div>
        )}
        {characterMenu && (
          <CharacterGridContextMenu
            x={characterMenu.x}
            y={characterMenu.y}
            onClose={() => setCharacterMenu(null)}
            onJoinMyCampaign={() => {
              const target = characterMenu.character;
              setCharacterMenu(null);
              setAssignPicker(target);
            }}
            onJoinOthersCampaign={() => {
              const target = characterMenu.character;
              setCharacterMenu(null);
              setJoinOtherPicker(target);
            }}
            onUnassign={
              numericId(characterMenu.character.campaign_id) == null
                ? undefined
                : () => {
                    const target = characterMenu.character;
                    setCharacterMenu(null);
                    void unassignCharacterFromCampaign(target).catch((error) => {
                      setJoinResult({
                        ok: false,
                        title: 'Could not unassign campaign',
                        message: error instanceof Error ? error.message : `Could not remove ${target.name} from the campaign.`,
                      });
                    });
                  }
            }
            onExportJson={() => {
              const target = characterMenu.character;
              setCharacterMenu(null);
              void exportCharacter('json', target);
            }}
            onOpenStatBlock={() => {
              const target = characterMenu.character;
              setCharacterMenu(null);
              window.open(`/stat-block/character/${target.id}`, '_blank');
            }}
            onRename={() => {
              setPendingRename(characterMenu.character);
              setCharacterMenu(null);
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
        {portraitPreview && portraitPreview.details?.image_url && (
          <PortraitPreviewModal
            url={portraitPreview.details.image_url}
            name={portraitPreview.name}
            ignoreEscape={portraitPickerOpen}
            onChange={() => setPortraitPickerOpen(true)}
            onClose={() => {
              setPortraitPreview(null);
              setPortraitPickerOpen(false);
            }}
          />
        )}
        {portraitPreview && portraitPickerOpen && (
          <Phase1PortraitModal
            currentUrl={portraitPreview.details?.image_url}
            overlayClass='z-[110]'
            onSelect={(url) => {
              const next = { ...portraitPreview, details: { ...portraitPreview.details, image_url: url } };
              setPortraitPreview(url ? next : null);
              setPortraitPickerOpen(false);
              void phase1Request('update-character', { id: portraitPreview.id, details: next.details }).then(
                () => {
                  void queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
                },
                (error) => {
                  setJoinStatus(error instanceof Error ? error.message : 'Could not update portrait.');
                }
              );
            }}
            onClose={() => {
              setPortraitPickerOpen(false);
              if (!portraitPreview.details?.image_url) setPortraitPreview(null);
            }}
          />
        )}
        {pendingAddAll && (
          <ConfirmDialog
            title='Move characters'
            message={pendingAddAll}
            confirmLabel={addAllToJoinKey.isPending ? 'Adding…' : 'Add all'}
            onCancel={() => setPendingAddAll(null)}
            onConfirm={() => {
              setPendingAddAll(null);
              addAllToJoinKey.mutate();
            }}
          />
        )}
        {pendingRename && (
          <RenameDialog
            title='Rename character'
            initialName={pendingRename.name}
            onCancel={() => setPendingRename(null)}
            onConfirm={(name) => {
              const target = pendingRename;
              setPendingRename(null);
              void phase1Request('update-character', { id: target.id, name }).then(
                () => {
                  void queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] });
                },
                (error) => {
                  setJoinStatus(error instanceof Error ? error.message : 'Could not rename character.');
                }
              );
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
        {assignPicker && (
          <CampaignAssignPickerModal
            characterName={assignPicker.name}
            campaigns={assignableCampaigns}
            onCancel={() => setAssignPicker(null)}
            onPick={(campaign) => void assignCharacterFromPicker(assignPicker, campaign)}
          />
        )}
        {joinOtherPicker && (
          <JoinKeyModal
            characterName={joinOtherPicker.name}
            onCancel={() => setJoinOtherPicker(null)}
            onConfirm={(key) => {
              const target = joinOtherPicker;
              setJoinOtherPicker(null);
              void joinCharacterWithKey(target, key);
            }}
          />
        )}
        {joinResult && (
          <MessageDialog
            title={joinResult.title}
            message={joinResult.message}
            onClose={() => setJoinResult(null)}
          />
        )}
        <input ref={jsonInputRef} type='file' accept='application/json,.json' className='hidden' onChange={(event) => { void importJsonFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
        <input ref={guidecharInputRef} type='file' accept='.guidechar' className='hidden' onChange={(event) => { void importGuidecharFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
        {exportAllProgress && (
          <div
            className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5'
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && exportAllProgress.done) setExportAllProgress(null);
            }}
          >
            <section role='dialog' aria-modal='true' aria-labelledby='export-all-title' className='w-full max-w-md border border-p1-border bg-p1-surface p-5'>
              <h2 id='export-all-title' className='text-lg font-semibold'>
                {exportAllProgress.done ? 'Export complete' : `Exporting ${exportAllProgress.kind === 'json' ? 'JSON' : 'PDF'}`}
              </h2>
              <p className='mt-2 text-sm text-p1-muted'>{exportAllProgress.summary}</p>
              <div className='mt-4 h-2 overflow-hidden border border-p1-border bg-p1-page' role='progressbar' aria-valuemin={0} aria-valuemax={exportAllProgress.total} aria-valuenow={exportAllProgress.current}>
                <div
                  className='h-full transition-[width] duration-200'
                  style={{
                    width: `${exportAllProgress.total ? Math.round((exportAllProgress.current / exportAllProgress.total) * 100) : 0}%`,
                    background: 'var(--p1-accent)',
                  }}
                />
              </div>
              <p className='mt-2 text-xs text-p1-muted'>
                {exportAllProgress.current}/{exportAllProgress.total}
                {exportAllProgress.failed ? ` · ${exportAllProgress.failed} failed` : ''}
              </p>
              {exportAllProgress.done && (
                <div className='mt-5 flex flex-wrap justify-end gap-2'>
                  {exportAllProgress.directory && (
                    <button
                      type='button'
                      className='toolbar-button'
                      style={{ background: 'var(--p1-accent)', color: 'var(--p1-accent-ink)', borderColor: 'var(--p1-accent)' }}
                      onClick={() => void openExportDirectory(exportAllProgress.directory!)}
                    >
                      <FolderOpen size={15} />
                      Open folder
                    </button>
                  )}
                  <button type='button' className='toolbar-button' onClick={() => setExportAllProgress(null)}>
                    OK
                  </button>
                  <button type='button' className='toolbar-button' onClick={() => setExportAllProgress(null)}>
                    Close
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
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
      {officialImportOpen && (
        <OfficialImportDialog
          accessToken={session?.access_token}
          slotsRemaining={
            hasPatreonAccess(getCachedPublicUser(), 2)
              ? null
              : Math.max(0, CHARACTER_SLOT_CAP - (characters.data?.length ?? 0))
          }
          onClose={() => setOfficialImportOpen(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: ['phase1-characters', session?.user.id] })}
        />
      )}
      {pathbuilderOpen && (
        <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget) setPathbuilderOpen(false); }}>
          <section className='w-full max-w-md border border-p1-border bg-p1-surface p-5'>
            <h2 className='text-lg font-semibold'>Import from Pathbuilder 2e</h2>
            <p className='mt-2 text-sm text-p1-muted'>
              Enter a Pathbuilder JSON ID, or upload an Export JSON file if the ID fetch is blocked. Some feats, items, and spells may be missing because Pathbuilder names often differ from Paizo CUP names. Runes, containers, formulas, and companions are not imported.
            </p>
            <input
              className='settings-input mt-4 h-9 w-full'
              type='number'
              min={1}
              placeholder='123456'
              value={pathbuilderId}
              onChange={(event) => setPathbuilderId(event.target.value)}
            />
            <input
              ref={pathbuilderFileRef}
              type='file'
              accept='application/json,.json'
              className='hidden'
              onChange={(event) => {
                setPathbuilderFile(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />
            <button type='button' className='toolbar-button mt-3 w-full' onClick={() => pathbuilderFileRef.current?.click()}>
              {pathbuilderFile ? pathbuilderFile.name : 'Or upload Export JSON'}
            </button>
            <div className='mt-4 flex justify-end gap-2'>
              <button type='button' className='toolbar-button' onClick={() => { setPathbuilderOpen(false); setPathbuilderFile(null); }}>Cancel</button>
              <button
                type='button'
                className='toolbar-button'
                disabled={!pathbuilderFile && !Number.parseInt(pathbuilderId, 10)}
                style={{ background: 'var(--p1-accent)', color: 'var(--p1-accent-ink)', borderColor: 'var(--p1-accent)' }}
                onClick={() => void importPathbuilder()}
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

function phase1EncounterPath(encounterId: number, campaignId?: number | null) {
  return campaignId != null ? `/phase1/campaign/${campaignId}/encounters/${encounterId}` : `/phase1/encounters/${encounterId}`;
}

function defaultEncounterTab(encounter: Encounter | null | undefined): 'combat' | 'dice' {
  const list = encounter?.combatants.list ?? [];
  const hasPcs = list.some((item) => item.type === 'CHARACTER');
  const hasEnemies = list.some((item) => item.type !== 'CHARACTER' && item.type !== 'HAZARD' && !item.ally);
  return hasPcs && !hasEnemies ? 'dice' : 'combat';
}

function encounterSideCounts(encounter: Encounter) {
  const list = encounter.combatants.list ?? [];
  return {
    pcs: list.filter((item) => item.ally).length,
    enemies: list.filter((item) => !item.ally).length,
  };
}

function standaloneEncounterPayload(name: string): Encounter {
  return {
    id: -1,
    created_at: '',
    user_id: '',
    name,
    icon: 'combat',
    color: GUIDE_BLUE,
    campaign_id: null,
    combatants: { list: [] },
    meta_data: { description: '' },
  };
}

export function Phase1EncountersPage() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const encounters = useQuery({
    queryKey: ['phase1-standalone-encounters', session?.user.id],
    enabled: Boolean(session),
    queryFn: async () => {
      const result = await phase1Request<Encounter[]>('find-encounter', { user_id: session!.user.id });
      return (result ?? []).filter((item) => item.campaign_id == null);
    },
  });

  async function handleCreateEncounter(name?: string) {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    setCreateOpen(false);
    try {
      const nextName = name?.trim() || nextEncounterName((encounters.data ?? []).map((item) => item.name));
      const encounter = await phase1Request<Encounter>('create-encounter', standaloneEncounterPayload(nextName));
      await queryClient.invalidateQueries({ queryKey: ['phase1-standalone-encounters'] });
      if (encounter?.id != null && encounter.id !== -1) {
        navigate(`/phase1/encounters/${encounter.id}`);
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create encounter.');
    } finally {
      setCreating(false);
    }
  }

  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <CampaignSignIn variant='phase1' />;
  return (
    <div className='min-h-screen max-w-full overflow-x-hidden bg-p1-page text-p1-text'>
      <WorkspaceHeader section='encounters' />
      <main className='mx-auto max-w-5xl px-6 py-10'>
        <div className='mb-8 flex items-end justify-between gap-6 border-b border-p1-border pb-6'>
          <div>
            <Eyebrow>Phase 1</Eyebrow>
            <h1 className='mt-2 text-3xl font-semibold'>Encounters</h1>
            <p className='mt-2 text-sm text-p1-muted'>Standalone combats that are not tied to a campaign.</p>
            {createError && <p className='mt-2 text-xs text-p1-danger-soft'>{createError}</p>}
          </div>
          <button type='button' className='toolbar-button' disabled={creating} title='Create encounter' onClick={() => setCreateOpen(true)}>
            <Plus size={15} />
            {creating ? 'Creating…' : 'Create encounter'}
          </button>
        </div>
        {encounters.isLoading && <EmptyState>Loading encounters...</EmptyState>}
        {encounters.error && <ErrorState error={encounters.error} />}
        {encounters.data?.length === 0 && (
          <EmptyState>
            <div>No standalone encounters yet.</div>
            <button type='button' className='toolbar-button mt-4 inline-flex' disabled={creating} onClick={() => setCreateOpen(true)}>
              <Plus size={15} />
              {creating ? 'Creating…' : 'Create encounter'}
            </button>
          </EmptyState>
        )}
        {!!encounters.data?.length && (
          <div className='overflow-hidden border border-p1-border'>
            <table className='w-full text-left text-sm'>
              <thead className='border-b border-p1-border bg-p1-header text-[11px] uppercase tracking-wide text-p1-faint'>
                <tr>
                  <th className='px-4 py-3 font-semibold'>Encounter</th>
                  <th className='px-4 py-3 font-semibold'>PCs</th>
                  <th className='px-4 py-3 font-semibold'>Enemies</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-p1-border'>
                {encounters.data.map((encounter) => (
                  <EncounterListRow
                    key={encounter.id}
                    encounter={encounter}
                    onOpen={() => navigate(`/phase1/encounters/${encounter.id}`)}
                    onChanged={() => queryClient.invalidateQueries({ queryKey: ['phase1-standalone-encounters'] })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {createOpen && (
        <CreateNameModal
          title='New encounter'
          label='Encounter name'
          confirmLabel='Create'
          skipLabel='Skip'
          onCancel={() => setCreateOpen(false)}
          onSkip={() => { void handleCreateEncounter(); }}
          onConfirm={(name) => { void handleCreateEncounter(name); }}
        />
      )}
    </div>
  );
}

export function Phase1StandaloneEncounterPage() {
  const session = useAuthSession();
  const { encounterId: rawEncounterId } = useParams();
  const encounterId = rawEncounterId ? Number(rawEncounterId) : null;
  const enabled = Boolean(session && encounterId != null && Number.isFinite(encounterId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const encounterSaveChain = useRef(Promise.resolve<void>(undefined));
  const initiativeLogsRef = useRef(new Map<number, InitiativeRoundLog[]>());
  const diceLogsRef = useRef(new Map<number, DiceRollLog[]>());
  const diceStatesRef = useRef(new Map<number, DiceRollState | undefined>());
  const encountersKey = ['phase1-standalone-encounters', session?.user.id] as const;
  const playersKey = ['phase1-standalone-characters', session?.user.id] as const;
  const encounters = useQuery({
    queryKey: encountersKey,
    enabled,
    queryFn: async () => {
      const result = await phase1Request<Encounter[]>('find-encounter', { user_id: session!.user.id });
      const fetched = overlayInitiativeLogs((result ?? []).filter((item) => item.campaign_id == null), initiativeLogsRef.current);
      if (queryClient.isMutating({ mutationKey: ['phase1-update-standalone-encounter'] }) === 0) {
        adoptServerDiceLogs(fetched, diceLogsRef.current);
      }
      return overlayDiceRollMeta(fetched, diceLogsRef.current, diceStatesRef.current);
    },
  });
  const players = useQuery({
    queryKey: playersKey,
    enabled,
    queryFn: () => phase1Request<Character[]>('find-character', { user_id: session!.user.id }),
  });
  const updateEncounter = useMutation<boolean, Error, Encounter, { previous?: Encounter[] }>({
    mutationKey: ['phase1-update-standalone-encounter'],
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
      if (queryClient.isMutating({ mutationKey: ['phase1-update-standalone-encounter'] }) > 1) return;
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
    mutationFn: (name: string) => phase1Request<Encounter>('create-encounter', standaloneEncounterPayload(name)),
    onSuccess: (encounter) => {
      queryClient.invalidateQueries({ queryKey: encountersKey });
      if (encounter?.id != null && encounter.id !== -1) {
        navigate(`/phase1/encounters/${encounter.id}`);
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
  if (session === undefined) return <LoadingScreen label='Loading session' />;
  if (!session) return <CampaignSignIn variant='phase1' />;
  if (encounters.isLoading || players.isLoading) return <LoadingScreen label='Loading encounter' />;
  const error = encounters.error || players.error;
  if (error) return <PageError error={error} />;
  const visible = encounters.data ?? [];
  const selected = visible.find((item) => item.id === encounterId) ?? null;
  function handleCreateEncounter(name: string) {
    const trimmed = name.trim();
    createEncounter.mutate(trimmed ? encounterDisplayName(trimmed) : nextEncounterName(visible.map((item) => item.name)));
  }
  function handleDeleteEncounter(id: number) {
    const remaining = visible.filter((item) => item.id !== id);
    deleteEncounter.mutate(id);
    if (encounterId === id) {
      if (remaining[0]) navigate(`/phase1/encounters/${remaining[0].id}`);
      else navigate('/phase1/encounters');
    }
  }
  async function handleDeleteAllEncounters() {
    const ids = visible.map((item) => item.id);
    if (encounterId != null && ids.includes(encounterId)) navigate('/phase1/encounters');
    for (const id of ids) await deleteEncounter.mutateAsync(id);
  }
  if (!selected) return <PageError error={new Error('Encounter not found')} />;
  const isGm = !selected.user_id || sameUserId(selected.user_id, session.user.id);
  return (
    <EncounterWorkspace
      campaign={null}
      encounters={visible}
      players={players.data ?? []}
      selectedEncounter={selected}
      notePages={[]}
      selectedNote={null}
      viewingNotes={false}
      viewingSettings={false}
      isGm={isGm}
      sessionUserId={session.user.id}
      onUpdateEncounter={(encounter) => updateEncounter.mutate(encounter)}
      onUpdateCharacter={(id, fields) => updateCharacter.mutate({ id, ...fields })}
      onUpdateCampaign={() => undefined}
      onResetJoinKey={async () => undefined}
      onKickPlayer={async () => undefined}
      onDeleteCampaign={async () => undefined}
      onDeleteNote={() => undefined}
      onDeleteEncounter={handleDeleteEncounter}
      onDeleteAllEncounters={handleDeleteAllEncounters}
      onCreateNote={() => undefined}
      onCreateEncounter={handleCreateEncounter}
      rosterSaving={updateEncounter.isPending}
      campaignSaving={false}
      rosterError={updateEncounter.error ?? updateCharacter.error ?? deleteEncounter.error}
      campaignError={null}
    />
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
  const campaign = useQuery({
    queryKey: campaignKey,
    enabled,
    queryFn: async () => asRecordList(await phase1Request<Campaign | Campaign[]>('find-campaign', { id: campaignId }))[0] ?? null,
  });
  const players = useQuery({
    queryKey: playersKey,
    enabled,
    refetchInterval: 4000,
    queryFn: () => loadPhase1CampaignPlayers(campaignId, session!.user.id, session!.access_token),
  });
  const encounters = useQuery({
    queryKey: encountersKey,
    enabled,
    refetchInterval: 4000,
    queryFn: async () => {
      const fetched = overlayInitiativeLogs(await loadPhase1CampaignEncounters(campaignId, session!.access_token), initiativeLogsRef.current);
      const diceWriteInFlight = queryClient.isMutating({ mutationKey: ['phase1-patch-encounter-dice', campaignId] }) > 0
        || queryClient.isMutating({ mutationKey: ['phase1-update-encounter', campaignId] }) > 0;
      if (!diceWriteInFlight) adoptServerDiceLogs(fetched, diceLogsRef.current);
      return overlayDiceRollMeta(fetched, diceLogsRef.current, diceStatesRef.current);
    },
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
  const patchEncounterDice = useMutation<
    { dice_roll_state?: DiceRollState; dice_roll_log?: DiceRollLog[] },
    Error,
    { encounterId: number; campaignId: number; dice_roll_state?: DiceRollState; dice_roll_log?: DiceRollLog[] },
    { previous?: Encounter[] }
  >({
    mutationKey: ['phase1-patch-encounter-dice', campaignId],
    mutationFn: (patch) => {
      const result = encounterSaveChain.current.then(() =>
        phase1Request<{ dice_roll_state?: DiceRollState; dice_roll_log?: DiceRollLog[] }>('wgui-ext-patch-encounter-dice', {
          campaign_id: patch.campaignId,
          encounter_id: patch.encounterId,
          ...('dice_roll_state' in patch ? { dice_roll_state: patch.dice_roll_state } : {}),
          ...('dice_roll_log' in patch ? { dice_roll_log: patch.dice_roll_log } : {}),
        })
      );
      encounterSaveChain.current = result.then(() => undefined, () => undefined);
      return result;
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: encountersKey });
      const previous = queryClient.getQueryData<Encounter[]>(encountersKey);
      if (patch.dice_roll_log !== undefined) {
        diceLogsRef.current.set(patch.encounterId, patch.dice_roll_log);
      }
      if ('dice_roll_state' in patch) {
        diceStatesRef.current.set(patch.encounterId, patch.dice_roll_state);
      }
      queryClient.setQueryData<Encounter[]>(encountersKey, (current = []) =>
        current.map((item) =>
          item.id !== patch.encounterId
            ? item
            : {
                ...item,
                meta_data: {
                  ...item.meta_data,
                  ...(patch.dice_roll_log !== undefined ? { dice_roll_log: patch.dice_roll_log } : {}),
                  ...('dice_roll_state' in patch ? { dice_roll_state: patch.dice_roll_state } : {}),
                },
              }
        )
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(encountersKey, context.previous);
    },
    onSuccess: (data, patch) => {
      if (data.dice_roll_log !== undefined) diceLogsRef.current.set(patch.encounterId, data.dice_roll_log);
      if ('dice_roll_state' in data) diceStatesRef.current.set(patch.encounterId, data.dice_roll_state);
      queryClient.setQueryData<Encounter[]>(encountersKey, (current = []) =>
        current.map((item) =>
          item.id !== patch.encounterId
            ? item
            : {
                ...item,
                meta_data: {
                  ...item.meta_data,
                  ...(data.dice_roll_log !== undefined ? { dice_roll_log: data.dice_roll_log } : {}),
                  ...('dice_roll_state' in data ? { dice_roll_state: data.dice_roll_state } : {}),
                },
              }
        )
      );
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ['phase1-patch-encounter-dice', campaignId] }) > 1) return;
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
  const isGm = sameUserId(campaignData.user_id, session.user.id);
  const ownIds = ownCharacterIds(players.data ?? [], session.user.id);
  const visible = visibleCampaignEncounters(encounters.data ?? [], campaignId, isGm, ownIds);
  const notePages = visibleNotePages(campaignData, isGm);
  const selectedNote = noteIndex == null ? null : notePages.find((item) => item.index === noteIndex) ?? null;
  function handleDeleteAllNotes() {
    deleteNote.mutate({ ...campaignData, notes: { ...campaignData.notes, pages: [] } });
    if (viewingNotes) {
      if (visible[0]) navigate(`/phase1/campaign/${campaignId}/encounters/${visible[0].id}`);
      else navigate(`/phase1/campaign/${campaignId}`);
    }
  }
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
    const trimmed = name.trim();
    createEncounter.mutate(trimmed ? encounterDisplayName(trimmed) : nextEncounterName(visible.map((item) => item.name)));
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
  async function handleDeleteAllEncounters() {
    const ids = visible.map((item) => item.id);
    if (encounterId != null && ids.includes(encounterId)) {
      if (notePages[0]) navigate(`/phase1/campaign/${campaignId}/notes/${notePages[0].index}`);
      else navigate(`/phase1/campaign/${campaignId}`);
    }
    for (const id of ids) await deleteEncounter.mutateAsync(id);
  }
  async function addAllPcsToAllEncounters() {
    const current = queryClient.getQueryData<Encounter[]>(encountersKey) ?? visible;
    const pcs = players.data ?? [];
    for (const encounter of current) {
      const next = encounterWithAllPlayers(encounter, pcs);
      if (next) await updateEncounter.mutateAsync(next);
    }
  }
  if (!viewingNotes && !viewingSettings && !encounterId && visible[0]) return <Navigate replace to={`/phase1/campaign/${campaignId}/encounters/${visible[0].id}`} />;
  if (viewingNotes && !isGm) {
    if (visible[0]) return <Navigate replace to={`/phase1/campaign/${campaignId}/encounters/${visible[0].id}`} />;
    return <Navigate replace to={`/phase1/campaign/${campaignId}`} />;
  }
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
      onAddAllPcsToEncounters={addAllPcsToAllEncounters}
      onPatchEncounterDice={(patch) => patchEncounterDice.mutate(patch)}
      onUpdateCharacter={(id, fields) => updateCharacter.mutate({ id, ...fields })}
      onUpdateCampaign={(next) => updateCampaign.mutate(next)}
      onResetJoinKey={() => resetJoinKey.mutateAsync()}
      onKickPlayer={(characterId) => kickPlayer.mutateAsync(characterId)}
      onDeleteCampaign={() => deleteCampaign.mutateAsync()}
      onDeleteNote={handleDeleteNote}
      onDeleteAllNotes={handleDeleteAllNotes}
      onDeleteEncounter={handleDeleteEncounter}
      onDeleteAllEncounters={handleDeleteAllEncounters}
      onCreateNote={handleCreateNote}
      onCreateEncounter={handleCreateEncounter}
      rosterSaving={updateEncounter.isPending || patchEncounterDice.isPending}
      campaignSaving={updateCampaign.isPending}
      rosterError={updateEncounter.error ?? patchEncounterDice.error ?? updateCharacter.error ?? deleteEncounter.error ?? deleteNote.error}
      campaignError={updateCampaign.error ?? resetJoinKey.error ?? kickPlayer.error ?? deleteCampaign.error}
    />
  );
}


function EncounterWorkspace({ campaign, encounters, players, selectedEncounter, notePages, selectedNote, viewingNotes, viewingSettings, isGm, sessionUserId, onUpdateEncounter, onAddAllPcsToEncounters, onPatchEncounterDice, onUpdateCharacter, onUpdateCampaign, onResetJoinKey, onKickPlayer, onDeleteCampaign, onDeleteNote, onDeleteAllNotes, onDeleteEncounter, onDeleteAllEncounters, onCreateNote, onCreateEncounter, rosterSaving, campaignSaving, rosterError, campaignError }: {
  campaign: Campaign | null; encounters: Encounter[]; players: Character[]; selectedEncounter: Encounter | null; notePages: IndexedNotePage[]; selectedNote: IndexedNotePage | null; viewingNotes: boolean; viewingSettings: boolean; isGm: boolean; sessionUserId: string; onUpdateEncounter: (encounter: Encounter) => void; onAddAllPcsToEncounters?: () => Promise<void> | void; onPatchEncounterDice?: (patch: { encounterId: number; campaignId: number; dice_roll_state?: DiceRollState; dice_roll_log?: DiceRollLog[] }) => void; onUpdateCharacter: (id: number, fields: { spells?: Character['spells']; details?: Character['details']; inventory?: Character['inventory']; hp_current?: number; hp_temp?: number; stamina_current?: number; resolve_current?: number }) => void; onUpdateCampaign: (campaign: Campaign) => void; onResetJoinKey: () => Promise<unknown>; onKickPlayer: (characterId: number) => Promise<unknown>; onDeleteCampaign: () => Promise<unknown>; onDeleteNote: (index: number) => void; onDeleteAllNotes?: () => void; onDeleteEncounter: (id: number) => void; onDeleteAllEncounters?: () => Promise<void> | void; onCreateNote: (name: string) => void; onCreateEncounter: (name: string) => void; rosterSaving: boolean; campaignSaving: boolean; rosterError: Error | null; campaignError: Error | null;
}) {
  const standalone = campaign == null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailWidth, setDetailWidth] = useState(readDetailWidth);
  const narrow = useNarrowLayout();
  const railDrawer = useMediaQuery(RAIL_DRAWER_QUERY);
  const [railOpen, setRailOpen] = useState(() => typeof window !== 'undefined' && !window.matchMedia(RAIL_DRAWER_QUERY).matches);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const { pathname } = useLocation();
  const [activeTab, setActiveTab] = useState<DetailTab>('Health');
  const [initiativeOpen, setInitiativeOpen] = useState(false);
  const [initiativeRollNonce, setInitiativeRollNonce] = useState(0);
  const [creaturePickerOpen, setCreaturePickerOpen] = useState(false);
  const [hazardPickerOpen, setHazardPickerOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingCampaignRemove, setPendingCampaignRemove] = useState<{ id: number; name: string } | null>(null);
  const [statBlocksOpen, setStatBlocksOpen] = useState(false);
  const [encounterTab, setEncounterTab] = useState<'combat' | 'dice'>(() => defaultEncounterTab(selectedEncounter));
  const [artTone, setArtTone] = useState<Phase1SheetArtTone>(() => readStoredSheetArtTone());
  const [artPreview, setArtPreview] = useState(false);
  const [artBand, setArtBand] = useState(false);
  const [confirmClearArt, setConfirmClearArt] = useState(false);
  const [artRequest, setArtRequest] = useState(0);
  const artHiddenKey = campaign ? `phase1-encounter-art-off:${campaign.id}` : '';
  const [artHidden, setArtHidden] = useState(() => (artHiddenKey ? window.localStorage.getItem(artHiddenKey) === '1' : false));
  useEffect(() => {
    setArtHidden(artHiddenKey ? window.localStorage.getItem(artHiddenKey) === '1' : false);
  }, [artHiddenKey]);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkToast, setCheckToast] = useState<{ log: DiceRollLog; x: number; y: number } | null>(null);
  const [dice3dThrows, setDice3dThrows] = useState<{ throws: Dice3dThrow[]; title?: string } | null>(null);
  const seenInitiativeDiceKeyRef = useRef<string | null>(null);
  const seenInitiativeDiceEncounterRef = useRef<number | null>(null);
  const seenDiceCheckKeyRef = useRef<string | null>(null);
  const seenDiceCheckEncounterRef = useRef<number | null>(null);
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
  if (selectedEncounter?.meta_data.dice_roll_log && (selectedEncounter.meta_data.dice_roll_log.length === 0 || selectedEncounter.meta_data.dice_roll_log.length >= diceLogRef.current.length)) {
    diceLogRef.current = selectedEncounter.meta_data.dice_roll_log;
  }
  if (selectedEncounter?.meta_data.dice_roll_state) {
    diceStateRef.current = selectedEncounter.meta_data.dice_roll_state;
  }
  const selected = combatants.find((item) => item._id === selectedId) ?? null;
  const statuses = useCombatantStatuses(selectedEncounter?.id ?? null, combatants);
  const stampedDefensesKey = useRef('');
  useEffect(() => {
    if (!isGm || rosterSaving || !statuses.data) return;
    const encounter = selectedEncounterRef.current;
    if (!encounter) return;
    let changed = false;
    const list = encounter.combatants.list.map((combatant) => {
      if (combatant.type !== 'CREATURE') return combatant;
      const source = combatant.creature ?? combatant.data;
      const status = defensesForRow(statuses.data?.[combatant._id], source);
      if (!status || !source || typeof source.meta_data?.calculated_stats?.ac === 'number') return combatant;
      if (status.ac <= 10 && readStoredDefenses(source).ac == null) return combatant;
      changed = true;
      return {
        ...combatant,
        creature: combatant.creature ? stampCreatureDefenses(combatant.creature, status) : combatant.creature,
        data: combatant.data ? stampCreatureDefenses(combatant.data, status) : stampCreatureDefenses(source, status),
      };
    });
    if (!changed) return;
    const key = `${encounter.id}:${list.map((combatant) => combatant._id).join(',')}`;
    if (stampedDefensesKey.current === key) return;
    stampedDefensesKey.current = key;
    persistRoster(list);
  }, [statuses.data, isGm, rosterSaving]);
  const encounterNote = notePages.find((item) => encounterNamesMatch(item.page.name, selectedEncounter?.name));
  const noteEncounter = encounters.find((item) => encounterNamesMatch(item.name, selectedNote?.page.name));
  const activeCharacterIds = new Set((selectedEncounter?.combatants.list ?? []).filter((combatant) => combatant.type === 'CHARACTER').map((combatant) => combatant.character));
  const benchPlayers = players.filter((player) => !activeCharacterIds.has(player.id));
  const diceState = selectedEncounter?.meta_data.dice_roll_state;
  const ambaChallenges = useMemo(() => readAmbaChallenges(selectedEncounter?.meta_data), [selectedEncounter?.meta_data]);
  const diceSide = isGm ? (diceState?.side ?? 'allies') : diceState?.side;
  const diceStat = diceState?.stat ?? undefined;
  const diceDc = diceState?.dc ?? null;
  const playerDiceRows = playerPartyDiceCombatants(activeCombatants.filter((combatant) => combatant.type !== 'HAZARD'));
  const livingActive = activeCombatants.filter((combatant) => combatant.type !== 'HAZARD');
  const diceRows = isGm
    ? (!diceSide || !diceStat ? [] : filterCombatantsBySide(livingActive, diceSide))
    : playerDiceRows;
  const gmDiceGridRows = diceSide ? filterCombatantsBySide(livingActive, diceSide) : livingActive;
  const diceGridRows = isGm ? gmDiceGridRows : playerDiceRows;
  const canRollCheck = Boolean(!rosterSaving && diceStat && diceDc != null && Number.isFinite(diceDc) && diceRows.length > 0 && (isGm ? Boolean(diceSide) : true));
  const canEditDice = !rosterSaving;

  function persistDiceMeta(metaPatch: Pick<Partial<Encounter['meta_data']>, 'dice_roll_state' | 'dice_roll_log'>) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || rosterSaving) return;
    const dice_roll_log = metaPatch && 'dice_roll_log' in metaPatch
      ? metaPatch.dice_roll_log ?? []
      : encounter.meta_data.dice_roll_log ?? diceLogRef.current;
    diceLogRef.current = dice_roll_log;
    const dice_roll_state = metaPatch && 'dice_roll_state' in metaPatch
      ? metaPatch.dice_roll_state
      : encounter.meta_data.dice_roll_state ?? diceStateRef.current;
    diceStateRef.current = dice_roll_state;
    if (isGm) {
      persistRoster(encounter.combatants.list, { ...metaPatch, dice_roll_log, dice_roll_state });
      return;
    }
    if (!campaign) return;
    onPatchEncounterDice?.({
      encounterId: encounter.id,
      campaignId: campaign.id,
      ...('dice_roll_state' in metaPatch ? { dice_roll_state } : {}),
      ...('dice_roll_log' in metaPatch ? { dice_roll_log } : {}),
    });
  }

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
    setEncounterTab('combat');
    updateRoster([...selectedEncounter.combatants.list, { _id: crypto.randomUUID(), type: 'CHARACTER', ally: true, initiative: undefined, character: characterId, data: undefined }]);
  }

  function addAllPlayers() {
    if (!selectedEncounter || benchPlayers.length === 0) return;
    setEncounterTab('combat');
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

  async function removeCharacterFromCampaign(characterId: number) {
    await onKickPlayer(characterId);
    for (const encounter of encounters) {
      const list = encounter.combatants.list.filter((item) => item.type !== 'CHARACTER' || item.character !== characterId);
      if (list.length === encounter.combatants.list.length) continue;
      if (encounter.id === selectedEncounterRef.current?.id) {
        persistRoster(list);
        setSelectedId((current) => (current && list.some((item) => item._id === current) ? current : null));
      } else {
        onUpdateEncounter({ ...encounter, combatants: { list } });
      }
    }
  }

  function addCreature(creature: Creature, ally: boolean) {
    if (!selectedEncounter) return;
    setEncounterTab('combat');
    const id = crypto.randomUUID();
    const list = selectedEncounter.combatants.list;
    let incoming: Combatant = {
      _id: id,
      type: 'CREATURE',
      ally,
      initiative: undefined,
      creature: structuredClone(creature),
      character: undefined,
      data: undefined,
    };
    const sourceName = creatureCombatantName(incoming) ?? 'Creature';
    const { base } = creatureNameParts(sourceName);
    const sameType = list.filter((item) => {
      const name = creatureCombatantName(item);
      return Boolean(name && creatureNameParts(name).base === base);
    });
    const only = sameType.length === 1 ? sameType[0] : undefined;
    const onlyName = only ? creatureCombatantName(only) : undefined;
    const firstOfType = Boolean(only && onlyName && creatureNameParts(onlyName).number === null);
    let nextList = list;
    if (firstOfType && only) {
      nextList = list.map((item) => (item._id === only._id ? withCreatureName(item, `${base} (1)`) : item));
      incoming = withCreatureName(incoming, `${base} (2)`);
    } else if (sameType.length > 0) {
      incoming = withCreatureName(incoming, nextCreatureCloneName(incoming, list));
    }
    updateRoster([...nextList, incoming]);
    setSelectedId(id);
  }

  function addHazard(hazard: Hazard) {
    if (!selectedEncounter) return;
    setEncounterTab('combat');
    const incoming = createHazardCombatant(hazard, crypto.randomUUID());
    updateRoster([...selectedEncounter.combatants.list, incoming]);
    setSelectedId(incoming._id);
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
    if (combatant?.type !== 'CREATURE' && combatant?.type !== 'HAZARD') return;
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
      if (choice === undefined) return combatant;
      const bonus = choice?.bonus ?? 0;
      const source = choice?.source ?? '';
      rolledIds.add(combatant._id);
      const die = rollDie('D20');
      return {
        ...combatant,
        initiative: die + bonus,
        initiative_roll: { die, bonus, source },
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
    seenInitiativeDiceKeyRef.current = initiativeRoundDiceKey(roundEntry);
    seenInitiativeDiceEncounterRef.current = encounter.id;
    maybeShowDice3d(
      dice3dThrowsFromInitiativeRound(roundEntry),
    );
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

  function maybeShowDice3d(throws: Dice3dThrow[], title?: string) {
    if (throws.length === 0) return;
    setDice3dThrows({ throws, title });
  }

  const initiativeLog = selectedEncounter?.meta_data.initiative_log;
  useEffect(() => {
    const encounterId = selectedEncounter?.id ?? null;
    const latest = initiativeLog?.[initiativeLog.length - 1];
    const key = initiativeRoundDiceKey(latest);
    if (encounterId !== seenInitiativeDiceEncounterRef.current) {
      seenInitiativeDiceEncounterRef.current = encounterId;
      seenInitiativeDiceKeyRef.current = key;
      return;
    }
    if (key === seenInitiativeDiceKeyRef.current) return;
    seenInitiativeDiceKeyRef.current = key;
    if (!latest) return;
    maybeShowDice3d(
      dice3dThrowsFromInitiativeRound(latest, (entry) => (isGm || entry.ally ? entry.name : playerEnemyLabel(entry.name))),
    );
  }, [selectedEncounter?.id, initiativeLog, isGm]);

  const diceRollLog = selectedEncounter?.meta_data.dice_roll_log;
  useEffect(() => {
    const encounterId = selectedEncounter?.id ?? null;
    const latest = diceRollLog?.[diceRollLog.length - 1];
    const key = diceRollLogKey(latest);
    if (encounterId !== seenDiceCheckEncounterRef.current) {
      seenDiceCheckEncounterRef.current = encounterId;
      seenDiceCheckKeyRef.current = key;
      return;
    }
    if (key === seenDiceCheckKeyRef.current) return;
    seenDiceCheckKeyRef.current = key;
    if (!latest) return;
    const gmRoll = !latest.initiated_by_user_id || sameUserId(latest.initiated_by_user_id, campaign?.user_id);
    if (!isGm && gmRoll && latest.audience !== 'public') return;
    maybeShowDice3d(
      dice3dThrowsFromCheckLog(latest, (entry) => (isGm || entry.ally ? entry.name : playerEnemyLabel(entry.name))),
      diceCheckOverlayTitle(latest.dc, checkStatLabel(latest.defaultStat)),
    );
  }, [selectedEncounter?.id, diceRollLog, isGm, campaign?.user_id]);

  function persistDiceState(patch: Partial<DiceRollState>) {
    const encounter = selectedEncounterRef.current;
    if (!encounter) return;
    const current = encounter.meta_data.dice_roll_state ?? diceStateRef.current ?? {};
    persistDiceMeta({ dice_roll_state: { ...current, ...patch } });
  }

  function clearDiceRollLog() {
    const encounter = selectedEncounterRef.current;
    if (!encounter || !isGm || rosterSaving) return;
    diceLogRef.current = [];
    if (campaign && onPatchEncounterDice) {
      onPatchEncounterDice({
        encounterId: encounter.id,
        campaignId: campaign.id,
        dice_roll_log: [],
      });
      return;
    }
    persistRoster(encounter.combatants.list, { dice_roll_log: [] });
  }

  function removeDiceRollLog(entry: DiceRollLog) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || rosterSaving) return;
    if (!isGm && !sameUserId(entry.initiated_by_user_id, sessionUserId)) return;
    const existing = diceLogRef.current.length ? diceLogRef.current : encounter.meta_data.dice_roll_log ?? [];
    persistDiceMeta({
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
      const bonus = choice?.bonus ?? 0;
      const source = choice?.source ?? '';
      const die = rollDie('D20');
      const total = die + bonus;
      results[id] = {
        die,
        bonus,
        source,
        total,
        outcome: degreeOfSuccess(die, total, dc),
      };
    }
    if (Object.keys(results).length === 0) {
      setCheckOpen(false);
      return;
    }
    const rows = isGm ? filterCombatantsBySide(livingActive, state.side ?? 'allies') : playerPartyDiceCombatants(livingActive);
    const existingLog = diceLogRef.current.length ? diceLogRef.current : encounter.meta_data.dice_roll_log ?? [];
    const challenge = isGm ? findAmbaChallenge(readAmbaChallenges(encounter.meta_data), state.challenge_id) : undefined;
    const audience = isGm ? gmDiceAudience(state.audience) : undefined;
    const log = buildDiceRollLog(titleDraft || state.title || '', dc, stat, rows, results, challenge, sessionUserId, audience);
    seenDiceCheckKeyRef.current = diceRollLogKey(log);
    seenDiceCheckEncounterRef.current = encounter.id;
    persistDiceMeta({
      dice_roll_state: {
        ...state,
        results,
        ...(isGm ? { audience, results_audience: audience } : { results_audience: 'public' as const }),
      },
      dice_roll_log: [...existingLog, log],
    });
    maybeShowDice3d(
      rows
        .filter((combatant) => results[combatant._id])
        .map((combatant) => ({ name: isGm || combatant.ally ? combatantDisplayName(combatant) : playerEnemyLabel(combatantDisplayName(combatant)), die: results[combatant._id].die })),
      diceCheckOverlayTitle(dc, checkStatLabel(stat)),
    );
    setCheckOpen(false);
  }

  async function rollSingleAgainst(combatantId: string, preferredStat: string, dc: number, title: string, challenge: AmbaChallengeTable | undefined, x: number, y: number) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || rosterSaving) return;
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
    const state = encounter.meta_data.dice_roll_state ?? diceStateRef.current;
    const audience = isGm ? gmDiceAudience(state?.audience) : undefined;
    const log = buildDiceRollLog(title, dc, resolvedStat, [combatant], { [combatant._id]: result }, challenge, sessionUserId, audience);
    const existingLog = diceLogRef.current.length ? diceLogRef.current : encounter.meta_data.dice_roll_log ?? [];
    seenDiceCheckKeyRef.current = diceRollLogKey(log);
    seenDiceCheckEncounterRef.current = encounter.id;
    persistDiceMeta({ dice_roll_log: [...existingLog, log] });
    maybeShowDice3d(
      [{ name: isGm || combatant.ally ? combatantDisplayName(combatant) : playerEnemyLabel(combatantDisplayName(combatant)), die: result.die }],
      diceCheckOverlayTitle(dc, checkStatLabel(resolvedStat)),
    );
    setCheckToast({ log, x, y });
  }

  async function rollSingleCheck(combatantId: string, preferredStat: string, x: number, y: number) {
    const encounter = selectedEncounterRef.current;
    if (!encounter) return;
    const state = encounter.meta_data.dice_roll_state ?? diceStateRef.current;
    const dc = state?.dc;
    if (dc == null || !Number.isFinite(dc)) return;
    const challenge = isGm ? findAmbaChallenge(readAmbaChallenges(encounter.meta_data), state?.challenge_id) : undefined;
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
        const maxHp = combatant.type === 'HAZARD'
          ? combatant.hazard?.details.defenses?.hp ?? 0
          : populated?.data
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
        const maxHp = combatant.type === 'HAZARD'
          ? combatant.hazard?.details.defenses?.hp ?? 0
          : populated?.data
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
      return sameUserId(owner?.user_id, sessionUserId);
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
    if (isHazardCombatant(combatant)) {
      const maximum = combatant.hazard.details.defenses?.hp;
      if (maximum === undefined) return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      persistRoster((selectedEncounterRef.current?.combatants.list ?? []).map((item) => (
        item._id === combatantId ? updateHazardHp(item, parsed) : item
      )));
      return;
    }
    if (!combatant.data) return;
    const maxHp = statuses.data?.[combatantId]?.maxHp ?? statsFor(combatant.data).maxHp;
    persistHpCurrent(combatant, raw, note, maxHp);
  }

  function persistHazardDisabled(combatantId: string, disabled: boolean) {
    const encounter = selectedEncounterRef.current;
    if (!encounter || rosterSaving) return;
    persistRoster(encounter.combatants.list.map((item) => (
      item._id === combatantId && isHazardCombatant(item)
        ? { ...item, hazard_state: { ...item.hazard_state, disabled } }
        : item
    )));
  }

  function persistCreature(entity: LivingEntity) {
    const encounter = selectedEncounterRef.current;
    if (!selected || !encounter || selected.type !== 'CREATURE') return;
    persistRoster(encounter.combatants.list.map((combatant) => combatant._id === selected._id ? { ...combatant, creature: entity } as Combatant : combatant));
  }

  function persistEntitySpells(entity: LivingEntity) {
    if (!selected || !selectedEncounter) return;
    if (selected.type === 'CHARACTER' && selected.character) {
      onUpdateCharacter(selected.character, { spells: entity.spells, inventory: entity.inventory });
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
    if (!campaign) return;
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
        clearSlot: async (slotId) => {
          if (!selected) return;
          persistEntitySpells(await clearEntitySpellSlot(selected as Phase1EntityCombatant, slotId));
        },
        castStaff: async (entry, cast, option, slotRank) => {
          if (!selected) return;
          persistEntitySpells(await setStaffSpellCast(selected as Phase1EntityCombatant, entry, cast, option, slotRank));
        },
        castWand: async (entry, cast, overcharge) => {
          if (!selected) return;
          persistEntitySpells(await setWandSpellCast(selected as Phase1EntityCombatant, entry, cast, overcharge));
        },
        setItemCharges: async (itemId, current) => {
          if (!selected) return;
          persistEntitySpells(await setStaffCharges(selected as Phase1EntityCombatant, itemId, current));
        },
        addStaffCharges: async (itemId, slotId) => {
          if (!selected) return;
          persistEntitySpells(await addStaffChargesFromSlot(selected as Phase1EntityCombatant, itemId, slotId));
        },
      }
    : undefined;
  useEffect(() => {
    setSelectedId(null);
    setInitiativeOpen(false);
    setCreaturePickerOpen(false);
    setResetOpen(false);
    setCheckOpen(false);
    setEncounterTab(defaultEncounterTab(selectedEncounter));
    setTitleDraft(selectedEncounter?.meta_data.dice_roll_state?.title ?? '');
    setDcDraft(selectedEncounter?.meta_data.dice_roll_state?.dc != null ? String(selectedEncounter.meta_data.dice_roll_state.dc) : '');
  }, [selectedEncounter?.id]);
  useEffect(() => window.localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth)), [detailWidth]);
  useEffect(() => { if (railDrawer) setRailOpen(false); }, [pathname, railDrawer]);
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setRailOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

  const campaignArtUrl = !viewingNotes && !viewingSettings ? campaign?.meta_data?.image_url?.trim() : '';
  const shownCampaignArt = useCampaignArtSrc(campaignArtUrl);
  const artFocus = campaignFocusY(campaign?.meta_data?.image_focus_y);
  useEffect(() => {
    const sync = () => setArtTone(readStoredSheetArtTone());
    window.addEventListener(PHASE1_SHEET_ART_TONE_EVENT, sync);
    return () => window.removeEventListener(PHASE1_SHEET_ART_TONE_EVENT, sync);
  }, []);
  const rail = (
    <CampaignRail campaign={campaign} encounters={encounters} players={benchPlayers} campaignPlayers={players} outCombatants={outCombatants} selectedEncounter={selectedEncounter} selectedId={selectedId} notePages={notePages} selectedNoteIndex={selectedNote?.index ?? null} viewingSettings={viewingSettings} isGm={isGm} rosterSaving={rosterSaving} onRemovePlayer={removePlayer} onAddPlayer={addPlayer} onAddAllPlayers={addAllPlayers} onAddAllPcsToEncounters={campaign && isGm ? onAddAllPcsToEncounters : undefined} onSelectCombatant={setSelectedId} onMarkOut={setCombatantOut} onRequestRemoveFromCampaign={campaign ? (characterId, name) => setPendingCampaignRemove({ id: characterId, name }) : undefined} onDeleteNote={onDeleteNote} onDeleteAllNotes={onDeleteAllNotes} onDeleteEncounter={onDeleteEncounter} onDeleteAllEncounters={onDeleteAllEncounters} onCreateNote={onCreateNote} onCreateEncounter={onCreateEncounter} onRenameNote={renameNote} onRenameEncounter={renameEncounter} />
  );
  const inspector = (
    <Inspector fill={narrow} combatant={selected && (isGm || !isEnemyCreature(selected)) ? selected : null} width={detailWidth} activeTab={normalizeDetailTab(activeTab)} onTab={setActiveTab} onCollapse={narrow ? undefined : () => setInspectorOpen(false)} hasMatchingCampaignNote={Boolean(encounterNote)} status={selected ? statuses.data?.[selected._id] : undefined} statusLoading={statuses.isLoading} canManageSpells={canManageSpells} spellActions={spellActions} onChangeConditions={canManageSpells && selected?.type !== 'HAZARD' ? persistConditions : undefined} onSaveGmNotes={isGm && selected?.type === 'CREATURE' ? persistGmNotes : undefined} onPersistHpCurrent={selected && canManageSpells && selected.data ? (raw, note) => persistHpCurrent(selected, raw, note, statuses.data?.[selected._id]?.maxHp ?? statsFor(selected.data).maxHp) : undefined} onPersistTempHp={selected && canManageSpells && selected.data ? (raw, note) => persistTempHp(selected, raw, note) : undefined} initiativeLog={selectedEncounter?.meta_data.initiative_log ?? []} canEditRoundNotes={isGm && !rosterSaving} onUpdateRoundNote={updateRoundNote} onLogAction={selected && canManageSpells && selected.type !== 'HAZARD' ? persistLogAction : undefined} onDeleteLogEntry={selected && canManageSpells && selected.type !== 'HAZARD' ? persistDeleteLogEntry : undefined} />
  );
  const phoneInspector = narrow && selectedId && !viewingNotes && !viewingSettings;
  const showDetail = !narrow && !viewingNotes && !viewingSettings;
  const detailOpen = showDetail && inspectorOpen;
  const dockedRail = !railDrawer && railOpen;
  const encounterGrid = dockedRail && detailOpen
    ? 'grid-cols-[248px_minmax(280px,1fr)_6px_auto]'
    : dockedRail && showDetail
      ? 'grid-cols-[248px_minmax(280px,1fr)_2.5rem]'
      : dockedRail
        ? 'grid-cols-[248px_minmax(280px,1fr)]'
        : detailOpen
          ? 'grid-cols-[minmax(280px,1fr)_6px_auto]'
          : showDetail
            ? 'grid-cols-[minmax(280px,1fr)_2.5rem]'
            : 'grid-cols-1';

  return (
    <div className={`relative flex h-dvh min-h-0 flex-col overflow-hidden bg-p1-page text-p1-text md:h-screen md:min-h-[680px]${campaignArtUrl && !artHidden ? ` p1-encounter-has-art p1-sheet-art-${artTone}` : ''}`}>
      <WorkspaceHeader section={standalone ? 'encounters' : undefined} label={campaign?.name ?? encounterDisplayName(selectedEncounter?.name ?? 'Encounter')} campaignId={campaign?.id ?? null} encounterId={selectedEncounter?.id ?? null} noteIndex={selectedNote?.index ?? null} viewingSettings={viewingSettings} railOpen={railOpen} onToggleRail={() => setRailOpen((open) => !open)} />
      <div className={`p1-encounter-body grid min-h-0 flex-1 ${encounterGrid}`}>
        {railDrawer ? railOpen && createPortal(
          <>
            <button type='button' className='fixed inset-0 z-40 bg-black/50' aria-label='Close navigation' onClick={() => setRailOpen(false)} />
            <div id='campaign-rail' className='fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col shadow-2xl'>{rail}</div>
          </>,
          document.body,
        ) : railOpen && <div id='campaign-rail' className='min-h-0'>{rail}</div>}
        <main className='p1-encounter-main relative min-h-0 min-w-0 overflow-hidden bg-p1-surface'>
          {campaignArtUrl && !artHidden && (
            <div className='p1-encounter-art-layer' style={{ backgroundImage: `url(${shownCampaignArt})`, backgroundPosition: `center ${artFocus}%` }} aria-hidden>
              <div className='p1-sheet-art-veil' />
            </div>
          )}
          <div className={`relative z-[1] h-full ${viewingNotes ? 'overflow-hidden' : 'overflow-auto'}`}>
          {viewingSettings && campaign ? (
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
            <NoteSurface campaign={campaign} note={selectedNote} isGm={isGm} encounterLink={noteEncounter ? { href: phase1EncounterPath(noteEncounter.id, campaign?.id), name: noteEncounter.name } : undefined} onUpdateCampaign={onUpdateCampaign} />
          ) : (
            <>
              <EncounterHeader encounter={selectedEncounter} combatants={activeCombatants} count={activeCombatants.length} isGm={isGm} campaignId={campaign?.id ?? null} noteLink={!standalone && encounterNote && campaign ? { href: `/phase1/campaign/${campaign.id}/notes/${encounterNote.index}`, name: encounterNote.page.name } : undefined} tab={encounterTab} onTab={setEncounterTab} canAddCreature={isGm && !rosterSaving} onAddCreature={() => setCreaturePickerOpen(true)} showAddHazard={campaign?.meta_data?.settings?.show_hazards_button === true} canAddHazard={isGm && !rosterSaving} onAddHazard={() => setHazardPickerOpen(true)} canRollInitiative={isGm && activeCombatants.length > 0} onRollInitiative={() => setInitiativeOpen(true)} canClearInitiative={isGm && activeCombatants.some((combatant) => combatant.initiative != null)} onClearInitiative={clearInitiative} canMaxStats={isGm && combatants.length > 0 && !rosterSaving} onMaxStats={maxEncounterStats} canReset={isGm && Boolean(selectedEncounter) && !rosterSaving} onReset={() => setResetOpen(true)} onOpenStatBlocks={() => setStatBlocksOpen(true)} onCreateEncounter={isGm ? onCreateEncounter : undefined} />
              {selectedEncounter && rosterError && <div className='border-b border-p1-danger/40 bg-p1-danger/10 px-5 py-2 text-xs text-p1-danger-soft'>Roster update failed: {rosterError.message}</div>}
              {selectedEncounter && encounterTab === 'dice' && (
                <DiceRollToolbar
                  isGm={isGm}
                  side={diceSide}
                  title={titleDraft}
                  dc={dcDraft}
                  stat={diceStat ?? ''}
                  challenges={ambaChallenges}
                  challengeId={diceState?.challenge_id ?? ''}
                  canEdit={canEditDice}
                  canRoll={canRollCheck}
                  canClear={canEditDice && (isGm
                    ? Object.keys(diceState?.results ?? {}).length > 0
                    : Boolean(titleDraft || dcDraft || diceStat || Object.keys(diceState?.results ?? {}).length > 0))}
                  audience={isGm ? gmDiceAudience(diceState?.audience) : undefined}
                  onAudience={(audience) => persistDiceState({ audience })}
                  onSide={(side) => persistDiceState({ side, results: {} })}
                  onTitle={setTitleDraft}
                  onTitleCommit={(title) => persistDiceState(isGm ? { title, challenge_id: undefined } : { title })}
                  onDc={setDcDraft}
                  onDcCommit={(dc) => persistDiceState(isGm ? { dc, results: {}, challenge_id: undefined } : { dc, results: {} })}
                  onStat={(stat) => persistDiceState(isGm ? { stat: stat || null, results: {}, challenge_id: undefined } : { stat: stat || null, results: {} })}
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
                  onClear={() => {
                    if (isGm) {
                      persistDiceState({ results: {} });
                      return;
                    }
                    setTitleDraft('');
                    setDcDraft('');
                    persistDiceState({ title: '', dc: null, stat: null, results: {} });
                  }}
                />
              )}
              {selectedEncounter && encounterTab === 'dice' && <DiceRollColorKey />}
              {selectedEncounter && <div className='p-5'>
                {encounterTab === 'combat' ? (
                  <>
                    <CombatantGrid combatants={orderedCombatants} encounterId={selectedEncounter?.id ?? null} initiativeRollNonce={initiativeRollNonce} selectedId={selectedId} onSelect={setSelectedId} statuses={statuses.data} calculating={statuses.isLoading} canManageRoster={isGm && !rosterSaving} canManageCombatant={canManageCombatant} onAddPlayer={addPlayer} onRemovePlayer={removePlayer} onCloneCreature={cloneCreature} onDeleteCreature={deleteCreature} onRestoreCombatant={(id) => setCombatantOut(id, undefined)} onMarkOut={setCombatantOut} onRequestRemoveFromCampaign={campaign ? (characterId, name) => setPendingCampaignRemove({ id: characterId, name }) : undefined} onUpdateInitiative={updateInitiative} onUpdateHp={persistHpCurrentById} onToggleHazardDisabled={persistHazardDisabled} playerView={!isGm} />
                    <InitiativeRoundLogPanel log={isGm ? (selectedEncounter?.meta_data.initiative_log ?? []) : playerAllyRoundLog(selectedEncounter?.meta_data.initiative_log ?? [])} canEdit={isGm && !rosterSaving} canClear={isGm && !rosterSaving} onClear={clearInitiativeLog} onUpdateNote={updateRoundNote} />
                  </>
                ) : (
                  <>
                    <CombatantGrid combatants={diceGridRows} encounterId={selectedEncounter?.id ?? null} initiativeRollNonce={0} selectedId={selectedId} onSelect={setSelectedId} statuses={statuses.data} calculating={statuses.isLoading} canManageRoster={isGm && !rosterSaving} canManageCombatant={canManageCombatant} onAddPlayer={addPlayer} onRemovePlayer={removePlayer} onCloneCreature={cloneCreature} onDeleteCreature={deleteCreature} onRestoreCombatant={(id) => setCombatantOut(id, undefined)} onMarkOut={setCombatantOut} onRequestRemoveFromCampaign={campaign ? (characterId, name) => setPendingCampaignRemove({ id: characterId, name }) : undefined} onUpdateInitiative={updateInitiative} onUpdateHp={persistHpCurrentById} onSingleCheck={!rosterSaving ? rollSingleCheck : undefined} onSingleChallenge={isGm && !rosterSaving && ambaChallenges.length > 0 ? rollSingleChallenge : undefined} challenges={ambaChallenges} dice={{ challengeId: isGm ? diceState?.challenge_id : undefined, checkStat: diceStat ?? undefined, columnLabel: checkStatLabel(diceStat ?? undefined), dc: diceDc, results: !isGm && diceState?.results_audience === 'private' ? {} : diceState?.results ?? {}, emptyMessage: livingActive.length === 0 ? 'No combatants in this encounter yet. Add a creature or a party member from the bench.' : diceGridRows.length === 0 ? 'No combatants match this side. Switch Allies, Enemies, or Both above.' : 'Right-click a combatant to roll a check. Group rolls still use the toolbar.' }} playerView={!isGm} />
                    <DiceRollLogPanel log={isGm ? (selectedEncounter?.meta_data.dice_roll_log ?? []) : playerAllyRoundLog(playerVisibleDiceRollLog(selectedEncounter?.meta_data.dice_roll_log ?? []))} canClear={isGm && !rosterSaving} canEdit={isGm && !rosterSaving} canRemoveEntry={(entry) => isGm || sameUserId(entry.initiated_by_user_id, sessionUserId)} onClear={clearDiceRollLog} onRemove={removeDiceRollLog} onUpdateNote={updateDiceRollNote} />
                  </>
                )}
              </div>}
              {initiativeOpen && selectedEncounter && (
                <InitiativeRollModal
                  combatants={activeCombatants.filter((combatant) => !isHazardCombatant(combatant) || getHazardInitiativeModifier(combatant.hazard) !== undefined)}
                  onConfirm={rollInitiative}
                  onClose={() => setInitiativeOpen(false)}
                />
              )}
              {checkToast && (
                <DiceCheckResultToast log={checkToast.log} x={checkToast.x} y={checkToast.y} onClose={() => setCheckToast(null)} />
              )}
              {dice3dThrows && (
                <Dice3dOverlay throws={dice3dThrows.throws} title={dice3dThrows.title} onClose={() => setDice3dThrows(null)} />
              )}
              {checkOpen && selectedEncounter && diceStat && diceDc != null && (
                <DiceCheckRollModal
                  combatants={diceRows}
                  defaultStat={diceStat ?? ''}
                  title={titleDraft || diceState?.title || ''}
                  dc={diceDc}
                  onConfirm={rollGroupCheck}
                  onClose={() => setCheckOpen(false)}
                />
              )}
              {creaturePickerOpen && (
                <SelectCreatureModal
                  busy={rosterSaving}
                  sourceIds={null}
                  onSelect={addCreature}
                  onClose={() => setCreaturePickerOpen(false)}
                />
              )}
              {hazardPickerOpen && (
                <SelectHazardModal
                  busy={rosterSaving}
                  sourceIds={campaign ? (campaign.recommended_content_sources?.enabled ?? []) : null}
                  onSelect={addHazard}
                  onClose={() => setHazardPickerOpen(false)}
                />
              )}
              {statBlocksOpen && (
                <Phase1PcStatBlocksModal
                  characters={activeCombatants.filter((combatant) => combatant.type === 'CHARACTER').map((combatant) => combatant.data as Character)}
                  onClose={() => setStatBlocksOpen(false)}
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
              {pendingCampaignRemove && (
                <ConfirmDialog
                  title={`Remove "${pendingCampaignRemove.name}" from campaign`}
                  message={`${pendingCampaignRemove.name} will leave this campaign and be taken out of every encounter. Their character sheet stays. This cannot be undone from here.`}
                  confirmLabel='Remove from campaign'
                  onCancel={() => setPendingCampaignRemove(null)}
                  onConfirm={async () => {
                    const target = pendingCampaignRemove;
                    setPendingCampaignRemove(null);
                    await removeCharacterFromCampaign(target.id);
                  }}
                />
              )}
            </>
          )}
          </div>
        </main>
        {detailOpen && (
          <>
            <ResizeRail onResize={(delta) => setDetailWidth((width) => clamp(width - delta, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX))} />
            {inspector}
          </>
        )}
        {showDetail && !inspectorOpen && (
          <button type='button' className='flex items-start justify-center border-l border-p1-border bg-p1-inset pt-3 text-p1-muted hover:text-p1-text' title='Show combatant details' aria-label='Show combatant details' onClick={() => setInspectorOpen(true)}>
            <PanelRight size={16} />
          </button>
        )}
      </div>
      {phoneInspector && (
        <div className='fixed inset-0 z-30 flex min-h-0 flex-col bg-p1-inset'>
          <button type='button' className='flex shrink-0 items-center gap-2 border-b border-p1-border px-3 py-3 text-sm text-p1-muted hover:text-p1-text' onClick={() => setSelectedId(null)}>
            <ArrowLeft size={16} /> Back to encounter
          </button>
          <div className='min-h-0 flex-1'>{inspector}</div>
        </div>
      )}
      {campaignArtUrl && (
        <Phase1ArtworkOverlay
          url={shownCampaignArt}
          label={campaign?.name ?? 'Campaign art'}
          canEdit={isGm}
          artTone={artTone}
          onArtTone={(tone) => {
            setArtTone(tone);
            persistSheetArtTone(tone);
          }}
          onPreview={() => setArtPreview(true)}
          onSelect={() => setArtRequest((current) => current + 1)}
          onClear={() => {
            if (!campaign) return;
            setConfirmClearArt(true);
          }}
          artHidden={artHidden}
          onToggleArt={() => {
            if (!artHiddenKey) return;
            const next = !artHidden;
            setArtHidden(next);
            window.localStorage.setItem(artHiddenKey, next ? '1' : '0');
          }}
        />
      )}
      {confirmClearArt && campaign && campaignArtUrl && (
        <ConfirmDialog
          title='Remove campaign art'
          message={`Remove the artwork from "${campaign.name}"?`}
          confirmLabel='Remove art'
          onCancel={() => setConfirmClearArt(false)}
          onConfirm={() => {
            setConfirmClearArt(false);
            onUpdateCampaign({ ...campaign, meta_data: { ...campaign.meta_data, image_url: undefined } });
          }}
        />
      )}
      {artPreview && campaignArtUrl && (
        <Phase1ArtworkPreview
          option={{ name: campaign?.name ?? 'Campaign art', url: shownCampaignArt }}
          onBack={() => setArtPreview(false)}
        />
      )}
      {artBand && campaign && campaignArtUrl && (
        <CampaignStripDialog
          url={shownCampaignArt}
          initial={artFocus}
          busy={campaignSaving}
          onCancel={() => setArtBand(false)}
          onConfirm={(focusY) => {
            onUpdateCampaign({ ...campaign, meta_data: { ...campaign.meta_data, image_focus_y: focusY } });
            setArtBand(false);
          }}
        />
      )}
      {campaign && isGm && (
        <div className='pointer-events-none fixed bottom-3 right-14 z-30 opacity-0'>
          <CampaignArtControl
            campaign={campaign}
            requestOpen={artRequest}
            onSaved={() => undefined}
            onUploaded={(url) => onUpdateCampaign({ ...campaign, meta_data: { ...campaign.meta_data, image_url: url } })}
            onFrame={() => setArtBand(true)}
            onFrameError={() => undefined}
          />
        </div>
      )}
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

function stampCreatureDefenses<T extends LivingEntity>(entity: T, status: Phase1CreatureStatus): T {
  const stats = entity.meta_data?.calculated_stats;
  const prof = (total: number, current?: { total: number }) => ({ ...current, total });
  return {
    ...entity,
    meta_data: {
      ...entity.meta_data,
      calculated_stats: {
        ...stats,
        hp_max: status.maxHp > 0 ? status.maxHp : stats?.hp_max,
        ac: status.ac,
        profs: {
          ...stats?.profs,
          SAVE_FORT: prof(status.fortitude, stats?.profs?.SAVE_FORT),
          SAVE_REFLEX: prof(status.reflex, stats?.profs?.SAVE_REFLEX),
          SAVE_WILL: prof(status.will, stats?.profs?.SAVE_WILL),
          PERCEPTION: prof(status.perception, stats?.profs?.PERCEPTION),
        },
      },
    },
  };
}

function useCombatantStatuses(encounterId: number | null, combatants: PopulatedCombatant[]) {
  const signature = combatants.map((combatant) => (
    isHazardCombatant(combatant)
      ? `${combatant._id}:hazard:${combatant.hazard_state?.hp_current ?? ''}:${combatant.hazard_state?.disabled ?? false}`
      : `${combatant._id}:${combatant.data?.hp_current}:${combatant.data?.hp_temp}:${JSON.stringify(combatant.data?.details?.conditions ?? [])}`
  )).join('|');
  return useQuery({
    queryKey: ['phase1-encounter-statuses', 'isolated-store', 'keep-encounter-ops', encounterId, signature],
    enabled: encounterId !== null && combatants.length > 0,
    queryFn: async () => {
      const result: CombatantStatusMap = {};
      for (const combatant of combatants) {
        if (isHazardCombatant(combatant) || combatant.access?.details_revealed === false || !hasFullEntityDetails(combatant) || !combatant.data) continue;
        try {
          result[combatant._id] = await calculateEntityStatus(combatant as Phase1EntityCombatant);
        } catch {
          const stored = statsFor(combatant.data);
          result[combatant._id] = stored.defensesKnown ? fallbackStatus(combatant.data) : null;
        }
      }
      return result;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
export function WorkspaceHeader({ label, section, campaignId, encounterId, noteIndex, viewingSettings, railOpen, onToggleRail }: { label?: string; section?: 'campaigns' | 'characters' | 'encounters'; campaignId?: number | null; encounterId?: number | null; noteIndex?: number | null; viewingSettings?: boolean; railOpen?: boolean; onToggleRail?: () => void }) {
  const navClass = (active: boolean) => `text-sm ${active ? 'text-p1-text' : 'text-p1-muted hover:text-p1-text'}`;
  const user = useQuery({
    queryKey: ['phase1-public-user'],
    queryFn: () => getPublicUser(),
    staleTime: 60_000,
  });
  const patreonTier = user.data?.patreon?.tier ?? null;
  return (
    <header className='flex w-full min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-p1-border bg-p1-header px-3 py-2 md:h-14 md:flex-nowrap md:gap-4 md:px-5 md:py-0'>
      <div className='flex shrink-0 items-center gap-2'>
        {onToggleRail && (
          <button type='button' className='icon-button' title={railOpen ? 'Hide campaign sidebar' : 'Show campaign sidebar'} aria-expanded={Boolean(railOpen)} aria-controls='campaign-rail' aria-label={railOpen ? 'Hide campaign sidebar' : 'Show campaign sidebar'} onClick={onToggleRail}>
            <Menu size={16} />
          </button>
        )}
        <a href='/' className='whitespace-nowrap font-semibold'>Wanderer's Guide</a>
      </div>
      <span className='hidden h-4 w-px bg-p1-border sm:block' />
      <Link to='/phase1' className={navClass(section === 'campaigns')}>Campaigns</Link>
      <Link to='/phase1/characters' className={navClass(section === 'characters')}>Characters</Link>
      <Link to='/phase1/encounters' className={navClass(section === 'encounters')}>Encounters</Link>
      <a href='/shops' className={navClass(false)}>Shops</a>
      {label && <><span className='text-p1-faint'>/</span><span className='max-w-40 truncate text-sm text-p1-muted'>{label}</span></>}
      <div className='flex w-full min-w-0 flex-wrap items-center gap-2 md:ml-auto md:w-auto'>
        <span className='hidden text-[11px] uppercase tracking-[0.14em] text-p1-faint sm:inline' title='patreon.tier from get-user'>
          {user.isPending ? 'Patreon…' : patreonTier ?? 'no Patreon tier'}
        </span>
        <Phase1ThemeToggle />
        <Phase1CssThemeToggle />
        <PhaseViewSwitch current='phase1' section={section} campaignId={campaignId} encounterId={encounterId} noteIndex={noteIndex} viewingSettings={viewingSettings} />
        <Link to='/phase1/account' className='icon-button' title='Account'><User size={15} /></Link>
        <button className='icon-button' title='Switch account' onClick={() => void signOut()}><LogOut size={15} /></button>
      </div>
    </header>
  );
}

function CampaignRail({ campaign, encounters, players, campaignPlayers, outCombatants, selectedEncounter, selectedId, notePages, selectedNoteIndex, viewingSettings, isGm, rosterSaving, onRemovePlayer, onAddPlayer, onAddAllPlayers, onAddAllPcsToEncounters, onSelectCombatant, onMarkOut, onRequestRemoveFromCampaign, onDeleteNote, onDeleteAllNotes, onDeleteEncounter, onDeleteAllEncounters, onCreateNote, onCreateEncounter, onRenameNote, onRenameEncounter }: {
  campaign: Campaign | null; encounters: Encounter[]; players: Character[]; campaignPlayers: Character[]; outCombatants: PopulatedCombatant[]; selectedEncounter: Encounter | null; selectedId: string | null; notePages: IndexedNotePage[]; selectedNoteIndex: number | null; viewingSettings: boolean; isGm: boolean; rosterSaving: boolean; onRemovePlayer: (combatantId: string) => void; onAddPlayer: (characterId: number) => void; onAddAllPlayers: () => void; onAddAllPcsToEncounters?: () => Promise<void> | void; onSelectCombatant: (id: string) => void; onMarkOut: (combatantId: string, out: Combatant['out']) => void; onRequestRemoveFromCampaign?: (characterId: number, name: string) => void; onDeleteNote: (index: number) => void; onDeleteAllNotes?: () => void; onDeleteEncounter: (id: number) => void; onDeleteAllEncounters?: () => Promise<void> | void; onCreateNote: (name: string) => void; onCreateEncounter: (name: string) => void; onRenameNote: (index: number, name: string) => void; onRenameEncounter: (id: number, name: string) => void;
}) {
  const standalone = campaign == null;
  const [benchActive, setBenchActive] = useState(false);
  const [outActive, setOutActive] = useState(false);
  const [notesOpen, setNotesOpen] = useState(selectedNoteIndex != null);
  const [encountersOpen, setEncountersOpen] = useState(false);
  useEffect(() => {
    setEncountersOpen(false);
  }, [selectedEncounter?.id]);
  const [menu, setMenu] = useState<RailContextTarget | null>(null);
  const [sectionMenu, setSectionMenu] = useState<{ kind: 'note' | 'encounter'; x: number; y: number } | null>(null);
  const [createKind, setCreateKind] = useState<'note' | 'encounter' | null>(null);
  const [benchMenu, setBenchMenu] = useState<{ x: number; y: number; characterId?: number; name?: string } | null>(null);
  const [outMenu, setOutMenu] = useState<{ id: string; x: number; y: number; characterId?: number; name?: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RailContextTarget | null>(null);
  const [pendingRename, setPendingRename] = useState<RailContextTarget | null>(null);
  const [pendingAddAllPcs, setPendingAddAllPcs] = useState(false);
  const [pendingDeleteAll, setPendingDeleteAll] = useState<'note' | 'encounter' | null>(null);
  const canManageRoster = isGm && !rosterSaving && Boolean(selectedEncounter);

  function openSectionMenu(event: ReactMouseEvent, kind: 'note' | 'encounter') {
    if (!isGm) return;
    if (kind === 'note' && standalone) return;
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

  function openBenchMenu(event: ReactMouseEvent, characterId?: number, name?: string) {
    if (!isGm || rosterSaving) return;
    event.preventDefault();
    event.stopPropagation();
    setBenchMenu({ x: event.clientX, y: event.clientY, characterId, name });
  }

  return (
    <aside className='h-full min-h-0 overflow-y-auto border-r border-p1-border bg-p1-header'>
      <div className='border-b border-p1-border p-4'>
        <Link to={standalone ? '/phase1/encounters' : '/phase1'} className='mb-5 flex items-center gap-2 text-xs text-p1-muted hover:text-p1-text'><ArrowLeft size={14} /> {standalone ? 'Encounters' : 'Campaigns'}</Link>
        {standalone ? (
          <>
            <Eyebrow>Standalone</Eyebrow>
            <h1 className='mt-2 text-lg font-semibold leading-tight'>Encounters</h1>
          </>
        ) : campaign ? (
          <>
            <Eyebrow>{isGm ? 'Game master' : 'Player'}</Eyebrow><h1 className='mt-2 text-lg font-semibold leading-tight'>{campaign.name}</h1>
          </>
        ) : null}
      </div>
      {!standalone && isGm && campaign && (
        <>
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
        </>
      )}
      <RailLabel icon={<Swords size={14} />} label='Encounters' count={encounters.length} open={encountersOpen} onToggle={() => setEncountersOpen((value) => !value)} onContextMenu={(event) => openSectionMenu(event, 'encounter')} />
      {encountersOpen && (
        <nav className='px-2 pb-4' onContextMenu={(event) => openSectionMenu(event, 'encounter')}>
          {encounters.map((encounter) => (
            <Link
              key={encounter.id}
              to={phase1EncounterPath(encounter.id, campaign?.id)}
              onContextMenu={(event) => openRailMenu(event, { kind: 'encounter', id: encounter.id, name: encounterDisplayName(encounter.name) })}
              className={`mb-1 block border-l-2 px-3 py-2.5 text-sm ${selectedEncounter?.id === encounter.id ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
            >
              <span className='block truncate'>{encounterDisplayName(encounter.name)}</span>
              {isGm && <span className='mt-0.5 block text-[11px] text-p1-faint'>{encounter.combatants.list.length} combatants</span>}
            </Link>
          ))}
          {encounters.length === 0 && <p className='px-3 py-4 text-xs leading-5 text-p1-faint'>{standalone ? 'No standalone encounters yet.' : isGm ? 'No encounters in this campaign yet.' : 'None of your characters are in an encounter yet.'}</p>}
        </nav>
      )}
      {!standalone && isGm && campaign && (
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
      {!standalone && campaign && (
        <>
          <RailLabel icon={<UsersRound size={14} />} label='Party bench' count={players.length} onContextMenu={openBenchMenu} />
          <div className={`mx-2 min-h-16 border px-1 pb-4 pt-1 transition-colors ${benchActive ? 'border-p1-accent bg-p1-accent/[0.07]' : 'border-transparent'}`} onContextMenu={openBenchMenu} onDragOver={(event) => { if (canManageRoster && hasCombatantDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setBenchActive(true); } }} onDragLeave={() => setBenchActive(false)} onDrop={dropOnBench}>
            {players.map((player) => (
              <div
                key={player.id}
                className='flex items-center gap-2 px-2 py-2 text-sm text-p1-muted hover:bg-p1-hover hover:text-p1-text'
                onContextMenu={(event) => openBenchMenu(event, player.id, player.name)}
                draggable={canManageRoster}
                onDragStart={(event) => writeCombatantDrag(event, { source: 'bench', characterId: player.id })}
                onDragEnd={() => { clearCombatantDrag(); setBenchActive(false); }}
              >
                {canManageRoster && (
                  <span
                    className='shrink-0 cursor-grab text-p1-faint'
                    title='Drag to encounter'
                    aria-hidden
                  >
                    <GripVertical size={14} />
                  </span>
                )}
                <a href={`/sheet/${player.id}`} target='_blank' rel='noreferrer' draggable={false} className='flex min-w-0 flex-1 items-center gap-2 hover:text-p1-text'>
                  <UserRound size={15} />
                  <span className='min-w-0 flex-1 truncate'>{player.name}</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            ))}
            {players.length === 0 && <p className='px-2 py-3 text-xs text-p1-faint'>No PCs on the bench.</p>}
          </div>
        </>
      )}
      {(selectedEncounter || (!standalone && campaign)) && (
        <>
          <RailLabel icon={<Skull size={14} />} label='Dead / Incapacitated' count={outCombatants.length} />
          <div className={`mx-2 min-h-16 border px-1 pb-4 pt-1 transition-colors ${outActive ? 'border-p1-accent bg-p1-accent/[0.07]' : 'border-transparent'}`} onDragOver={(event) => { if (canManageRoster && hasCombatantDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOutActive(true); } }} onDragLeave={() => setOutActive(false)} onDrop={dropOnOut}>
            {outCombatants.map((combatant) => (
              <div
                key={combatant._id}
                className={`flex w-full items-center gap-2 px-2 py-2 text-sm hover:bg-p1-hover ${combatant._id === selectedId ? 'bg-p1-hover text-p1-text' : 'text-p1-muted hover:text-p1-text'}`}
                onContextMenu={(event) => {
                  if (!isGm || rosterSaving) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setOutMenu({
                    id: combatant._id,
                    x: event.clientX,
                    y: event.clientY,
                    characterId: combatant.type === 'CHARACTER' ? combatant.character : undefined,
                    name: combatantDisplayName(combatant),
                  });
                }}
              >
                {canManageRoster && (
                  <span
                    draggable
                    onDragStart={(event) => writeCombatantDrag(event, { source: 'out', combatantId: combatant._id, characterId: combatant.character })}
                    onDragEnd={() => { clearCombatantDrag(); setOutActive(false); }}
                    className='shrink-0 cursor-grab text-p1-faint'
                    title='Drag back to encounter'
                    aria-label={`Drag ${combatantDisplayName(combatant)} back to encounter`}
                  >
                    <GripVertical size={14} />
                  </span>
                )}
                <button
                  type='button'
                  onClick={() => { if (isGm || !isEnemyCreature(combatant)) onSelectCombatant(combatant._id); }}
                  className='flex min-w-0 flex-1 items-center gap-2 text-left'
                >
                  <Skull size={15} className='shrink-0' />
                  <span className='min-w-0 flex-1 truncate'>{!isGm && isEnemyCreature(combatant) ? playerEnemyLabel(combatantDisplayName(combatant)) : combatantDisplayName(combatant)}</span>
                  <span className='shrink-0 text-[10px] uppercase text-p1-faint'>{combatant.out === 'dead' ? 'Dead' : 'Incap.'}</span>
                </button>
              </div>
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
          onDeleteAll={menu.kind === 'note'
            ? (onDeleteAllNotes && notePages.length > 0 ? () => { setMenu(null); setPendingDeleteAll('note'); } : undefined)
            : (onDeleteAllEncounters && encounters.length > 0 ? () => { setMenu(null); setPendingDeleteAll('encounter'); } : undefined)}
        />
      )}
      {sectionMenu && (
        <SectionContextMenu
          x={sectionMenu.x}
          y={sectionMenu.y}
          addAllPcsDisabled={rosterSaving || campaignPlayers.length === 0 || encounters.length === 0}
          deleteAllDisabled={sectionMenu.kind === 'note' ? notePages.length === 0 : encounters.length === 0}
          onClose={() => setSectionMenu(null)}
          onNew={() => {
            const kind = sectionMenu.kind;
            setSectionMenu(null);
            if (kind === 'note') setNotesOpen(true);
            else setEncountersOpen(true);
            setCreateKind(kind);
          }}
          onAddAllPcs={sectionMenu.kind === 'encounter' && onAddAllPcsToEncounters ? () => {
            setSectionMenu(null);
            setPendingAddAllPcs(true);
          } : undefined}
          onDeleteAll={(sectionMenu.kind === 'note' ? onDeleteAllNotes : onDeleteAllEncounters) ? () => {
            const kind = sectionMenu.kind;
            setSectionMenu(null);
            setPendingDeleteAll(kind);
          } : undefined}
        />
      )}
      {createKind && (
        <CreateNameModal
          title={createKind === 'note' ? 'New note' : 'New encounter'}
          label={createKind === 'note' ? 'Note name' : 'Encounter name'}
          confirmLabel='Create'
          skipLabel={createKind === 'encounter' ? 'Skip' : undefined}
          onCancel={() => setCreateKind(null)}
          onSkip={createKind === 'encounter' ? () => {
            onCreateEncounter(nextEncounterName(encounters.map((item) => item.name)));
            setCreateKind(null);
          } : undefined}
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
          showAdd={benchMenu.characterId != null}
          addDisabled={!selectedEncounter}
          addAllDisabled={players.length === 0 || !selectedEncounter}
          showRemoveFromCampaign={benchMenu.characterId != null && Boolean(onRequestRemoveFromCampaign)}
          onClose={() => setBenchMenu(null)}
          onAdd={() => {
            const characterId = benchMenu.characterId;
            setBenchMenu(null);
            if (characterId != null) onAddPlayer(characterId);
          }}
          onAddAll={() => {
            setBenchMenu(null);
            onAddAllPlayers();
          }}
          onRemoveFromCampaign={() => {
            const characterId = benchMenu.characterId;
            const name = benchMenu.name;
            setBenchMenu(null);
            if (characterId != null && name) onRequestRemoveFromCampaign?.(characterId, name);
          }}
        />
      )}
      {outMenu && (
        <OutContextMenu
          x={outMenu.x}
          y={outMenu.y}
          showRemoveFromCampaign={outMenu.characterId != null && Boolean(onRequestRemoveFromCampaign)}
          onClose={() => setOutMenu(null)}
          onReturn={() => {
            setOutMenu(null);
            onMarkOut(outMenu.id, undefined);
          }}
          onRemoveFromCampaign={() => {
            const characterId = outMenu.characterId;
            const name = outMenu.name;
            setOutMenu(null);
            if (characterId != null && name) onRequestRemoveFromCampaign?.(characterId, name);
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
      {pendingDeleteAll && (
        <ConfirmDialog
          title={pendingDeleteAll === 'note' ? 'Delete all notes' : 'Delete all encounters'}
          message={pendingDeleteAll === 'note'
            ? `Delete all ${notePages.length} notes? This cannot be undone.`
            : `Delete all ${encounters.length} encounters? This cannot be undone.`}
          confirmLabel='Delete all'
          onCancel={() => setPendingDeleteAll(null)}
          onConfirm={() => {
            const kind = pendingDeleteAll;
            setPendingDeleteAll(null);
            if (kind === 'note') onDeleteAllNotes?.();
            else void onDeleteAllEncounters?.();
          }}
        />
      )}
      {pendingAddAllPcs && (
        <ConfirmDialog
          title='Add all PCs'
          message={`Add all ${campaignPlayers.length} PCs to all ${encounters.length} encounters? Anyone already in an encounter stays as they are.`}
          confirmLabel='Add'
          onCancel={() => setPendingAddAllPcs(false)}
          onConfirm={() => {
            setPendingAddAllPcs(false);
            void onAddAllPcsToEncounters?.();
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

function PlayerContextMenu({ x, y, onClose, onRemove, onRemoveFromCampaign, onIncapacitate, onMarkDead }: { x: number; y: number; onClose: () => void; onRemove: () => void; onRemoveFromCampaign?: () => void; onIncapacitate: () => void; onMarkDead: () => void }) {
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
        {onRemoveFromCampaign && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onRemoveFromCampaign}>
            <UserMinus size={14} /> Remove from campaign
          </button>
        )}
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

function DiceCombatantContextMenu({ x, y, combatant, canCheck, challenges, canChallenge, selectedChallengeId, selectedStat, onClose, onCheck, onChallenge, onRemoveFromCampaign }: {
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
  onRemoveFromCampaign?: () => void;
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
        {canChallenge && (
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
        )}
        {onRemoveFromCampaign && (
          <button
            type='button'
            role='menuitem'
            className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover'
            onMouseEnter={() => { setOpenMenu(null); setOpenGroup(null); setOpenChallengeKey(null); setHoverTip(null); }}
            onClick={onRemoveFromCampaign}
          >
            <UserMinus size={14} /> Remove from campaign
          </button>
        )}
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

function CombatantContextMenu({ x, y, onClose, onClone, onIncapacitate, onMarkDead, onDelete }: { x: number; y: number; onClose: () => void; onClone?: () => void; onIncapacitate?: () => void; onMarkDead?: () => void; onDelete: () => void }) {
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
        {onClone && (
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onClone}>
          <Copy size={14} /> Clone
        </button>
        )}
        {onIncapacitate && (
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onIncapacitate}>
          <Skull size={14} /> Move to incapacitated
        </button>
        )}
        {onMarkDead && (
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onMarkDead}>
          <Skull size={14} /> Mark dead
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

function OutContextMenu({ x, y, showRemoveFromCampaign, onClose, onReturn, onRemoveFromCampaign }: { x: number; y: number; showRemoveFromCampaign?: boolean; onClose: () => void; onReturn: () => void; onRemoveFromCampaign?: () => void }) {
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
        {showRemoveFromCampaign && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onRemoveFromCampaign}>
            <UserMinus size={14} /> Remove from campaign
          </button>
        )}
      </div>
    </>,
    document.body
  );
}

function BenchContextMenu({ x, y, showAdd, addDisabled, addAllDisabled, showRemoveFromCampaign, onClose, onAdd, onAddAll, onRemoveFromCampaign }: { x: number; y: number; showAdd: boolean; addDisabled?: boolean; addAllDisabled: boolean; showRemoveFromCampaign?: boolean; onClose: () => void; onAdd: () => void; onAddAll: () => void; onRemoveFromCampaign?: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - (showAdd ? 88 : 56));
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        {showAdd && (
          <button type='button' role='menuitem' disabled={addDisabled} title={addDisabled ? 'Select an encounter first' : undefined} className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint disabled:hover:bg-transparent' onClick={onAdd}>
            <Plus size={14} /> Add to combat
          </button>
        )}
        <button type='button' role='menuitem' disabled={addAllDisabled} className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint disabled:hover:bg-transparent' onClick={onAddAll}>
          <Plus size={14} /> Add all
        </button>
        {showRemoveFromCampaign && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onRemoveFromCampaign}>
            <UserMinus size={14} /> Remove from campaign
          </button>
        )}
      </div>
    </>,
    document.body
  );
}

function SectionContextMenu({ x, y, addAllPcsDisabled, deleteAllDisabled, onClose, onNew, onAddAllPcs, onDeleteAll }: { x: number; y: number; addAllPcsDisabled?: boolean; deleteAllDisabled?: boolean; onClose: () => void; onNew: () => void; onAddAllPcs?: () => void; onDeleteAll?: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 280);
  const menuHeight = 40 + (onAddAllPcs ? 40 : 0) + (onDeleteAll ? 40 : 0);
  const top = Math.min(y, window.innerHeight - menuHeight);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-64 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onNew}>
          <Plus size={14} /> New
        </button>
        {onAddAllPcs && (
          <button type='button' role='menuitem' disabled={addAllPcsDisabled} className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint disabled:hover:bg-transparent' onClick={onAddAllPcs}>
            <UsersRound size={14} /> Add all PCs to all encounters
          </button>
        )}
        {onDeleteAll && (
          <button type='button' role='menuitem' disabled={deleteAllDisabled} className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover disabled:cursor-not-allowed disabled:text-p1-faint disabled:hover:bg-transparent' onClick={onDeleteAll}>
            <Trash2 size={14} /> Delete all
          </button>
        )}
      </div>
    </>,
    document.body
  );
}

function CreateNameModal({ title, label, confirmLabel, skipLabel, onCancel, onSkip, onConfirm }: { title: string; label: string; confirmLabel: string; skipLabel?: string; onCancel: () => void; onSkip?: () => void; onConfirm: (name: string) => void }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (onSkip) skipRef.current?.focus();
    else inputRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel, onSkip]);
  const trimmed = name.trim();
  function submit() {
    if (!trimmed) {
      if (onSkip) onSkip();
      return;
    }
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
          {onSkip && skipLabel && (
            <button ref={skipRef} type='button' className='toolbar-button' onClick={onSkip}>{skipLabel}</button>
          )}
          <button type='button' className='toolbar-button' disabled={!trimmed} onClick={() => onConfirm(trimmed)}>{confirmLabel}</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function CharacterGridContextMenu({ x, y, onClose, onJoinMyCampaign, onJoinOthersCampaign, onUnassign, onOpenStatBlock, onRename, onExportJson, onExportPdf, onDelete }: { x: number; y: number; onClose: () => void; onJoinMyCampaign: () => void; onJoinOthersCampaign: () => void; onUnassign?: () => void; onOpenStatBlock: () => void; onRename: () => void; onExportJson: () => void; onExportPdf: () => void; onDelete: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 320);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onPointerDown={onClose} />
      <div
        role='menu'
        className='fixed z-[110] min-w-52 border border-p1-border bg-p1-surface py-1 shadow-2xl'
        style={{ left, top }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onOpenStatBlock(); }}>
          <AlignLeft size={14} /> Open Stat Block
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onRename(); }}>
          <Pencil size={14} /> Rename
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onJoinMyCampaign(); }}>
          <UserPlus size={14} /> Join my campaign
        </button>
        <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onJoinOthersCampaign(); }}>
          <KeyRound size={14} /> Join other's campaign
        </button>
        {onUnassign && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onUnassign(); }}>
            <UserMinus size={14} /> Unassign
          </button>
        )}
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

function MessageDialog({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='message-dialog-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='message-dialog-title' className='text-lg font-semibold'>{title}</h2>
        <p className='mt-2 text-sm leading-6 text-p1-muted'>{message}</p>
        <div className='mt-5 flex justify-end'>
          <button type='button' className='toolbar-button' onClick={onClose}>OK</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function JoinKeyModal({
  characterName,
  onCancel,
  onConfirm,
}: {
  characterName: string;
  onCancel: () => void;
  onConfirm: (key: string) => void;
}) {
  const [key, setKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  const trimmed = key.trim();
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
      <section role='dialog' aria-modal='true' aria-labelledby='join-key-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='join-key-title' className='text-lg font-semibold'>Join other's campaign</h2>
        <p className='mt-2 text-sm text-p1-muted'>Enter a join key to add {characterName} to another GM's campaign.</p>
        <label className='mt-3 block text-xs text-p1-muted'>
          Join key
          <input
            ref={inputRef}
            className='settings-input mt-1 w-full'
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </label>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onCancel}>Cancel</button>
          <button type='button' className='toolbar-button' disabled={!trimmed} onClick={submit}>OK</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function CampaignAssignPickerModal({
  characterName,
  campaigns,
  onCancel,
  onPick,
}: {
  characterName: string;
  campaigns: Campaign[];
  onCancel: () => void;
  onPick: (campaign: Campaign) => void;
}) {
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
      <section role='dialog' aria-modal='true' aria-labelledby='assign-campaign-title' className='w-full max-w-md border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='assign-campaign-title' className='text-lg font-semibold'>Assign campaign</h2>
        <p className='mt-2 text-sm text-p1-muted'>Choose a campaign for {characterName}.</p>
        {campaigns.length === 0 ? (
          <p className='mt-4 text-sm text-p1-muted'>You do not own a campaign yet. Create one from Campaigns, or use Join other's campaign with a join key.</p>
        ) : (
          <div className='mt-4 grid grid-cols-2 gap-2'>
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type='button'
                className='flex min-h-[4.25rem] flex-col items-start justify-center border border-p1-border bg-p1-inset px-3 py-2 text-left hover:border-p1-accent/60 hover:bg-p1-hover'
                onClick={() => onPick(campaign)}
              >
                <span className='line-clamp-2 text-sm font-medium text-p1-text'>{campaign.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className='mt-5 flex justify-end'>
          <button type='button' className='toolbar-button' onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function RailContextMenu({ x, y, onClose, onRename, onViewArt, onPickColor, onClearColor, onDelete, onDeleteAll, onRemove, removeLabel }: { x: number; y: number; onClose: () => void; onRename?: () => void; onViewArt?: () => void; onPickColor?: () => void; onClearColor?: () => void; onDelete?: () => void; onDeleteAll?: () => void; onRemove?: () => void; removeLabel?: string }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const itemCount = [onRename, onViewArt, onPickColor, onClearColor, onRemove, onDelete, onDeleteAll].filter(Boolean).length;
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - (itemCount * 40 + 16));
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div role='menu' className='fixed z-[110] min-w-52 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        {onRename && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onRename}>
            <Pencil size={14} /> Rename
          </button>
        )}
        {onViewArt && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onViewArt}>
            <Eye size={14} /> View art
          </button>
        )}
        {onPickColor && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onPickColor}>
            <ImageIcon size={14} /> Pick for color
          </button>
        )}
        {onClearColor && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onClearColor}>
            <Eraser size={14} /> Clear color
          </button>
        )}
        {onRemove && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onRemove}>
            <UserMinus size={14} /> {removeLabel ?? 'Remove from campaign'}
          </button>
        )}
        {onDelete && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        )}
        {onDeleteAll && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onDeleteAll}>
            <Trash2 size={14} /> Delete all
          </button>
        )}
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
let activeCombatantDrag: CombatantDragPayload | null = null;

function writeCombatantDrag(event: ReactDragEvent, payload: CombatantDragPayload) {
  activeCombatantDrag = payload;
  event.dataTransfer.effectAllowed = 'move';
  const serialized = JSON.stringify(payload);
  event.dataTransfer.setData(COMBATANT_DRAG_TYPE, serialized);
  event.dataTransfer.setData('text/plain', serialized);
}
function clearCombatantDrag() {
  activeCombatantDrag = null;
}
function readCombatantDrag(event: ReactDragEvent): CombatantDragPayload | null {
  if (activeCombatantDrag) return activeCombatantDrag;
  try {
    const value = event.dataTransfer.getData(COMBATANT_DRAG_TYPE) || event.dataTransfer.getData('text/plain');
    return value ? JSON.parse(value) as CombatantDragPayload : null;
  } catch {
    return null;
  }
}
function hasCombatantDrag(_event?: ReactDragEvent) {
  return activeCombatantDrag != null;
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
            <p className='mt-1 text-xs text-p1-muted'>Pathfinder 2e encounter budget from creature levels vs party level. Awards stay on the four-PC table.</p>
            {difficulty.exceedsBudget && (
              <p className='mt-1 text-xs text-p1-muted'>Exceeds the {difficulty.status} budget ({difficulty.budget} XP) and stays {difficulty.status} until the next budget.</p>
            )}
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
              <p className='text-xs text-p1-muted'>{difficulty.partySizeFromEncounter ? 'Stored on the encounter' : 'Allies in the encounter'} · each PC past or short of 4 adds or removes that difficulty&apos;s fixed adjustment</p>
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
            <p className='border-b border-p1-border px-3 py-2 text-xs text-p1-muted'>
              Encounter XP: {difficulty.awardXp / 4}. Party size adjusts difficulty budgets, not creature XP values. XP awarded per PC may differ.
            </p>
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

function EncounterHeader({ encounter, combatants, count, isGm, campaignId, noteLink, tab, onTab, canAddCreature, onAddCreature, showAddHazard, canAddHazard, onAddHazard, canRollInitiative, onRollInitiative, canClearInitiative, onClearInitiative, canMaxStats, onMaxStats, canReset, onReset, onOpenStatBlocks, onCreateEncounter }: { encounter: Encounter | null; combatants: PopulatedCombatant[]; count: number; isGm: boolean; campaignId?: number | null; noteLink?: { href: string; name: string }; tab: 'combat' | 'dice'; onTab: (tab: 'combat' | 'dice') => void; canAddCreature?: boolean; onAddCreature?: () => void; showAddHazard?: boolean; canAddHazard?: boolean; onAddHazard?: () => void; canRollInitiative?: boolean; onRollInitiative?: () => void; canClearInitiative?: boolean; onClearInitiative?: () => void; canMaxStats?: boolean; onMaxStats?: () => void; canReset?: boolean; onReset?: () => void; onOpenStatBlocks?: () => void; onCreateEncounter?: (name: string) => void }) {
  const [xpOpen, setXpOpen] = useState(false);
  const difficulty = encounter && shouldDisplayEncounterDifficulty(combatants) ? calculateDifficulty(encounter, combatants) : null;
  return (
    <div className='sticky top-0 z-10 border-b border-p1-border bg-p1-surface/95 px-5 py-4 backdrop-blur'>
      {!encounter && isGm && onCreateEncounter && (
        <button type='button' className='toolbar-button absolute right-5 top-4' title='New encounter' onClick={() => onCreateEncounter('')}>
          <Plus size={14} /> New
        </button>
      )}
      <Eyebrow>{isGm ? 'GM encounter' : 'Assigned encounter'}</Eyebrow>
      <h2 className='mt-1 text-xl font-semibold'>{encounter ? encounterDisplayName(encounter.name) : 'No encounter selected'}</h2>
      {noteLink ? <Link to={noteLink.href} className='mt-1 block text-xs text-p1-accent hover:underline'>See campaign Notes page: {encounterDisplayName(noteLink.name)}</Link> : <p className='mt-1 text-xs text-p1-faint'>{encounter ? (encounter.meta_data.description || `${count} combatants`) : 'Add or select an encounter to start combat.'}</p>}
      {!encounter ? null : <div className='mt-3 flex flex-wrap items-center gap-2'>
        <div className='mr-auto flex gap-1'>
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
        {isGm && difficulty && (
          <button type='button' className='xp-challenge' title='Open XP budget math' onClick={() => setXpOpen(true)}>
            <span className={`xp-challenge-dot xp-challenge-dot-${difficulty.color}`} />
            {difficulty.status} ({difficulty.xp} XP)
          </button>
        )}
        {isGm && xpOpen && difficulty && <EncounterDifficultyModal difficulty={difficulty} onClose={() => setXpOpen(false)} />}
        {tab === 'combat' && (
          <>
            <button type='button' className='toolbar-button' title='PC stat blocks' onClick={() => onOpenStatBlocks?.()}><AlignLeft size={15} /> Stat blocks</button>
            {isGm && <button className='toolbar-button' disabled={!canAddCreature} title={canAddCreature ? 'Add a creature from the catalog' : 'Wait for the roster to finish saving'} onClick={onAddCreature}><Swords size={15} /> Add creature</button>}
            {isGm && showAddHazard && <button className='toolbar-button' disabled={!canAddHazard} title={canAddHazard ? 'Add a hazard from the catalog' : 'Wait for the roster to finish saving'} onClick={onAddHazard}><TriangleAlert size={15} /> Add hazard</button>}
            <button className='toolbar-button' disabled={!canRollInitiative} title={!isGm ? 'GM only' : count === 0 ? 'Add combatants first' : 'Roll initiative'} onClick={onRollInitiative}><GiDiceTwentyFacesTwenty size={15} /> Roll initiative</button>
            <button className='toolbar-button' disabled={!canClearInitiative} title={!isGm ? 'GM only' : canClearInitiative ? 'Clear initiative and restore roster order' : 'No initiative to clear'} onClick={onClearInitiative}><Eraser size={15} /> Clear init</button>
            <button className='toolbar-button' disabled={!canMaxStats} title={!isGm ? 'GM only' : canMaxStats ? 'Restore HP, spells, focus, wands/staves, and other encounter consumables' : count === 0 ? 'Add combatants first' : 'Wait for the roster to finish saving'} onClick={onMaxStats}><HeartPulse size={15} /> Max stats</button>
            <button className='toolbar-button' disabled={!canReset} title={!isGm ? 'GM only' : canReset ? 'Reset HP, temp HP, conditions, spells, initiative, and logs' : 'Wait for the roster to finish saving'} onClick={onReset}><RotateCcw size={15} /> Reset</button>
            {isGm && encounter && (
              <TacticsPublisher
                campaignId={campaignId ?? 0}
                encounterId={encounter.id}
                revision={(encounter.combatants?.list ?? []).map((combatant) => `${combatant._id}:${combatant.initiative ?? ''}:${combatant.data?.hp_current ?? ''}:${(combatant.data?.details?.conditions ?? []).map((condition) => condition.name).join('.')}`).join('|')}
              />
            )}
            <button className='toolbar-button' disabled title='Available after read-only parity'><Shield size={15} /> Group check</button>
          </>
        )}
      </div>}
    </div>
  );
}

function DiceRollToolbar({ isGm, side, audience, title, dc, stat, challenges, challengeId, canEdit, canRoll, canClear, onSide, onAudience, onTitle, onTitleCommit, onDc, onDcCommit, onStat, onChallenge, onRoll, onClear }: {
  isGm: boolean;
  side: DiceRollSide | undefined;
  audience?: 'public' | 'private';
  title: string;
  dc: string;
  stat: string;
  challenges: Array<{ id: string; title: string }>;
  challengeId: string;
  canEdit: boolean;
  canRoll: boolean;
  canClear: boolean;
  onSide: (side: DiceRollSide) => void;
  onAudience: (audience: 'public' | 'private') => void;
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
  const lockChallenge = !isGm;
  return (
    <div className='flex flex-nowrap items-end gap-2 border-b border-p1-border bg-p1-surface px-5 py-3'>
      {isGm && (
        <fieldset className='flex shrink-0 items-center gap-2'>
          <legend className='sr-only'>Who to include</legend>
          {(['enemies', 'allies', 'both'] as const).map((value) => (
            <label key={value} className='flex items-center gap-1 whitespace-nowrap text-xs text-p1-muted'>
              <input type='radio' name='dice-roll-side' checked={(side ?? 'allies') === value} onChange={() => onSide(value)} />
              {value === 'enemies' ? 'Enemies' : value === 'allies' ? 'Allies' : 'Both'}
            </label>
          ))}
        </fieldset>
      )}
      {isGm && (
        <fieldset className='flex shrink-0 items-center gap-2'>
          <legend className='sr-only'>Who can see this roll</legend>
          {(['private', 'public'] as const).map((value) => (
            <label key={value} className='flex items-center gap-1 whitespace-nowrap text-xs text-p1-muted'>
              <input type='radio' name='dice-roll-audience' checked={(audience ?? 'public') === value} onChange={() => onAudience(value)} />
              {value === 'private' ? 'Private' : 'Public'}
            </label>
          ))}
        </fieldset>
      )}
      <label className='w-36 shrink-0'>
        <span className='text-[10px] uppercase text-p1-faint'>Challenge</span>
        <select
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-sm text-p1-text disabled:cursor-not-allowed disabled:opacity-50'
          value={lockChallenge || challengesEmpty ? '' : challengeId}
          disabled={!isGm || challengesEmpty || lockChallenge}
          onChange={(event) => onChallenge(event.target.value)}
        >
          {lockChallenge ? (
            <option value=''>Ad hoc</option>
          ) : challengesEmpty ? (
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
      <label className='min-w-0 flex-1'>
        <span className='text-[10px] uppercase text-p1-faint'>Title</span>
        <input
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-sm text-p1-text'
          value={title}
          disabled={!canEdit}
          placeholder='Party against flying blade trap'
          onChange={(event) => onTitle(event.target.value)}
          onBlur={() => onTitleCommit(title)}
        />
      </label>
      <label className='w-16 shrink-0'>
        <span className='text-[10px] uppercase text-p1-faint'>DC</span>
        <input
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-center text-sm text-p1-text'
          type='number'
          value={dc}
          disabled={!canEdit}
          onChange={(event) => onDc(event.target.value)}
          onBlur={() => {
            const parsed = Number.parseInt(dc, 10);
            onDcCommit(Number.isFinite(parsed) ? parsed : null);
          }}
        />
      </label>
      <label className='w-40 shrink-0'>
        <span className='text-[10px] uppercase text-p1-faint'>Check</span>
        <select
          className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-base text-p1-text'
          value={stat}
          disabled={!canEdit}
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
      <button type='button' className='toolbar-button shrink-0' disabled={!canRoll} title={!canRoll ? (isGm ? 'Pick a side, check, and DC first' : 'Pick a check and DC first') : 'Choose per-combatant bonuses, then roll'} onClick={onRoll}>
        <GiDiceTwentyFacesTwenty size={15} /> Roll
      </button>
      <button type='button' className='toolbar-button shrink-0' disabled={!canClear} title={isGm ? (canClear ? 'Clear current roll results from the grid. The roll log is not changed.' : 'No results to clear') : (canClear ? 'Clear title, DC, check, and grid results. The roll log is not changed.' : 'Nothing to clear')} onClick={onClear}>
        <Eraser size={14} /> Clear
      </button>
    </div>
  );
}

type GridSortKey = 'name' | 'init';
type GridSort = { key: GridSortKey; dir: 'asc' | 'desc' } | null;

function compareCombatantNames(a: PopulatedCombatant, b: PopulatedCombatant) {
  return combatantDisplayName(a).localeCompare(combatantDisplayName(b), undefined, { numeric: true, sensitivity: 'base' });
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

function CombatantGrid({ combatants, encounterId, initiativeRollNonce, selectedId, onSelect, statuses, calculating, canManageRoster, canManageCombatant, onAddPlayer, onRemovePlayer, onCloneCreature, onDeleteCreature, onRestoreCombatant, onMarkOut, onRequestRemoveFromCampaign, onUpdateInitiative, onUpdateHp, onToggleHazardDisabled, onSingleCheck, onSingleChallenge, challenges, dice, playerView = false }: { combatants: PopulatedCombatant[]; encounterId: number | null; initiativeRollNonce: number; selectedId: string | null; onSelect: (id: string) => void; statuses?: CombatantStatusMap; calculating: boolean; canManageRoster: boolean; canManageCombatant: (combatant: PopulatedCombatant) => boolean; onAddPlayer: (characterId: number) => void; onRemovePlayer: (combatantId: string) => void; onCloneCreature: (combatantId: string) => void; onDeleteCreature: (combatantId: string) => void; onRestoreCombatant: (combatantId: string) => void; onMarkOut: (combatantId: string, out: Combatant['out']) => void; onRequestRemoveFromCampaign?: (characterId: number, name: string) => void; onUpdateInitiative: (combatantId: string, initiative: number) => void; onUpdateHp: (combatantId: string, raw: string, note: string | null) => void; onToggleHazardDisabled?: (combatantId: string, disabled: boolean) => void; onSingleCheck?: (combatantId: string, stat: string, x: number, y: number) => void; onSingleChallenge?: (combatantId: string, challengeId: string, x: number, y: number, preferredStat?: string) => void; challenges?: Array<{ id: string; title: string }>; dice?: { challengeId?: string; checkStat?: string; columnLabel: string; dc: number | null; results: Record<string, DiceCheckResult>; emptyMessage: string }; playerView?: boolean }) {
  const [encounterActive, setEncounterActive] = useState(false);
  const [gridSort, setGridSort] = useState<GridSort>(() => (
    dice ? null : combatants.some((combatant) => initiativeValue(combatant) != null) ? { key: 'init', dir: 'desc' } : null
  ));
  const [menu, setMenu] = useState<{ id: string; type: Combatant['type']; x: number; y: number } | null>(null);
  const [hpEditor, setHpEditor] = useState<{ combatantId: string; name: string; currentHp: number; maxHp: number; rect: DOMRect } | null>(null);
  const [checkMods, setCheckMods] = useState<Record<string, number | null>>({});
  const [checkModsLoading, setCheckModsLoading] = useState(false);
  const checkStat = dice?.checkStat;
  const gridCombatants = playerView ? playerVisibleCombatants(combatants) : combatants;
  const combatantIds = gridCombatants.map((combatant) => combatant._id).join(',');
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
    void loadAllCheckOptions(gridCombatants).then((optionsById) => {
      if (cancelled) return;
      const next: Record<string, number | null> = {};
      for (const combatant of gridCombatants) {
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
    ? [...gridCombatants].sort((a, b) => (
      gridSort.key === 'name'
        ? (gridSort.dir === 'asc' ? compareCombatantNames(a, b) : compareCombatantNames(b, a))
        : compareCombatantInitiative(a, b, gridSort.dir)
    ))
    : gridCombatants;
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
      <table className={`w-full table-fixed border-collapse text-sm ${dice ? 'min-w-[1200px]' : 'min-w-[1100px]'}`}>
        <thead className='border-b border-p1-border bg-p1-header text-[10px] uppercase text-p1-faint'><tr>{!dice && <th className='w-20 px-0 text-left'><button type='button' className='inline-flex w-full items-center gap-1 px-3 py-3 uppercase hover:text-p1-muted' onClick={() => setGridSort((value) => cycleGridSort(value, 'init'))} aria-label='Cycle initiative sort' title={gridSort?.key === 'init' && gridSort.dir === 'desc' ? 'Sorted high to low. Click for low to high.' : gridSort?.key === 'init' && gridSort.dir === 'asc' ? 'Sorted low to high. Click to clear sort.' : 'Click to sort by initiative, high to low.'}>Init<SortGlyph dir={gridSort?.key === 'init' ? gridSort.dir : null} /></button></th>}<th className='w-48 px-0 text-left'><button type='button' className='inline-flex w-full items-center gap-1 px-3 py-3 uppercase hover:text-p1-muted' onClick={() => setGridSort((value) => cycleGridSort(value, 'name'))} aria-label='Cycle combatant name sort' title={gridSort?.key === 'name' && gridSort.dir === 'asc' ? 'Sorted A–Z. Click for Z–A.' : gridSort?.key === 'name' && gridSort.dir === 'desc' ? 'Sorted Z–A. Click to clear sort.' : 'Click to sort by name A–Z.'}>Combatant<SortGlyph dir={gridSort?.key === 'name' ? gridSort.dir : null} /></button></th><th className='w-44 px-3 text-left'>Conditions</th><th className='w-64 px-3 text-left'>Defenses</th>{dice && <th className='w-24 px-3 text-left'>Check</th>}<th className='w-32 px-3 text-left'>{dice ? 'Roll / DC' : 'HP'}</th>{dice && <th className='w-72 px-3 text-left'>{dice.columnLabel}{dice.dc != null ? ` vs DC ${dice.dc}` : ''}</th>}{!playerView && <th className='w-16 px-3 text-center'>Open</th>}</tr></thead>
        <tbody>
          {rows.map((combatant) => {
            const detailsVisible = combatant.access?.details_revealed !== false;
            const hazard = isHazardCombatant(combatant);
            const calculable = detailsVisible && hasFullEntityDetails(combatant);
            const stored = combatant.data ? statsFor(combatant.data) : null;
            const stats = defensesForRow(statuses?.[combatant._id], combatant.data) ?? (!calculable && combatant.data ? fallbackStatus(combatant.data) : null);
            const draggable = canManageRoster;
            const result = dice?.results[combatant._id];
            const outcomeTone = dice ? outcomeRowClass(result?.outcome) : '';
            const rowTone = outcomeTone || (combatant._id === selectedId ? 'bg-p1-accent/[0.07]' : 'hover:bg-p1-hover');
            const critInk = result?.outcome === 'critical-success';
            const enemyPlayerRow = playerView && isEnemyCreature(combatant);
            const canOpen = !enemyPlayerRow;
            const displayName = enemyPlayerRow ? playerEnemyLabel(combatantDisplayName(combatant)) : combatantDisplayName(combatant);
            const currentHazardHp = getHazardCurrentHp(combatant);
            const hazardMaxHp = combatant.hazard?.details.defenses?.hp;
            return (
              <tr key={combatant._id} onClick={(event) => { if (!canOpen) return; if ((event.target as HTMLElement).closest('button, input, textarea, a, [draggable="true"]')) return; openCombatant(combatant, onSelect); }} onContextMenu={(event) => {
                const canDiceMenu = Boolean(dice && (combatant.type === 'CREATURE' || combatant.type === 'CHARACTER') && (playerView || onSingleCheck || onSingleChallenge));
                if (canDiceMenu) {
                  event.preventDefault();
                  setMenu({ id: combatant._id, type: combatant.type, x: event.clientX, y: event.clientY });
                  return;
                }
                if (!canManageRoster || (combatant.type !== 'CREATURE' && combatant.type !== 'CHARACTER' && combatant.type !== 'HAZARD')) return;
                event.preventDefault();
                setMenu({ id: combatant._id, type: combatant.type, x: event.clientX, y: event.clientY });
              }} className={`border-b border-p1-border last:border-0 ${canOpen ? 'cursor-pointer' : ''} ${rowTone}`}>
                {!dice && <td className='px-3 py-3'><InitiativeCell key={`${combatant._id}:${combatant.initiative ?? ''}:${combatant.initiative_roll?.die ?? ''}`} combatant={combatant} canEdit={canManageRoster} onUpdate={(initiative) => onUpdateInitiative(combatant._id, initiative)} /></td>}
                <td className='px-3 py-3'>
                  <div className={`flex w-full items-center gap-3 text-left ${critInk ? 'text-[#152214]' : ''}`}>
                    {draggable && (
                      <span
                        draggable
                        onDragStart={(event) => writeCombatantDrag(event, { source: 'encounter', combatantId: combatant._id, characterId: combatant.character })}
                        onDragEnd={() => { clearCombatantDrag(); setEncounterActive(false); }}
                        className={`shrink-0 cursor-grab ${critInk ? 'text-[#234028]' : 'text-p1-faint'}`}
                        title='Drag to reorder'
                        aria-label={`Drag ${displayName} to reorder`}
                      >
                        <GripVertical size={14} />
                      </span>
                    )}
                    <button type='button' className='flex min-w-0 flex-1 items-center gap-3 text-left' onClick={() => { if (canOpen) openCombatant(combatant, onSelect); }} onContextMenu={(event) => {
                      const canDiceMenu = Boolean(dice && (combatant.type === 'CREATURE' || combatant.type === 'CHARACTER') && (playerView || onSingleCheck || onSingleChallenge));
                      if (!canDiceMenu) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ id: combatant._id, type: combatant.type, x: event.clientX, y: event.clientY });
                    }}>
                      <EntityIcon type={combatant.type} name={combatant.data?.name ?? combatantDisplayName(combatant)} imageUrl={combatant.data?.details?.image_url} />
                      <span className='min-w-0'>
                        <span className='block truncate font-semibold'>{displayName}</span>
                        {!enemyPlayerRow && <span className={`block text-xs ${critInk ? 'text-[#234028]' : 'text-p1-faint'}`}>
                          {hazard
                            ? `${combatant.hazard.details.complexity === 'SIMPLE' ? 'Simple' : 'Complex'} hazard · Level ${combatant.hazard.level}`
                            : `Level ${combatant.data?.level ?? '—'} | ${combatant.ally ? 'Ally' : 'Enemy'}`}
                        </span>}
                      </span>
                    </button>
                  </div>
                </td>
                <td className='px-3 py-3'>
                  <div className='flex flex-wrap items-center gap-1'>
                    {dice && (
                      <span className={`inline-flex items-center truncate rounded-full border border-p1-border px-2 py-[3px] text-[10px] font-medium leading-none tracking-wide ${result ? outcomeRowClass(result.outcome) : 'text-p1-faint'} ${critInk ? 'text-[#234028]' : ''}`}>
                        {result ? outcomeLabel(result.outcome) : 'Not rolled'}
                      </span>
                    )}
                    {hazard ? (
                      <label className='inline-flex items-center gap-1.5 text-[11px] text-p1-muted'>
                        <input
                          type='checkbox'
                          className='accent-p1-accent'
                          checked={combatant.hazard_state?.disabled ?? false}
                          disabled={!canManageRoster}
                          onChange={(event) => onToggleHazardDisabled?.(combatant._id, event.target.checked)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        Disabled
                      </label>
                    ) : (
                      <CombatantConditionPills conditions={detailsVisible ? compiledConditions(combatant.data?.details?.conditions ?? []) : []} onOpen={canOpen ? () => openCombatant(combatant, onSelect) : undefined} maxVisible={dice ? 5 : 2} />
                    )}
                  </div>
                </td>
                <td className={`px-3 py-3 text-xs ${critInk ? 'text-[#234028]' : 'text-p1-muted'}`}>
                  {hazard ? (
                    combatant.hazard.details.defenses
                      ? <>{combatant.hazard.details.defenses.ac != null && <>{combatant.hazard.details.defenses.ac} AC</>}{combatant.hazard.details.defenses.fort != null && <> <span className='px-1 text-p1-faint'>|</span> Fort {signed(combatant.hazard.details.defenses.fort)}</>}{combatant.hazard.details.defenses.ref != null && <>, Ref {signed(combatant.hazard.details.defenses.ref)}</>}</>
                      : <span className='text-p1-faint'>—</span>
                  ) : enemyPlayerRow ? <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>—</span> : !detailsVisible ? <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>Not revealed</span> : stats ? <>{stats.ac} AC <span className={`px-1 ${critInk ? 'text-[#234028]' : 'text-p1-faint'}`}>|</span> Fort {signed(stats.fortitude)}, Ref {signed(stats.reflex)}, Will {signed(stats.will)}</> : calculating ? <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>Calculating...</span> : <span className='text-p1-danger-soft'>Unavailable</span>}
                </td>
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
                  ) : enemyPlayerRow ? (
                    <span className='inline-flex h-9 min-w-24 items-center justify-center border border-p1-border bg-p1-raised text-p1-faint'>—</span>
                  ) : !detailsVisible ? (
                    <span className='inline-flex h-9 min-w-24 items-center justify-center border border-p1-border bg-p1-raised text-p1-faint'>Hidden</span>
                  ) : hazard ? (
                    hazardMaxHp == null ? (
                      <span className='inline-flex h-9 min-w-24 items-center justify-center border border-p1-border bg-p1-raised text-p1-faint'>—</span>
                    ) : (
                      <GridHpCell
                        combatant={combatant}
                        maxHp={hazardMaxHp}
                        calculating={false}
                        canEdit={canManageCombatant(combatant)}
                        onEdit={(rect) => {
                          setHpEditor({ combatantId: combatant._id, name: displayName, currentHp: currentHazardHp ?? hazardMaxHp, maxHp: hazardMaxHp, rect });
                        }}
                      />
                    )
                  ) : (
                    <GridHpCell
                      combatant={combatant}
                      maxHp={stats?.maxHp ?? (stored?.maxHp && stored.maxHp > 0 ? stored.maxHp : null)}
                      calculating={calculating}
                      canEdit={canManageCombatant(combatant)}
                      onEdit={(rect) => {
                        const currentHp = combatant.data?.hp_current ?? stats?.maxHp ?? 0;
                        const resolvedMaxHp = stats?.maxHp ?? currentHp;
                        setHpEditor({ combatantId: combatant._id, name: displayName, currentHp, maxHp: resolvedMaxHp, rect });
                      }}
                    />
                  )}
                </td>
                {dice && (
                  <td className={`px-3 py-3 text-xs ${critInk ? 'text-[#234028]' : 'text-p1-muted'}`}>
                    {result ? formatCheckRoll(result, result.total, dice.dc ?? undefined) : <span className={critInk ? 'text-[#234028]' : 'text-p1-faint'}>Not rolled</span>}
                  </td>
                )}
                {!playerView && <td className='px-3 text-center'><button className='icon-button mx-auto' title={`Open ${displayName}`} onClick={() => openCombatant(combatant, onSelect)}><PanelRight size={16} /></button></td>}
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={playerView ? (dice ? 6 : 5) : (dice ? 7 : 6)} className='p-12 text-center text-sm text-p1-faint'>{playerView ? 'No combatants in this encounter.' : (dice?.emptyMessage ?? 'No combatants in this encounter.')}</td></tr>}
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
          canChallenge={!playerView && Boolean(onSingleChallenge)}
          selectedChallengeId={dice.challengeId}
          selectedStat={dice.checkStat}
          challenges={challenges ?? []}
          onRemoveFromCampaign={!playerView && menuCombatant.type === 'CHARACTER' && menuCombatant.character != null && onRequestRemoveFromCampaign ? () => {
            const characterId = menuCombatant.character;
            const name = menuCombatant.data.name;
            setMenu(null);
            if (characterId != null) onRequestRemoveFromCampaign(characterId, name);
          } : undefined}
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
      {menu?.type === 'HAZARD' && !dice && (
        <CombatantContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onDelete={() => { setMenu(null); onDeleteCreature(menu.id); }}
        />
      )}
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
          onRemoveFromCampaign={onRequestRemoveFromCampaign ? () => {
            const combatant = combatants.find((item) => item._id === menu.id);
            const characterId = combatant?.type === 'CHARACTER' ? combatant.character : undefined;
            const name = combatant ? combatantDisplayName(combatant) : undefined;
            setMenu(null);
            if (characterId != null && name) onRequestRemoveFromCampaign(characterId, name);
          } : undefined}
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
  const current = isHazardCombatant(combatant) ? getHazardCurrentHp(combatant) : combatant.data?.hp_current;
  const content = maxHp != null ? (
    <>
      {current ?? maxHp}
      <span className='px-2 text-p1-faint'>/</span>
      {maxHp}
    </>
  ) : calculating ? (
    <span className='text-p1-faint'>...</span>
  ) : (
    <>
      {current ?? '-'}
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
      title={`Edit ${combatantDisplayName(combatant)} hit points`}
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
        aria-label={`${combatantDisplayName(combatant)} initiative`}
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

function InitiativeRoundLogPanel({ log, canEdit, canClear, onClear, onUpdateNote, expandable = true }: { log: InitiativeRoundLog[]; canEdit?: boolean; canClear?: boolean; onClear?: () => void; onUpdateNote?: (round: InitiativeRoundLog, entry: InitiativeRoundLogEntry, note: string) => void; expandable?: boolean }) {
  const [open, setOpen] = useState(expandable);
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
          className={`flex min-w-0 flex-1 items-center gap-2 text-left ${expandable ? 'hover:text-p1-text' : 'cursor-default'}`}
          onClick={() => { if (expandable) setOpen((value) => !value); }}
          aria-expanded={open}
          disabled={!expandable}
        >
          <History size={15} className='text-p1-muted' />
          <span className='text-sm font-semibold'>Round log</span>
          <span className='text-xs text-p1-faint'>{log.length} round{log.length === 1 ? '' : 's'}</span>
          {expandable && <ChevronDown size={14} className={`ml-auto text-p1-faint transition-transform ${open ? 'rotate-180' : ''}`} />}
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

function CombatantConditionPills({ conditions, onOpen, maxVisible = CONDITION_PILL_MAX }: { conditions: Condition[]; onOpen?: () => void; maxVisible?: number }) {
  if (conditions.length === 0) return null;
  const visible = conditions.slice(0, maxVisible);
  const extra = conditions.slice(maxVisible);
  const Pill = onOpen ? 'button' : 'span';
  return (
    <div className='flex flex-wrap items-center gap-1'>
      {visible.map((condition) => (
        <Pill
          key={`${condition.name}-${condition.source ?? 'direct'}`}
          type={onOpen ? 'button' : undefined}
          className={`${CONDITION_PILL_CLASS} ${onOpen ? 'hover:border-p1-border hover:bg-p1-hover' : ''}`}
          title={condition.source ? `${conditionLabel(condition)} from ${condition.source}` : conditionLabel(condition)}
          onClick={onOpen}
        >
          {conditionLabel(condition)}
        </Pill>
      ))}
      {extra.length > 0 && (
        onOpen ? (
        <button
          type='button'
          className='inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-p1-border bg-p1-hover px-1.5 text-[9px] font-semibold text-p1-muted hover:border-p1-border hover:text-p1-text'
          title={extra.map(conditionLabel).join(', ')}
          onClick={onOpen}
        >
          +{extra.length}
        </button>
        ) : (
        <span
          className='inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-p1-border bg-p1-hover px-1.5 text-[9px] font-semibold text-p1-muted'
          title={extra.map(conditionLabel).join(', ')}
        >
          +{extra.length}
        </span>
        )
      )}
    </div>
  );
}

function InspectorCollapseButton({ onCollapse }: { onCollapse?: () => void }) {
  if (!onCollapse) return null;
  return <button type='button' className='icon-button shrink-0' title='Hide combatant details' aria-label='Hide combatant details' onClick={onCollapse}><PanelRight size={16} /></button>;
}

function Inspector({ combatant, width, fill, activeTab, onTab, onCollapse, hasMatchingCampaignNote, status, statusLoading, canManageSpells, spellActions, onChangeConditions, onSaveGmNotes, onPersistHpCurrent, onPersistTempHp, initiativeLog, canEditRoundNotes, onUpdateRoundNote, onLogAction, onDeleteLogEntry }: {
  combatant: PopulatedCombatant | null; width: number; fill?: boolean; activeTab: DetailTab; onTab: (tab: DetailTab) => void; onCollapse?: () => void; hasMatchingCampaignNote?: boolean; status?: Phase1CreatureStatus | null; statusLoading: boolean; canManageSpells: boolean; spellActions?: Phase1SpellActions; onChangeConditions?: (conditions: Condition[], note?: string | null) => void; onSaveGmNotes?: (text: string) => void; onPersistHpCurrent?: (raw: string, note: string | null) => void; onPersistTempHp?: (raw: string, note: string | null) => void; initiativeLog?: InitiativeRoundLog[]; canEditRoundNotes?: boolean; onUpdateRoundNote?: (round: InitiativeRoundLog, entry: InitiativeRoundLogEntry, note: string) => void; onLogAction?: (draft: ActionLogDraft) => void; onDeleteLogEntry?: (entryId: string) => void;
}) {
  return (
    <aside className={`min-h-0 overflow-hidden bg-p1-inset ${fill ? 'h-full w-full' : ''}`} style={fill ? undefined : { width }}>
      {!combatant ? (
        <div className='relative flex h-full flex-col items-center justify-center px-8 text-center'><div className='absolute right-3 top-3'><InspectorCollapseButton onCollapse={onCollapse} /></div><PanelRight className='mb-4 text-p1-faint' size={28} /><p className='text-sm font-semibold'>Select a combatant</p><p className='mt-2 max-w-56 text-xs leading-5 text-p1-faint'>PCs, NPCs, and creatures open in this shared read-only inspector.</p></div>
      ) : combatant.type === 'HAZARD' && combatant.hazard ? (
        <div className='flex h-full min-w-0 flex-col'>
          <div className='flex items-start gap-3 border-b border-p1-border px-4 py-3.5'>
            <div className='min-w-0 flex-1'>
              <Eyebrow>Hazard</Eyebrow>
              <h2 className='mt-1 truncate text-lg font-semibold leading-tight'>{combatant.hazard.name}</h2>
              <p className='mt-1 text-xs text-p1-faint'>{combatant.hazard.details.complexity === 'SIMPLE' ? 'Simple' : 'Complex'} · Level {combatant.hazard.level}</p>
            </div>
            <InspectorCollapseButton onCollapse={onCollapse} />
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto p-4'>
            <HazardInspector hazard={combatant.hazard} disabled={combatant.hazard_state?.disabled ?? false} />
          </div>
        </div>
      ) : (
        <div className='flex h-full min-w-0 flex-col'>
<div className='flex items-start gap-3 border-b border-p1-border px-4 py-3.5'><div className='min-w-0 flex-1'><Eyebrow>{combatant.type === 'CREATURE' ? (combatant.ally ? 'NPC / Creature' : 'Creature') : 'Player character'}</Eyebrow><h2 className='mt-1 truncate text-lg font-semibold leading-tight'>{combatant.data?.name}</h2><p className='mt-1 text-xs text-p1-faint'>Level {combatant.data?.level} | {canManageSpells ? 'Spell tracking' : 'Read only'}</p></div>{combatant.type === 'CHARACTER' && combatant.data?.id && <a className='icon-button shrink-0' href={`/sheet/${combatant.data.id}`} target='_blank' rel='noreferrer' title='Open full character sheet'><ExternalLink size={16} /></a>}<InspectorCollapseButton onCollapse={onCollapse} /></div>
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

function NoteSurface({
  campaign,
  note,
  isGm,
  encounterLink,
  onUpdateCampaign,
}: {
  campaign: Campaign | null;
  note: IndexedNotePage | null;
  isGm: boolean;
  encounterLink?: { href: string; name: string };
  onUpdateCampaign: (campaign: Campaign) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const markdown = note ? noteContentsToMarkdown(note.page.contents) : '';

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  function saveDraft(text: string) {
    if (!campaign || !note) return;
    const pages = [...(campaign.notes?.pages ?? [])];
    const current = pages[note.index];
    if (!current) return;
    pages[note.index] = { ...current, contents: text };
    onUpdateCampaign({ ...campaign, notes: { ...campaign.notes, pages } });
  }

  const header = (
    <div className='sticky top-0 z-10 flex items-start gap-2 border-b border-p1-border bg-p1-surface/95 px-5 py-4 backdrop-blur'>
      <div className='min-w-0 flex-1'>
        <Eyebrow>{isGm ? 'Campaign notes' : 'Shared campaign notes'}</Eyebrow>
        <h2 className='mt-1 truncate text-xl font-semibold'>{note ? encounterDisplayName(note.page.name) : 'Note not found'}</h2>
        <p className='mt-1 truncate text-xs text-p1-faint'>{note ? (note.page.shared ? 'Shared with party' : 'Visible to the GM only') : 'This campaign note is unavailable.'}</p>
        {encounterLink && <Link to={encounterLink.href} className='mt-1 block truncate text-xs text-p1-accent hover:underline'>See encounter: {encounterDisplayName(encounterLink.name)}</Link>}
      </div>
      {isGm && note && (
        <button
          type='button'
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          className='grid h-8 w-8 shrink-0 place-items-center text-p1-muted hover:bg-p1-hover hover:text-p1-text'
          onClick={() => setFullscreen((open) => !open)}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      )}
    </div>
  );

  const body = !note ? (
    <div className='p-5'><EmptyState>This campaign note could not be found, or it is not shared with you.</EmptyState></div>
  ) : isGm ? (
    <div className='flex min-h-0 flex-1 flex-col p-5 pt-3'>
      <PlateNotesEditor key={note.index} markdown={markdown} onMarkdownChange={saveDraft} />
    </div>
  ) : markdown ? (
    <div className='p-5'><ProseMarkdown className='max-w-3xl'>{markdown}</ProseMarkdown></div>
  ) : (
    <div className='p-5'><EmptyState>This note is empty.</EmptyState></div>
  );

  const chrome = (
    <div className='flex h-full min-h-0 flex-col'>
      {header}
      {body}
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className='fixed inset-0 z-[100] flex flex-col bg-p1-page p-4'>
        {chrome}
      </div>,
      document.body
    );
  }

  return chrome;
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

function EntityIcon({ type, name, imageUrl }: { type: Combatant['type']; name?: string; imageUrl?: string }) {
  const stored = parseIconValue(imageUrl?.trim() ?? '');
  const portrait = stored.type === 'image' ? stored.value.trim() : '';
  const art = useQuery({
    queryKey: ['phase1-creature-picker-art', name, portrait],
    queryFn: () => lookupMonsterArt(name ?? '', portrait || undefined, 'thumb'),
    enabled: type === 'CREATURE' && Boolean(name?.trim() || portrait),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const src = type === 'CREATURE' ? art.data?.thumbSrc : portrait || undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (type !== 'CREATURE' && stored.type === 'icon' && stored.value) {
    return (
      <span className='grid h-9 w-9 shrink-0 place-items-center border border-p1-pc/50 bg-p1-inset' style={{ color: stored.color || undefined }}>
        <Icon name={stored.value} size={20} />
      </span>
    );
  }
  if (src && !failed) {
    return (
      <img
        key={src}
        src={src}
        alt=''
        className={`h-9 w-9 shrink-0 border border-p1-border bg-p1-inset ${type === 'CHARACTER' ? 'object-cover' : 'object-contain'}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className={`grid h-9 w-9 shrink-0 place-items-center border ${type === 'HAZARD' ? 'border-amber-400/50 text-amber-300' : type === 'CREATURE' ? 'border-p1-creature/50 text-p1-creature' : 'border-p1-pc/50 text-p1-pc'}`}>{type === 'HAZARD' ? <TriangleAlert size={16} /> : type === 'CREATURE' ? <Swords size={16} /> : <UserRound size={16} />}</span>;
}
function CampaignArtPreviewModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
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

  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='campaign-art-title' className='flex max-h-[min(92vh,960px)] w-full max-w-[min(94vw,1100px)] flex-col border border-p1-border bg-p1-surface p-4 shadow-2xl'>
        <h2 id='campaign-art-title' className='mb-3 truncate text-lg font-semibold'>{name}</h2>
        <img src={url} alt={`${name} art`} className='min-h-0 w-full flex-1 object-contain' referrerPolicy='no-referrer' />
        <div className='mt-4 flex justify-end'>
          <button type='button' className='toolbar-button' onClick={onClose}>OK</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function PortraitPreviewModal({
  url,
  name,
  ignoreEscape,
  onChange,
  onClose,
}: {
  url: string;
  name: string;
  ignoreEscape?: boolean;
  onChange: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !ignoreEscape) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, [onClose, ignoreEscape]);

  return createPortal(
    <div
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !ignoreEscape) onClose();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='portrait-preview-title' className='flex max-h-[min(92vh,960px)] w-full max-w-[min(90vw,720px)] flex-col border border-p1-border bg-p1-surface p-4'>
        <h2 id='portrait-preview-title' className='mb-3 truncate text-lg font-semibold'>{name}</h2>
        <img src={url} alt={name} className='min-h-0 w-full flex-1 object-contain' />
        <div className='mt-4 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onChange}>
            Change
          </button>
          <button type='button' className='toolbar-button' onClick={onClose}>
            OK
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
function Eyebrow({ children }: { children: ReactNode }) { return <div className='text-[10px] font-semibold uppercase text-p1-accent'>{children}</div>; }
function EmptyState({ children }: { children: ReactNode }) { return <div className='border border-p1-border p-8 text-center text-sm text-p1-muted'>{children}</div>; }
function ErrorState({ error }: { error: Error }) { return <div className='border border-p1-danger/40 bg-p1-danger/10 p-4 text-sm text-p1-danger-soft'>{error.message}</div>; }
function PageError({ error }: { error: Error }) { return <div className='min-h-screen bg-p1-page p-8 text-p1-text'><Link to='/phase1' className='text-sm text-p1-accent'>Back to campaigns</Link><div className='mt-6 max-w-xl'><ErrorState error={error} /></div></div>; }
function LoadingScreen({ label }: { label: string }) { return <div className='grid min-h-screen place-items-center bg-p1-page text-sm text-p1-muted'>{label}...</div>; }

function hazardLivingStub(hazard: Hazard): LivingEntity {
  return {
    name: hazard.name,
    level: hazard.level,
    experience: 0,
    inventory: null,
    hp_current: hazard.details.defenses?.hp ?? 0,
    hp_temp: 0,
    stamina_current: 0,
    resolve_current: 0,
    details: null,
    notes: null,
    roll_history: null,
    spells: null,
    operation_data: null,
    meta_data: null,
  };
}

function encounterWithAllPlayers(encounter: Encounter, players: Character[]): Encounter | null {
  const present = new Set(
    encounter.combatants.list
      .filter((item) => item.type === 'CHARACTER')
      .map((item) => numericId(item.character))
      .filter((id): id is number => id != null),
  );
  const missing = players.filter((player) => !present.has(numericId(player.id) ?? player.id));
  if (missing.length === 0) return null;
  const list: Combatant[] = [
    ...encounter.combatants.list,
    ...missing.map((player) => ({
      _id: crypto.randomUUID(),
      type: 'CHARACTER' as const,
      ally: true,
      initiative: undefined,
      character: player.id,
      data: undefined,
    })),
  ];
  const allies = populateCombatants(list, players).filter((combatant) => combatant.ally);
  const levels = allies.map((combatant) => combatant.data.level).filter(Number.isFinite);
  return {
    ...encounter,
    combatants: { list },
    meta_data: mergeEncounterMeta(encounter.meta_data, {}, {
      party_size: allies.length,
      party_level: levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0,
    }),
  };
}

function populateCombatants(combatants: Combatant[], players: Character[]): PopulatedCombatant[] {
  const populated: PopulatedCombatant[] = [];
  for (const combatant of combatants) {
    if (isHazardCombatant(combatant)) {
      populated.push({
        ...combatant,
        ally: false,
        data: hazardLivingStub(combatant.hazard),
        access: { can_edit: false, details_revealed: true },
      });
      continue;
    }
    const characterId = numericId(combatant.character);
    const data = combatant.type === 'CHARACTER' ? players.find((player) => numericId(player.id) === characterId) ?? combatant.data : combatant.creature ?? combatant.data;
    if (!data) continue;
    const allied = combatant.type === 'CHARACTER' || combatant.ally === true;
    const access = (combatant as Combatant & { access?: { can_edit?: boolean; details_revealed?: boolean } }).access;
    populated.push({
      ...combatant,
      ally: allied,
      data,
      access: {
        can_edit: access?.can_edit ?? false,
        details_revealed: allied || access?.details_revealed !== false,
      },
    });
  }
  return populated;
}
function EncounterListRow({ encounter, onOpen, onChanged }: { encounter: Encounter; onOpen: () => void; onChanged: () => void }) {
  const counts = encounterSideCounts(encounter);
  const displayName = encounterDisplayName(encounter.name);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingRename, setPendingRename] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setActionError(null);
    setMenu({ x: event.clientX, y: event.clientY });
  }

  async function confirmRename(name: string) {
    const nextName = encounterDisplayName(name.trim());
    if (!nextName || nextName === displayName || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await phase1Request('create-encounter', { ...encounter, name: nextName });
      setPendingRename(false);
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not rename encounter.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await phase1Request('delete-content', { id: encounter.id, type: 'encounter' });
      setPendingDelete(false);
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete encounter.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className='cursor-pointer hover:bg-p1-hover' onClick={onOpen} onContextMenu={openMenu}>
        <td className='px-4 py-4 font-medium'>
          {displayName}
          {actionError && <div className='mt-1 text-xs font-normal text-p1-danger-soft'>{actionError}</div>}
        </td>
        <td className='px-4 py-4 text-p1-muted'>{counts.pcs}</td>
        <td className='px-4 py-4 text-p1-muted'>{counts.enemies}</td>
      </tr>
      {menu && (
        <RailContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => {
            setMenu(null);
            setPendingRename(true);
          }}
          onDelete={() => {
            setMenu(null);
            setPendingDelete(true);
          }}
        />
      )}
      {pendingRename && (
        <RenameDialog
          title='Rename encounter'
          initialName={displayName}
          onCancel={() => {
            if (!busy) setPendingRename(false);
          }}
          onConfirm={(name) => { void confirmRename(name); }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title='Delete encounter'
          message={`Are you sure you want to delete "${displayName}"?`}
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          onCancel={() => {
            if (!busy) setPendingDelete(false);
          }}
          onConfirm={() => { void confirmDelete(); }}
        />
      )}
    </>
  );
}

const CAMPAIGN_ART_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function artPanelStyle(rect: DOMRect): { top: number; left: number } {
  const width = 288;
  const height = 220;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
  return { top, left };
}

async function shrinkCampaignArt(file: File): Promise<File> {
  const maxBytes = 700_000;
  const bitmap = await createImageBitmap(file);
  let edge = Math.min(1600, Math.max(bitmap.width, bitmap.height));
  let blob: Blob | null = null;
  while (edge >= 480) {
    const scale = edge / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
    canvas.height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));
    const context = canvas.getContext('2d');
    if (!context) break;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let quality = 0.8;
    while (quality >= 0.4) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) {
        bitmap.close();
        return new File([blob], 'campaign-art.jpg', { type: 'image/jpeg' });
      }
      quality -= 0.1;
    }
    edge = Math.round(edge * 0.75);
  }
  bitmap.close();
  if (blob && blob.size < file.size) return new File([blob], 'campaign-art.jpg', { type: 'image/jpeg' });
  return file;
}

function normalizeArtLink(raw: string): string {
  const cleaned = raw.trim().replace(/&amp;/g, '&').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const match = cleaned.match(/https?:\/\/\S+/i);
  return (match ? match[0] : cleaned).replace(/[)>"'`\],.;]+$/, '');
}

function sniffImageType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'image/avif';
  return '';
}

function pushArtCandidate(list: string[], value: string | null | undefined) {
  const next = value?.trim();
  if (!next || !/^https?:\/\//i.test(next) || list.includes(next)) return;
  list.push(next);
}

/** Public link shapes that point at a page, a resized CDN copy, or a hotlink wrapper instead of the file. */
function artCandidateUrls(raw: string): string[] {
  const list: string[] = [];
  pushArtCandidate(list, raw);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return list;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const path = parsed.pathname;

  if (host === 'imgur.com' || host === 'm.imgur.com') {
    const id = path.match(/^\/(?:a\/|gallery\/)?([A-Za-z0-9]+)/)?.[1];
    if (id && id !== 'a') {
      for (const ext of ['jpg', 'png', 'jpeg', 'webp', 'gif']) pushArtCandidate(list, `https://i.imgur.com/${id}.${ext}`);
    }
  }
  if (host === 'i.imgur.com') {
    const bare = path.replace(/\.(png|jpe?g|gif|webp)$/i, '');
    for (const ext of ['jpg', 'png', 'jpeg', 'webp']) pushArtCandidate(list, `https://i.imgur.com${bare}.${ext}`);
  }

  if (host.endsWith('dropbox.com')) {
    const direct = new URL(parsed);
    direct.hostname = 'dl.dropboxusercontent.com';
    direct.searchParams.set('dl', '1');
    pushArtCandidate(list, direct.toString());
    parsed.searchParams.set('dl', '1');
    parsed.searchParams.delete('raw');
    pushArtCandidate(list, parsed.toString());
  }

  if (host === 'drive.google.com') {
    const id = path.match(/\/file\/d\/([^/]+)/)?.[1] ?? parsed.searchParams.get('id');
    if (id) pushArtCandidate(list, `https://drive.google.com/uc?export=view&id=${id}`);
  }
  if (host === 'photos.google.com' || host.endsWith('googleusercontent.com') || host.endsWith('ggpht.com')) {
    pushArtCandidate(list, raw.replace(/=(?:w|h|s)\d+[^/?#]*$/, '=s0'));
  }

  if (host === 'preview.redd.it') pushArtCandidate(list, `https://i.redd.it${path}`);
  if (host.endsWith('reddit.com') && path.includes('/preview.redd.it/')) {
    pushArtCandidate(list, raw.replace(/https?:\/\/[^/]*reddit\.com\/media\?url=/, ''));
  }

  if (host === 'media.discordapp.net') pushArtCandidate(list, raw.replace('media.discordapp.net', 'cdn.discordapp.com'));
  if (host === 'cdn.discordapp.com') pushArtCandidate(list, raw.replace('cdn.discordapp.com', 'media.discordapp.net'));

  const wikiFile = path.match(/\/(?:wiki|w)\/(?:File|Image):(.+)$/i)?.[1];
  if (wikiFile && (host.endsWith('wikipedia.org') || host.endsWith('wikimedia.org'))) {
    pushArtCandidate(list, `https://commons.wikimedia.org/wiki/Special:FilePath/${wikiFile}`);
  }
  if (host.endsWith('pinimg.com')) {
    pushArtCandidate(list, `${parsed.origin}${path.replace(/\/\d+x(?:\d+)?\//, '/originals/')}`);
  }
  if (/-\d+x\d+(?=\.(?:png|jpe?g|webp|gif|avif)$)/i.test(path)) {
    pushArtCandidate(list, `${parsed.origin}${path.replace(/-\d+x\d+(?=\.(?:png|jpe?g|webp|gif|avif)$)/i, '')}${parsed.search}`);
  }

  const withoutTracking = new URL(parsed);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid'].forEach((key) => withoutTracking.searchParams.delete(key));
  pushArtCandidate(list, withoutTracking.toString());
  return list.slice(0, 12);
}

function imageUrlsFromHtml(html: string, base: string): string[] {
  const found: string[] = [];
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["']/gi,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/gi,
    /<img[^>]+(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try {
        pushArtCandidate(found, new URL(match[1], base).toString());
      } catch {
        // Skip a relative URL the page did not resolve.
      }
    }
  }
  return found.slice(0, 6);
}

async function fetchArtBlob(url: string, depth = 0): Promise<File | null> {
  const attempts: RequestInit[] = [
    { mode: 'cors', referrerPolicy: 'no-referrer' },
    { mode: 'cors', referrerPolicy: 'origin' },
    { mode: 'cors', referrerPolicy: 'no-referrer-when-downgrade' },
    { mode: 'cors', credentials: 'omit' },
  ];
  for (const init of attempts) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) continue;
      const blob = await response.blob();
      if (blob.size === 0) continue;
      const header = blob.type.split(';')[0].trim().toLowerCase();
      if (header.startsWith('text/html') && depth === 0) {
        const html = await blob.text();
        for (const nested of imageUrlsFromHtml(html, response.url || url)) {
          if (nested === url) continue;
          const inner = await fetchArtBlob(nested, depth + 1);
          if (inner) return inner;
        }
        continue;
      }
      let type = header.startsWith('image/') ? header : '';
      if (!type || type === 'image/svg+xml' || type === 'application/octet-stream') {
        const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        const sniffed = sniffImageType(head);
        if (sniffed) type = sniffed;
      }
      if (!type.startsWith('image/') || type === 'image/svg+xml') continue;
      return new File([blob], 'campaign-art', { type });
    } catch {
      continue;
    }
  }
  return null;
}

async function downloadArtFile(url: string): Promise<File | null> {
  const seen = new Set<string>();
  for (const candidate of artCandidateUrls(url)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const file = await fetchArtBlob(candidate);
    if (file) return file;
  }
  return null;
}

function campaignArtFile(file: File | null): File | null {
  if (!file) return null;
  const named = file.type.startsWith('image/')
    ? file.type
    : /\.png$/i.test(file.name)
      ? 'image/png'
      : /\.jpe?g$/i.test(file.name)
        ? 'image/jpeg'
        : /\.webp$/i.test(file.name)
          ? 'image/webp'
          : '';
  if (!named.startsWith('image/')) return null;
  if (named === file.type) return file;
  return new File([file], file.name || 'campaign-art', { type: named });
}

function CampaignArtControl({ campaign, onSaved, onFrame, onUploaded, onFrameError, requestOpen = 0 }: { campaign: Campaign; onSaved: () => void; onFrame: (url: string) => void; onUploaded: (url: string) => void; onFrameError: (message: string) => void; requestOpen?: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const blockArtClick = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (requestOpen > 0) setOpen(true);
  }, [requestOpen]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkText, setLinkText] = useState('');
  const [pastePreview, setPastePreview] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const hasArt = Boolean(campaign.meta_data?.image_url?.trim());
  const savedArt = useCampaignArtSrc(campaign.meta_data?.image_url?.trim());

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onWindowPaste(event: ClipboardEvent) {
      const text = event.clipboardData?.getData('text/plain').trim() ?? '';
      if (/^https?:\/\//i.test(text)) {
        setLinkText(text);
        if (event.target === panelRef.current) {
          event.preventDefault();
          void saveImageUrl(text);
        }
        return;
      }
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      setPastePreview((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(file);
      });
      void saveArt(file);
    }
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [open]);

  async function saveArt(file: File) {
    const accepted = campaignArtFile(file);
    if (!accepted) {
      setError('Use a PNG, JPEG, or WebP image.');
      return;
    }
    if (accepted.size > 3 * 1024 * 1024) {
      setError('Image must be 3 MB or smaller.');
      return;
    }
    const blobUrl = URL.createObjectURL(accepted);
    setError(null);
    setOpen(false);
    onFrame(blobUrl);
    setBusy(true);
    try {
      const uploadFile = await shrinkCampaignArt(accepted);
      const url = await uploadImage(uploadFile, 'backgrounds');
      if (!url) throw new Error('Upload failed.');
      await phase1Request('create-campaign', {
        ...campaign,
        meta_data: { ...campaign.meta_data, image_url: url },
      });
      onUploaded(url);
      onSaved();
    } catch (cause) {
      onFrameError(cause instanceof Error ? cause.message : 'Could not save campaign art.');
    } finally {
      setBusy(false);
    }
  }

  async function clearArt() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await phase1Request('create-campaign', {
        ...campaign,
        meta_data: { ...campaign.meta_data, image_url: '' },
      });
      setOpen(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear campaign art.');
    } finally {
      setBusy(false);
    }
  }

  async function copyArtLink(url: string) {
    await phase1Request('create-campaign', {
      ...campaign,
      meta_data: { ...campaign.meta_data, image_url: url },
    });
    setOpen(false);
    onFrame(url);
    onUploaded(url);
    onSaved();
  }

  async function saveImageUrl(raw: string) {
    const url = normalizeArtLink(raw);
    if (!/^https?:\/\//i.test(url)) {
      setError('Paste an http or https image link.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const downloaded = await downloadArtFile(url);
      const accepted = campaignArtFile(downloaded);
      if (accepted) {
        let stored: File = accepted;
        if (accepted.size > 3 * 1024 * 1024) {
          try {
            stored = await shrinkCampaignArt(accepted);
          } catch {
            stored = accepted;
          }
        }
        if (stored.size <= 3 * 1024 * 1024) {
          try {
            await writeTempArt(url, stored);
            rememberTempArt(url, stored);
          } catch {
            // The band can still use the in-memory copy for this session.
          }
          const blobUrl = tempArtUrls.get(url) ?? URL.createObjectURL(stored);
          setOpen(false);
          onFrame(blobUrl);
          try {
            const hosted = await uploadImage(stored, 'backgrounds');
            if (!hosted) throw new Error('Upload failed.');
            await phase1Request('create-campaign', {
              ...campaign,
              meta_data: { ...campaign.meta_data, image_url: hosted },
            });
            onUploaded(hosted);
            onSaved();
            await forgetTempArt(url).catch(() => undefined);
            return;
          } catch {
            // Keep the temp file and the original link. The picture stays on the local copy.
          }
          await phase1Request('create-campaign', {
            ...campaign,
            meta_data: { ...campaign.meta_data, image_url: url },
          });
          onUploaded(url);
          onSaved();
          return;
        }
      }
      await copyArtLink(url);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not use that image link.';
      setError(message);
      onFrameError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='relative' onClick={(event) => event.stopPropagation()}>
      <button
        ref={buttonRef}
        type='button'
        className='toolbar-button'
        title='Set campaign art from an image link'
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          if (blockArtClick.current) return;
          setError(null);
          setOpen((current) => !current);
        }}
      >
        <ImageIcon size={14} />
        Art
      </button>
      {open && buttonRef.current && createPortal(
        <>
          <div className='fixed inset-0 z-[350]' onMouseDown={() => { if (!busy) setOpen(false); }} />
          <div
            ref={panelRef}
            tabIndex={-1}
            className='fixed z-[360] w-72 border border-p1-border bg-p1-surface p-3 text-left shadow-lg outline-none'
            style={artPanelStyle(buttonRef.current.getBoundingClientRect())}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
          <p className='text-xs text-p1-muted'>Paste an image, or type a direct image link.</p>
          <div
            className='mt-2 flex h-16 w-full items-center justify-center overflow-hidden border border-dashed border-p1-border bg-p1-inset text-[10px] uppercase tracking-wide text-p1-faint'
            onMouseDown={(event) => {
              event.preventDefault();
              panelRef.current?.focus();
            }}
          >
            {pastePreview ? (
              <img src={pastePreview} alt='' className='h-full w-full object-cover' />
            ) : (
              'Paste'
            )}
          </div>
          <label className='mt-2 block'>
            <span className='text-[10px] uppercase text-p1-faint'>Image URL</span>
            <input
              className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-sm text-p1-text outline-none focus:border-p1-accent/60'
              value={linkText}
              placeholder='https://'
              disabled={busy}
              onChange={(event) => setLinkText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveImageUrl(linkText.trim());
                }
              }}
            />
          </label>
          <div className='mt-2 flex flex-wrap gap-2'>
            <button
              type='button'
              className='toolbar-button'
              disabled={busy || !/^https?:\/\//i.test(linkText.trim())}
              onClick={() => void saveImageUrl(linkText.trim())}
            >
              {busy ? 'Saving…' : 'Use link'}
            </button>
            {/* Local file pick is off for now. URL links only.
            <label className={`toolbar-button${busy ? ' pointer-events-none opacity-50' : ''}`}>
              Choose file
              <input
                ref={fileRef}
                type='file'
                accept='image/png,image/jpeg,image/webp,image/*'
                className='sr-only'
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  blockArtClick.current = true;
                  window.setTimeout(() => {
                    blockArtClick.current = false;
                  }, 700);
                  void saveArt(file);
                }}
              />
            </label>
            */}
            <button type='button' className='toolbar-button' disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            {hasArt && (
              <button
                type='button'
                className='toolbar-button'
                disabled={busy}
                onClick={() => {
                  const url = campaign.meta_data?.image_url?.trim();
                  if (!url) return;
                  setOpen(false);
                  onFrame(savedArt || url);
                  onUploaded(url);
                }}
              >
                Adjust band
              </button>
            )}
            {hasArt && (
              <button type='button' className='toolbar-button' disabled={busy} onClick={() => setConfirmClear(true)}>
                Clear
              </button>
            )}
          </div>
          {error && <p className='mt-2 text-xs text-p1-danger-soft'>{error}</p>}
          </div>
        </>,
        document.body
      )}
      {confirmClear && (
        <ConfirmDialog
          title='Remove campaign art'
          message={`Remove the artwork from "${campaign.name}"?`}
          confirmLabel={busy ? 'Removing…' : 'Remove art'}
          onCancel={() => {
            if (!busy) setConfirmClear(false);
          }}
          onConfirm={() => {
            setConfirmClear(false);
            void clearArt();
          }}
        />
      )}
    </div>
  );
}

function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const fromItems = Array.from(data.items)
    .map((entry) => (entry.type.startsWith('image/') ? entry.getAsFile() : null))
    .find((entry): entry is File => Boolean(entry));
  if (fromItems) return fromItems;
  return Array.from(data.files).find((entry) => entry.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(entry.name)) ?? null;
}

const TEMP_ART_DB = 'wg-campaign-art';
const TEMP_ART_STORE = 'temp';
const tempArtUrls = new Map<string, string>();
const tempArtListeners = new Set<() => void>();
const tempArtFailed = new Set<string>();

function notifyTempArt() {
  tempArtListeners.forEach((listener) => listener());
}

function openTempArtDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TEMP_ART_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(TEMP_ART_STORE)) request.result.createObjectStore(TEMP_ART_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeTempArt(sourceUrl: string, blob: Blob) {
  const db = await openTempArtDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TEMP_ART_STORE, 'readwrite');
    tx.objectStore(TEMP_ART_STORE).put(blob, sourceUrl);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readTempArt(sourceUrl: string): Promise<Blob | null> {
  const db = await openTempArtDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(TEMP_ART_STORE, 'readonly');
    const request = tx.objectStore(TEMP_ART_STORE).get(sourceUrl);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

async function forgetTempArt(sourceUrl: string) {
  const current = tempArtUrls.get(sourceUrl);
  if (current) URL.revokeObjectURL(current);
  tempArtUrls.delete(sourceUrl);
  const db = await openTempArtDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TEMP_ART_STORE, 'readwrite');
    tx.objectStore(TEMP_ART_STORE).delete(sourceUrl);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function rememberTempArt(sourceUrl: string, blob: Blob) {
  const current = tempArtUrls.get(sourceUrl);
  if (current) URL.revokeObjectURL(current);
  tempArtUrls.set(sourceUrl, URL.createObjectURL(blob));
  tempArtFailed.delete(sourceUrl);
  notifyTempArt();
}

async function rescueTempArt(sourceUrl: string) {
  if (tempArtUrls.has(sourceUrl) || tempArtFailed.has(sourceUrl)) return;
  tempArtFailed.add(sourceUrl);
  const downloaded = await downloadArtFile(sourceUrl);
  const accepted = campaignArtFile(downloaded);
  if (!accepted) return;
  let stored: Blob = accepted;
  if (accepted.size > 3 * 1024 * 1024) {
    try {
      stored = await shrinkCampaignArt(accepted);
    } catch {
      return;
    }
  }
  if (stored.size > 3 * 1024 * 1024) return;
  await writeTempArt(sourceUrl, stored);
  rememberTempArt(sourceUrl, stored);
}

/** Dev pages talk to Kong through the Vite origin. Upload returns :8000, which the image tag cannot reach. */
function campaignArtSrc(url: string): string {
  const temp = tempArtUrls.get(url);
  if (temp) return temp;
  if (!import.meta.env.DEV || typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url, window.location.origin);
    const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === 'kong';
    if (!localHost || !parsed.pathname.startsWith('/storage/')) return url;
    return window.location.origin + parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function useCampaignArtSrc(url: string | undefined): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    tempArtListeners.add(bump);
    return () => {
      tempArtListeners.delete(bump);
    };
  }, []);
  useEffect(() => {
    if (!url || tempArtUrls.has(url)) return;
    let cancel = false;
    void readTempArt(url)
      .then((blob) => {
        if (cancel || !blob) return;
        rememberTempArt(url, blob);
      })
      .catch(() => undefined);
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.onload = () => undefined;
    image.onerror = () => {
      if (!cancel) void rescueTempArt(url).catch(() => undefined);
    };
    image.src = campaignArtSrc(url);
    return () => {
      cancel = true;
    };
  }, [url]);
  return url ? campaignArtSrc(url) : '';
}

function CampaignStripArt({ url, focusY }: { url: string; focusY: number }) {
  const src = useCampaignArtSrc(url);
  return <img src={src} alt='' referrerPolicy='no-referrer' loading='lazy' decoding='async' style={{ ['--campaign-art-focus' as string]: `${focusY}%` }} />;
}

function campaignFocusY(value?: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(100, Math.max(0, parsed));
}

function CampaignStripDialog({ url, initial, busy, error, onCancel, onConfirm }: { url: string; initial: number; busy: boolean; error?: string; onCancel: () => void; onConfirm: (focusY: number) => void }) {
  const [focusY, setFocusY] = useState(initial);
  const [band, setBand] = useState(18);
  const [frameHeight, setFrameHeight] = useState(420);
  const [imageFailed, setImageFailed] = useState(false);
  const allowDismiss = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      allowDismiss.current = true;
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);

  function measureBand(event: React.SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    setFrameHeight(image.clientHeight || image.offsetHeight || 420);
    if (!image.naturalWidth || !image.naturalHeight) return;
    const rowAspect = 88 / 720;
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const visible = Math.min(100, Math.max(8, (rowAspect / imageAspect) * 100));
    setBand(visible);
  }

  const bandTop = Math.min(100 - band, Math.max(0, focusY - band / 2));

  function focusFromPointer(clientY: number) {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = (clientY - rect.top) / rect.height;
    setFocusY(Math.min(100, Math.max(0, ratio * 100)));
  }

  function onBandPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    focusFromPointer(event.clientY);
  }

  return createPortal(
    <div
      className='fixed inset-0 z-[400] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (!allowDismiss.current || busy) return;
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='campaign-strip-title' className='w-full max-w-6xl border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='campaign-strip-title' className='text-lg font-semibold'>Choose the band</h2>
        <p className='mt-1 text-sm text-p1-muted'>Drag the band up and down, or use the slider.</p>
        {error && <p className='mt-2 text-sm text-p1-danger-soft'>{error}</p>}
        <div className='mt-4 flex items-start justify-center gap-3'>
          <div ref={frameRef} className='relative w-full overflow-hidden border border-p1-border'>
            {imageFailed ? (
              <div className='flex h-[420px] items-center justify-center text-sm text-p1-muted'>Cannot load image.</div>
            ) : (
              <img src={url} alt='' referrerPolicy='no-referrer' className='block max-h-[72vh] w-full object-contain' onLoad={measureBand} onError={() => setImageFailed(true)} />
            )}
            <div
              className='absolute inset-x-0 cursor-ns-resize border-y-2 border-white/90 bg-white/15'
              style={{ top: `${bandTop}%`, height: `${band}%` }}
              onPointerDown={onBandPointerDown}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) focusFromPointer(event.clientY);
              }}
            />
          </div>
          <input
            type='range'
            min={0}
            max={100}
            aria-label='Band position'
            value={focusY}
            className='w-8 cursor-pointer'
            style={{ writingMode: 'vertical-lr', direction: 'rtl', height: frameHeight }}
            onChange={(event) => setFocusY(Number(event.target.value))}
          />
        </div>
        <div className='relative mt-4 flex h-[5.5rem] items-center overflow-hidden border border-p1-border px-3 text-sm text-p1-muted'>
          {imageFailed ? 'Cannot load image.' : <img src={url} alt='' referrerPolicy='no-referrer' className='absolute inset-0 h-full w-full object-cover' style={{ objectPosition: `center ${focusY}%` }} onError={() => setImageFailed(true)} />}
        </div>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' disabled={busy} onClick={onCancel}>Cancel</button>
          <button type='button' className='toolbar-button' disabled={busy} onClick={() => onConfirm(focusY)}>{busy ? 'Saving…' : 'Use band'}</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function normalizeRowColor(value?: string | null): string {
  const color = value?.trim() ?? '';
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : '';
}

function campaignHasRowArt(campaign?: Campaign): boolean {
  if (!campaign) return false;
  return Boolean(campaign.meta_data?.image_url?.trim() || normalizeRowColor(campaign.meta_data?.row_color));
}

function CampaignColorDialog({ initial, busy, canClear, onCancel, onConfirm, onClear }: { initial: string; busy: boolean; canClear: boolean; onCancel: () => void; onConfirm: (color: string) => void; onClear: () => void }) {
  const [color, setColor] = useState(initial);
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);
  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='campaign-color-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='campaign-color-title' className='text-lg font-semibold'>Pick for color</h2>
        <p className='mt-1 text-sm text-p1-muted'>This color replaces the campaign image on the row.</p>
        <input
          type='color'
          aria-label='Row color'
          className='mt-4 h-40 w-full cursor-pointer border border-p1-border bg-transparent'
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
        <div className='mt-5 flex justify-end gap-2'>
          {canClear && (
            <button type='button' className='toolbar-button mr-auto' disabled={busy} onClick={onClear}>Clear color</button>
          )}
          <button type='button' className='toolbar-button' disabled={busy} onClick={onCancel}>Cancel</button>
          <button type='button' className='toolbar-button' disabled={busy} onClick={() => onConfirm(color)}>Use color</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function CampaignWorkspaceRow({ campaign, canDelete, members, ownedCampaigns, onOpen, onDeleted, onFrame, onUploaded, onFrameError }: { campaign: Campaign; canDelete: boolean; members: Character[]; ownedCampaigns: Campaign[]; onOpen: () => void; onDeleted: () => void; onFrame: (url: string) => void; onUploaded: (url: string) => void; onFrameError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [leaveMenu, setLeaveMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingRename, setPendingRename] = useState(false);
  const [pendingColor, setPendingColor] = useState(false);
  const [viewArt, setViewArt] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [characterMenu, setCharacterMenu] = useState<{ character: Character; x: number; y: number } | null>(null);
  const [assignPicker, setAssignPicker] = useState<Character | null>(null);
  const [joinOtherPicker, setJoinOtherPicker] = useState<Character | null>(null);
  const [joinResult, setJoinResult] = useState<{ title: string; message: string } | null>(null);
  const [pendingCharRename, setPendingCharRename] = useState<Character | null>(null);
  const [pendingCharDelete, setPendingCharDelete] = useState<{ id: number; name: string } | null>(null);
  const hasKey = Boolean(campaign.join_key);

  async function revealAndCopy(event: ReactMouseEvent) {
    event.stopPropagation();
    if (!campaign.join_key) return;
    setVisible(true);
    setCopyState((await copyJoinKey(campaign.join_key)) ? 'copied' : 'failed');
  }

  function openMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setActionError(null);
    if (canDelete) {
      setMenu({ x: event.clientX, y: event.clientY });
      return;
    }
    setLeaveMenu({ x: event.clientX, y: event.clientY });
  }

  function openCharacterMenu(event: ReactMouseEvent, character: Character) {
    event.preventDefault();
    event.stopPropagation();
    setActionError(null);
    setCharacterMenu({ character, x: event.clientX, y: event.clientY });
  }

  async function refreshCharacters() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['phase1-characters'] }),
      queryClient.invalidateQueries({ queryKey: ['phase1-campaigns'] }),
    ]);
  }

  async function exportRosterCharacter(kind: 'json' | 'pdf', source: Character) {
    setActionError(null);
    try {
      const result = await phase1Request<Character | Character[]>('find-character', { id: source.id });
      const loaded = Array.isArray(result) ? result[0] : result;
      if (!loaded) throw new Error('Could not load character for export.');
      if (kind === 'json') {
        try {
          await exportToJSON(loaded);
        } catch (error) {
          console.error(error);
          downloadObjectAsJson({ version: 4, character: loaded }, characterExportFileStem(loaded.name));
        }
        return;
      }
      await exportToPDF(loaded);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : kind === 'json' ? 'JSON export failed.' : 'PDF export failed.');
    }
  }

  async function unassignRosterCharacter(target: Character) {
    if (numericId(target.campaign_id) == null) return;
    if (canDelete) {
      await phase1Request('remove-from-campaign', { character_id: target.id, campaign_id: target.campaign_id });
    } else {
      await phase1Request('update-character', { id: target.id, campaign_id: null });
    }
    await refreshCharacters();
  }

  async function confirmLeave() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      for (const member of members) {
        await phase1Request('update-character', { id: member.id, campaign_id: null });
      }
      setPendingLeave(false);
      await queryClient.invalidateQueries({ queryKey: ['phase1-characters'] });
      onDeleted();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not remove characters from the campaign.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRename(name: string) {
    const nextName = name.trim();
    if (!nextName || nextName === campaign.name || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await phase1Request('create-campaign', { ...campaign, name: nextName });
      setPendingRename(false);
      onDeleted();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not rename campaign.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await phase1Request('delete-content', { id: campaign.id, type: 'campaign' });
      setPendingDelete(false);
      onDeleted();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete campaign.');
    } finally {
      setBusy(false);
    }
  }

  const artUrl = campaign.meta_data?.image_url?.trim();
  const shownArt = useCampaignArtSrc(artUrl);
  const focusY = campaignFocusY(campaign.meta_data?.image_focus_y);
  const rowColor = normalizeRowColor(campaign.meta_data?.row_color);
  const showStrip = Boolean(rowColor || artUrl);

  async function saveRowColor(color: string) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await phase1Request('create-campaign', {
        ...campaign,
        meta_data: { ...campaign.meta_data, row_color: color },
      });
      setPendingColor(false);
      onDeleted();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save row color.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`p1-char-row group grid min-h-[5.5rem] w-full grid-cols-[1fr_auto] items-center gap-6 px-2 py-4${showStrip ? ' p1-char-row-has-art' : ''}`} onContextMenu={openMenu}>
      {showStrip && (
        <div className='p1-char-row-art' aria-hidden>
          {artUrl ? (
            <CampaignStripArt url={artUrl} focusY={focusY} />
          ) : (
            <div className='h-full w-full' style={{ backgroundColor: rowColor }} />
          )}
          <div className='p1-char-row-art-veil' />
        </div>
      )}
      <button type='button' className='min-w-0 text-left' onClick={onOpen} onContextMenu={openMenu}>
        <div className='font-semibold'>{campaign.name}</div>
        <div className='mt-1 line-clamp-1 text-sm text-p1-muted'>{campaign.description || 'No campaign description'}</div>
        {actionError && <div className='mt-1 text-xs text-p1-danger-soft'>{actionError}</div>}
      </button>
      <div className='flex items-center gap-2'>
        {canDelete && <CampaignArtControl campaign={campaign} onSaved={onDeleted} onFrame={onFrame} onUploaded={onUploaded} onFrameError={onFrameError} />}
        {hasKey && (
          <button type='button' className='toolbar-button' title='Reveal and copy join key' onClick={revealAndCopy}>
            {copyState === 'copied' ? <Check size={14} /> : visible ? <Copy size={14} /> : <KeyRound size={14} />}
            <span className={visible ? 'font-mono' : ''}>{visible ? campaign.join_key : 'Copy key'}</span>
          </button>
        )}
        {members.length > 0 && (
          <span className='flex items-center gap-1'>
            {members.map((member) => {
              const imageUrl = member.details?.image_url?.trim();
              return imageUrl ? (
                <a key={member.id} href={`/sheet/${member.id}`} title={member.name} className='block h-14 w-14 overflow-hidden border border-p1-border hover:border-p1-accent/60' onContextMenu={(event) => openCharacterMenu(event, member)}>
                  <img src={imageUrl} alt='' className='h-full w-full object-cover' />
                </a>
              ) : (
                <a key={member.id} href={`/sheet/${member.id}`} title={member.name} className='grid h-14 w-14 place-items-center border border-p1-border bg-p1-inset text-p1-faint hover:border-p1-accent/60 hover:text-p1-muted' onContextMenu={(event) => openCharacterMenu(event, member)}>
                  <User size={22} />
                </a>
              );
            })}
          </span>
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
          onRename={() => {
            setMenu(null);
            setPendingRename(true);
          }}
          onViewArt={artUrl ? () => {
            setMenu(null);
            setViewArt(true);
          } : undefined}
          onPickColor={() => {
            setMenu(null);
            setPendingColor(true);
          }}
          onClearColor={rowColor ? () => {
            setMenu(null);
            void saveRowColor('');
          } : undefined}
          onDelete={() => {
            setMenu(null);
            setPendingDelete(true);
          }}
        />
      )}
      {viewArt && artUrl && (
        <CampaignArtPreviewModal
          url={shownArt}
          name={campaign.name}
          onClose={() => setViewArt(false)}
        />
      )}
      {pendingRename && (
        <RenameDialog
          title='Rename campaign'
          initialName={campaign.name}
          onCancel={() => {
            if (!busy) setPendingRename(false);
          }}
          onConfirm={(name) => { void confirmRename(name); }}
        />
      )}
      {pendingColor && (
        <CampaignColorDialog
          initial={rowColor || '#5c6b4a'}
          busy={busy}
          canClear={Boolean(rowColor)}
          onCancel={() => {
            if (!busy) setPendingColor(false);
          }}
          onConfirm={(color) => { void saveRowColor(color); }}
          onClear={() => { void saveRowColor(''); }}
        />
      )}
      {leaveMenu && (
        <RailContextMenu
          x={leaveMenu.x}
          y={leaveMenu.y}
          onClose={() => setLeaveMenu(null)}
          onViewArt={artUrl ? () => {
            setLeaveMenu(null);
            setViewArt(true);
          } : undefined}
          removeLabel={members.length > 1 ? 'Remove all PCs from campaign' : 'Remove from campaign'}
          onRemove={() => {
            setLeaveMenu(null);
            setPendingLeave(true);
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title='Delete campaign'
          message={`Are you sure you want to delete "${campaign.name}"? This cannot be undone.`}
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          onCancel={() => {
            if (!busy) setPendingDelete(false);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {pendingLeave && (
        <ConfirmDialog
          title={members.length > 1 ? 'Remove all PCs from campaign' : 'Remove from campaign'}
          message={members.length > 0
            ? `${members.map((member) => member.name).join(', ')} will leave "${campaign.name}". Character sheets stay.`
            : `Leave "${campaign.name}"? Character sheets stay.`}
          confirmLabel={busy ? 'Removing…' : members.length > 1 ? 'Remove all PCs from campaign' : 'Remove from campaign'}
          onCancel={() => {
            if (!busy) setPendingLeave(false);
          }}
          onConfirm={() => void confirmLeave()}
        />
      )}
      {characterMenu && (
        <CharacterGridContextMenu
          x={characterMenu.x}
          y={characterMenu.y}
          onClose={() => setCharacterMenu(null)}
          onJoinMyCampaign={() => {
            const target = characterMenu.character;
            setCharacterMenu(null);
            setAssignPicker(target);
          }}
          onJoinOthersCampaign={() => {
            const target = characterMenu.character;
            setCharacterMenu(null);
            setJoinOtherPicker(target);
          }}
          onUnassign={
            numericId(characterMenu.character.campaign_id) == null
              ? undefined
              : () => {
                  const target = characterMenu.character;
                  setCharacterMenu(null);
                  void unassignRosterCharacter(target).catch((error) => {
                    setJoinResult({
                      title: 'Could not unassign campaign',
                      message: error instanceof Error ? error.message : `Could not remove ${target.name} from the campaign.`,
                    });
                  });
                }
          }
          onExportJson={() => {
            const target = characterMenu.character;
            setCharacterMenu(null);
            void exportRosterCharacter('json', target);
          }}
          onOpenStatBlock={() => {
            const target = characterMenu.character;
            setCharacterMenu(null);
            window.open(`/stat-block/character/${target.id}`, '_blank');
          }}
          onRename={() => {
            setPendingCharRename(characterMenu.character);
            setCharacterMenu(null);
          }}
          onExportPdf={() => {
            const target = characterMenu.character;
            setCharacterMenu(null);
            void exportRosterCharacter('pdf', target);
          }}
          onDelete={() => {
            setPendingCharDelete({ id: characterMenu.character.id, name: characterMenu.character.name });
            setCharacterMenu(null);
          }}
        />
      )}
      {pendingCharRename && (
        <RenameDialog
          title='Rename character'
          initialName={pendingCharRename.name}
          onCancel={() => setPendingCharRename(null)}
          onConfirm={(name) => {
            const target = pendingCharRename;
            setPendingCharRename(null);
            void phase1Request('update-character', { id: target.id, name }).then(
              () => refreshCharacters(),
              (error) => setActionError(error instanceof Error ? error.message : 'Could not rename character.')
            );
          }}
        />
      )}
      {pendingCharDelete && (
        <ConfirmDialog
          title='Delete character'
          message={`Are you sure you want to delete "${pendingCharDelete.name}"? They'll be gone for a very, very long time.`}
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          onCancel={() => {
            if (!busy) setPendingCharDelete(null);
          }}
          onConfirm={() => {
            const id = pendingCharDelete.id;
            setPendingCharDelete(null);
            setBusy(true);
            void phase1Request('delete-content', { id, type: 'character' })
              .then(() => refreshCharacters())
              .catch((error) => setActionError(error instanceof Error ? error.message : 'Could not delete character.'))
              .finally(() => setBusy(false));
          }}
        />
      )}
      {assignPicker && (
        <CampaignAssignPickerModal
          characterName={assignPicker.name}
          campaigns={ownedCampaigns}
          onCancel={() => setAssignPicker(null)}
          onPick={(picked) => {
            const target = assignPicker;
            setAssignPicker(null);
            const campaignId = numericId(picked.id);
            if (campaignId == null) return;
            void phase1Request('update-character', { id: target.id, campaign_id: campaignId })
              .then(() => refreshCharacters())
              .catch((error) => {
                setJoinResult({
                  title: 'Could not assign campaign',
                  message: error instanceof Error ? error.message : `Could not add ${target.name} to the campaign.`,
                });
              });
          }}
        />
      )}
      {joinOtherPicker && (
        <JoinKeyModal
          characterName={joinOtherPicker.name}
          onCancel={() => setJoinOtherPicker(null)}
          onConfirm={(key) => {
            const target = joinOtherPicker;
            setJoinOtherPicker(null);
            void joinPhase1CharacterByKey(numericId(target.id) ?? target.id, key.trim())
              .then(() => refreshCharacters())
              .catch((error) => {
                setJoinResult({
                  title: 'Could not join campaign',
                  message: error instanceof Error ? error.message : `Could not add ${target.name} to the campaign.`,
                });
              });
          }}
        />
      )}
      {joinResult && (
        <MessageDialog title={joinResult.title} message={joinResult.message} onClose={() => setJoinResult(null)} />
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

function visibleNotePages(campaign: Campaign, isGm: boolean): IndexedNotePage[] {
  if (!isGm) return [];
  return (campaign.notes?.pages ?? []).map((page, index) => ({ page, index }));
}
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function readDetailWidth() {
  const stored = Number(window.localStorage.getItem(DETAIL_WIDTH_KEY));
  return clamp(Number.isFinite(stored) && stored > 0 ? stored : DETAIL_WIDTH_DEFAULT, DETAIL_WIDTH_MIN, DETAIL_WIDTH_MAX);
}
















