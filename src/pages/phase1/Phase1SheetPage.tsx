import { CampaignSignIn } from '@auth/CampaignSignIn';
import { useAuthSession } from '@auth/useAuthSession';
import { confirmHealth, handleRest } from '@pages/character_sheet/entity-handler';
import { GUIDE_BLUE } from '@constants/data';
import { notePageToMarkdown } from '@pages/character_sheet/panels/gm-notes';
import type { Campaign, Character, Condition, Creature, Inventory, InventoryItem, Item } from '@schemas/content';
import type { VariableListStr } from '@schemas/variables';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getVariable } from '@variables/variable-manager';
import { labelToVariable } from '@variables/variable-utils';
import exportToJSON from '@export/export-to-json';
import exportToPDF from '@export/export-to-pdf';
import { cloneDeep } from 'lodash-es';
import { ArrowLeft, Brush, ChevronDown, Download, ExternalLink, Eye, Flag, Hammer, HeartPulse, Menu, Moon, Plus, RotateCcw, Star, Sun, User, X } from 'lucide-react';
import { Phase1PortraitModal } from './phase1-portrait-modal';
import { Phase1ArtworkPreview, Phase1BackgroundModal } from './phase1-background-modal';
import { getAllBackgroundImages } from '@utils/background-images';
import { parseTempHpInput } from './phase1-change-log';
import { OLD_UI_ORIGIN } from '../phase-switch/PhaseViewSwitch';
import { Phase1CssThemeToggle } from './Phase1CssThemeToggle';
import { Phase1ThemeToggle } from './Phase1ThemeToggle';
import { PHASE1_SHEET_ART_TONE_EVENT, persistSheetArtTone, readStoredSheetArtTone, type Phase1SheetArtTone } from './phase1-theme';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isPlayable } from '@utils/character';
import { phase1Request } from './phase1-api';
import {
  AbilitiesPanel,
  DetailsPanel,
  EmptyState,
  Eyebrow,
  HealthStatusPanel,
  InventoryPanel,
  SkillsActionsPanel,
  SpellsPanel,
  statsFor,
  InnerTab,
  type InventoryItemActions,
  type Phase1SpellActions,
  type PopulatedCombatant,
} from './phase1-entity-panels';
import { preparePhase1Entity, computePhase1BuilderChoiceCounts, type Phase1EntityCombatant } from './phase1-entity';
import { addCatalogItemToInventory } from './phase1-inventory';
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
import { calculateEntityStatus } from './phase1-stats';
import { Phase1BuilderWorkspace } from './Phase1BuilderPage';
import { SelectCompanionModal } from './phase1-creatures';

const SHEET_TABS = ['Skills', 'Inventory', 'Spells', 'Feats', 'Companions', 'Details', 'Notes', 'Extras'] as const;
type SheetTab = (typeof SHEET_TABS)[number];

export function Phase1SheetPage() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { characterId: rawId } = useParams();
  const characterId = Number(rawId);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'builder' ? 'builder' : 'sheet';
  const [tab, setTab] = useState<SheetTab>('Skills');
  const [restOpen, setRestOpen] = useState(false);
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [artworkPreviewOpen, setArtworkPreviewOpen] = useState(false);
  const [artTone, setArtTone] = useState<Phase1SheetArtTone>(() => readStoredSheetArtTone());
  const [xpDraft, setXpDraft] = useState('');
  const saveTimer = useRef<number | null>(null);
  const characterKey = ['phase1-sheet', characterId, session?.user.id ?? null] as const;

  const characterQuery = useQuery({
    queryKey: characterKey,
    enabled: Number.isFinite(characterId) && session !== undefined,
    queryFn: async () => firstRecord(await phase1Request<Character | Character[]>('find-character', { id: characterId })),
    retry: false,
  });
  const character = characterQuery.data ?? null;

  const campaignQuery = useQuery({
    queryKey: ['phase1-sheet-campaign', character?.campaign_id],
    enabled: Boolean(character?.campaign_id),
    queryFn: async () => firstRecord(await phase1Request<Campaign | Campaign[]>('find-campaign', { id: character!.campaign_id })),
  });

  const canEdit = Boolean(
    session &&
      character &&
      (character.user_id === session.user.id || campaignQuery.data?.user_id === session.user.id)
  );

  const combatant = useMemo(() => (character ? characterAsCombatant(character, canEdit) : null), [character, canEdit]);

  const statusQuery = useQuery({
    queryKey: ['phase1-sheet-status', characterId, JSON.stringify(character?.details?.conditions ?? []), character?.hp_current, character?.hp_temp],
    enabled: Boolean(combatant) && view === 'sheet',
    queryFn: () => calculateEntityStatus(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const choiceCountsQuery = useQuery({
    queryKey: [
      'phase1-sheet-builder-choices',
      characterId,
      character?.level,
      JSON.stringify(character?.operation_data?.selections ?? {}),
      character?.details?.ancestry?.id,
      character?.details?.background?.id,
      character?.details?.class?.id,
      character?.details?.class_2?.id,
    ],
    enabled: Boolean(character) && canEdit && view === 'sheet',
    queryFn: () => computePhase1BuilderChoiceCounts(character!),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const modesQuery = useQuery({
    queryKey: ['phase1-sheet-modes', characterId, JSON.stringify(character?.meta_data?.active_modes ?? [])],
    enabled: Boolean(combatant) && view === 'sheet',
    queryFn: async () => {
      const prepared = await preparePhase1Entity(combatant as Phase1EntityCombatant);
      const ids = getVariable<VariableListStr>(prepared.storeId, 'MODE_IDS')?.value ?? [];
      const active = getVariable<VariableListStr>(prepared.storeId, 'ACTIVE_MODES')?.value ?? [];
      const modes = prepared.content.abilityBlocks.filter((block) => block.type === 'mode' && ids.includes(String(block.id)));
      return { modes, active };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  const saveCharacter = useMutation({
    mutationFn: (fields: Partial<Character> & { id: number }) => phase1Request('update-character', fields),
    onMutate: async (fields) => {
      await queryClient.cancelQueries({ queryKey: characterKey });
      const previous = queryClient.getQueryData<Character | null>(characterKey);
      queryClient.setQueryData<Character | null>(characterKey, (current) => (current ? { ...current, ...fields } : current));
      return { previous };
    },
    onError: (_error, _fields, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(characterKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: characterKey }),
  });

  function persist(next: Character) {
    queryClient.setQueryData(characterKey, next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveCharacter.mutate({
        id: next.id,
        hp_current: next.hp_current,
        hp_temp: next.hp_temp,
        hero_points: next.hero_points,
        experience: next.experience,
        details: next.details,
        spells: next.spells,
        notes: next.notes,
        inventory: next.inventory,
        companions: next.companions,
        stamina_current: next.stamina_current,
        resolve_current: next.resolve_current,
        meta_data: next.meta_data,
        roll_history: next.roll_history,
      });
    }, 400);
  }

  function patchCharacter(updater: (current: Character) => Character) {
    if (!character || !canEdit) return;
    persist(updater(cloneDeep(character)));
  }

  useEffect(() => {
    setXpDraft(character ? String(character.experience ?? 0) : '');
  }, [character?.id, character?.experience]);

  useEffect(() => {
    if (character?.name) document.title = `${character.name} | ${view === 'builder' ? 'Builder' : 'Sheet'}`;
  }, [character?.name, view]);

  useEffect(() => {
    const sync = () => setArtTone(readStoredSheetArtTone());
    window.addEventListener(PHASE1_SHEET_ART_TONE_EVENT, sync);
    return () => window.removeEventListener(PHASE1_SHEET_ART_TONE_EVENT, sync);
  }, []);

  if (session === undefined) return <div className='grid min-h-screen place-items-center bg-p1-page text-sm text-p1-muted'>Loading session...</div>;
  if (!Number.isFinite(characterId)) return <SheetError title='Invalid sheet' body='This character id is not valid.' />;
  if (characterQuery.isPending || characterQuery.isLoading || (characterQuery.isFetching && !character)) {
    return <div className='grid min-h-screen place-items-center bg-p1-page text-sm text-p1-muted'>Loading character...</div>;
  }
  if (characterQuery.isError) {
    const message = characterQuery.error instanceof Error ? characterQuery.error.message : String(characterQuery.error);
    if (/unauthor|forbidden|401|private/i.test(message)) return <UnauthorizedSheet />;
    return <SheetError title='Could not load sheet' body={message} />;
  }
  if (!character || !combatant) {
    if (!session) return <CampaignSignIn variant='phase1' />;
    return <UnauthorizedSheet />;
  }

  const maxHp = statusQuery.data?.maxHp ?? statsFor(character).maxHp ?? character.hp_current ?? 0;
  const identity = [
    character.details?.ancestry?.name,
    character.details?.background?.name,
    character.details?.class?.name,
    character.details?.class_2?.name,
  ].filter(Boolean).join(' · ');
  const choiceCounts = choiceCountsQuery.data;
  const remainingChoices = choiceCounts ? Math.max(0, choiceCounts.max - choiceCounts.current) : 0;
  const showBuilderReminder =
    canEdit &&
    view === 'sheet' &&
    (remainingChoices > 0 || (choiceCountsQuery.isSuccess && !isPlayable(character)));
  const sheetArtUrl = character.details?.background_image_url;

  function persistHp(raw: string) {
    patchCharacter((current) => (confirmHealth(raw, maxHp, current)?.entity as Character) ?? current);
  }
  function persistTempHp(raw: string) {
    patchCharacter((current) => ({ ...current, hp_temp: parseTempHpInput(raw) }));
  }
  function persistConditions(conditions: Condition[]) {
    patchCharacter((current) => ({ ...current, details: { ...current.details, conditions } }));
  }

  const spellActions: Phase1SpellActions | undefined = canEdit
    ? {
        setCast: async (entry, cast) => {
          const next = await setEntitySpellCast(combatant as Phase1EntityCombatant, entry, cast);
          patchCharacter(() => next as Character);
        },
        setRankSpent: async (section, rank, spent) => {
          if (!section.source) return;
          const next = await setEntitySpellRankSpent(combatant as Phase1EntityCombatant, section.source.name, rank, spent);
          patchCharacter(() => next as Character);
        },
        setPreparedSpent: async (entry, spent) => {
          const next = await setEntityPreparedEntrySpent(combatant as Phase1EntityCombatant, entry, spent);
          patchCharacter(() => next as Character);
        },
        setFocusSpent: async (section, spent) => {
          if (!section.focusPoints) return;
          const next = await setEntityFocusSpent(combatant as Phase1EntityCombatant, section.focusPoints.max, spent);
          patchCharacter(() => next as Character);
        },
        setInnateSpent: async (entry, castsCurrent) => {
          if (!entry.spell) return;
          const next = await setEntityInnateSpent(combatant as Phase1EntityCombatant, entry.spell.id, entry.rank, castsCurrent);
          patchCharacter(() => next as Character);
        },
        addToList: async (sourceName, spell, rank) => {
          const next = await addEntitySpellToList(combatant as Phase1EntityCombatant, sourceName, spell, rank);
          patchCharacter(() => next as Character);
        },
        removeFromList: async (sourceName, spellId, rank) => {
          const next = await removeEntitySpellFromList(combatant as Phase1EntityCombatant, sourceName, spellId, rank);
          patchCharacter(() => next as Character);
        },
        prepareSlot: async (sourceName, slotId, spell, rank) => {
          const next = await prepareEntitySpellSlot(combatant as Phase1EntityCombatant, sourceName, slotId, spell, rank);
          patchCharacter(() => next as Character);
        },
        applyDivineFont: async (sourceName, choice) => {
          const next = await applyEntityDivineFont(combatant as Phase1EntityCombatant, sourceName, choice);
          patchCharacter(() => next as Character);
        },
      }
    : undefined;

  const itemActions: InventoryItemActions | undefined = canEdit
    ? {
        toggleEquipped: (item) => patchCharacter((current) => ({ ...current, inventory: mapInventory(current.inventory, item.key, (entry) => ({ ...entry, is_equipped: !entry.is_equipped })) })),
        toggleInvested: (item) => patchCharacter((current) => ({ ...current, inventory: mapInventory(current.inventory, item.key, (entry) => ({ ...entry, is_invested: !entry.is_invested })) })),
        setQuantity: (item, quantity) => patchCharacter((current) => ({
          ...current,
          inventory: mapInventory(current.inventory, item.key, (entry) => {
            const next = cloneDeep(entry);
            next.item.meta_data = { ...(next.item.meta_data ?? {}), quantity } as typeof entry.item.meta_data;
            return next;
          }),
        })),
        addItem: async (item: Item, type, coins) => {
          const added = (await addCatalogItemToInventory(undefined, item, type === 'FORMULA')).items[0];
          if (!added) return;
          patchCharacter((current) => {
            const inv = current.inventory ?? { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items: [] };
            return {
              ...current,
              inventory: {
                ...inv,
                coins: type === 'BUY' && coins ? coins : inv.coins,
                items: [...(inv.items ?? []), added].sort((a, b) => a.item.name.localeCompare(b.item.name)),
              },
            };
          });
        },
      }
    : undefined;

  async function rest() {
    if (!character || !combatant) return;
    const prepared = await preparePhase1Entity(combatant as Phase1EntityCombatant);
    const next = handleRest(prepared.storeId, character);
    if (next) persist(next as Character);
    setRestOpen(false);
  }

  function toggleMode(name: string) {
    const key = labelToVariable(name);
    patchCharacter((current) => {
      const active = current.meta_data?.active_modes ?? [];
      const next = active.includes(key) ? active.filter((item) => item !== key) : [...active, key];
      return { ...current, meta_data: { ...current.meta_data, active_modes: next } };
    });
  }

  return (
    <div className={`relative flex h-dvh min-h-0 flex-col overflow-hidden bg-p1-page text-p1-text${sheetArtUrl ? ` p1-sheet-has-art p1-sheet-art-${artTone}` : ''}`}>
      {sheetArtUrl && (
        <div className='p1-sheet-art-layer' style={{ backgroundImage: `url(${sheetArtUrl})` }} aria-hidden>
          <div className='p1-sheet-art-veil' />
        </div>
      )}
      <header className='relative z-10 flex h-14 shrink-0 items-center gap-4 border-b border-p1-border bg-p1-header px-5'>
        <button type='button' className='icon-button' title='Back' onClick={() => (location.key === 'default' ? navigate('/phase1/characters') : navigate(-1))}><ArrowLeft size={16} /></button>
        <Link to='/phase1' className='font-semibold hover:underline'>Wanderer's Guide</Link>
        <span className='h-4 w-px bg-p1-hover' />
        <span className='truncate text-sm text-p1-muted'>{view === 'builder' ? 'Character builder' : 'Character sheet'}</span>
        <div className='ml-auto flex items-center gap-2'>
          {saveCharacter.isPending && <span className='text-[11px] text-p1-faint'>Saving...</span>}
          <Phase1ThemeToggle />
          <Phase1CssThemeToggle />
        </div>
      </header>
      <main className={`relative z-10 mx-auto min-h-0 w-full flex-1 overflow-y-scroll px-4 py-6 pb-10 ${view === 'builder' ? 'max-w-6xl' : 'max-w-5xl'}`}>
        <section className='relative z-30 mb-4 flex flex-wrap items-start gap-4 border border-p1-border bg-p1-surface p-4'>
          <button
            type='button'
            className='grid h-20 w-20 shrink-0 place-items-center overflow-hidden border border-p1-border bg-p1-inset text-p1-faint hover:border-p1-accent/60 disabled:hover:border-p1-border'
            title={canEdit ? 'Change portrait' : character.details?.image_url ? character.name : undefined}
            disabled={!canEdit}
            onClick={() => {
              if (canEdit) setPortraitOpen(true);
            }}
          >
            {character.details?.image_url ? (
              <img src={character.details.image_url} alt='' className='h-full w-full object-cover' />
            ) : (
              <User size={28} />
            )}
          </button>
          <div className='min-w-0 flex-1'>
            <Eyebrow>Player character</Eyebrow>
            <h1 className='mt-1 truncate text-2xl font-semibold'>{character.name}</h1>
            <p className='mt-1 text-sm text-p1-muted'>{identity || 'Ancestry, background, and class load with calculated details.'}</p>
            <p className='mt-1 text-xs text-p1-faint'>Level {character.level}{canEdit ? '' : ' · Read only'}</p>
          </div>
          <div className='flex min-w-0 flex-col items-end gap-2'>
            <div className='flex flex-wrap items-center justify-end gap-2'>
            {canEdit && <button type='button' className='toolbar-button' onClick={() => setRestOpen(true)}><RotateCcw size={14} /> Rest</button>}
            <div className='toolbar-button'>
              <Star size={14} />
              Hero
              {canEdit ? (
                <span className='ml-2 flex items-center gap-1'>
                  <button type='button' onClick={() => patchCharacter((current) => ({ ...current, hero_points: Math.max(0, (current.hero_points ?? 0) - 1) }))}>-</button>
                  <strong>{character.hero_points ?? 0}</strong>
                  <button type='button' onClick={() => patchCharacter((current) => ({ ...current, hero_points: Math.min(3, (current.hero_points ?? 0) + 1) }))}>+</button>
                </span>
              ) : <strong className='ml-2'>{character.hero_points ?? 0}</strong>}
            </div>
            {view === 'builder' ? (
              <button
                type='button'
                className='toolbar-button'
                onClick={() => setSearchParams({}, { replace: true })}
                title='Character sheet'
              >
                <User size={14} /> Sheet
              </button>
            ) : canEdit ? (
              <button
                type='button'
                className='toolbar-button'
                onClick={() => setSearchParams({ view: 'builder', step: 'builder' }, { replace: true })}
                title='Character builder'
              >
                <Hammer size={14} /> Builder
              </button>
            ) : null}
            <Phase1CharacterMenu
              character={character}
              canEdit={canEdit}
              xpDraft={xpDraft}
              onXpDraftChange={setXpDraft}
              onXpCommit={() => {
                const value = Number.parseInt(xpDraft, 10);
                if (Number.isFinite(value)) patchCharacter((current) => ({ ...current, experience: Math.max(0, value) }));
              }}
            />
            </div>
            {showBuilderReminder && (
              <button
                type='button'
                className='toolbar-button border-p1-accent/50 text-p1-accent-soft'
                onClick={() =>
                  setSearchParams(
                    remainingChoices > 0 ? { view: 'builder', step: 'builder' } : { view: 'builder' },
                    { replace: true }
                  )
                }
              >
                <Hammer size={14} />
                {remainingChoices > 0
                  ? `${remainingChoices} ${remainingChoices === 1 ? 'choice' : 'choices'} remaining`
                  : 'Finish setup'}
                {choiceCounts && remainingChoices > 0 && (
                  <span className='text-p1-faint'>
                    {choiceCounts.current}/{choiceCounts.max}
                  </span>
                )}
              </button>
            )}
          </div>
        </section>

        {view === 'builder' ? (
          <Phase1BuilderWorkspace characterId={character.id} embedded seed={character} />
        ) : (
          <>
        {(modesQuery.data?.modes.length ?? 0) > 0 && (
          <section className='mb-4 border border-p1-border bg-p1-surface p-3'>
            <h2 className='mb-2 text-xs font-semibold uppercase text-p1-muted'>Modes</h2>
            <div className='flex flex-wrap gap-2'>
              {modesQuery.data!.modes.map((mode) => {
                const active = (character.meta_data?.active_modes ?? []).includes(labelToVariable(mode.name));
                return (
                  <button
                    key={mode.id}
                    type='button'
                    disabled={!canEdit}
                    className={`border px-3 py-1.5 text-xs ${active ? 'border-p1-accent bg-p1-accent/15 text-p1-accent-soft' : 'border-p1-border text-p1-muted'}`}
                    onClick={() => toggleMode(mode.name)}
                  >
                    {mode.name}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <HealthStatusPanel
          combatant={combatant}
          calculatedStatus={statusQuery.data ?? null}
          calculating={statusQuery.isLoading}
          onChangeConditions={canEdit ? persistConditions : undefined}
          onPersistHpCurrent={canEdit ? persistHp : undefined}
          onPersistTempHp={canEdit ? persistTempHp : undefined}
        />

        <div className='mt-4 grid grid-cols-4 border border-p1-border bg-p1-inset sm:grid-cols-8'>
          {SHEET_TABS.map((item) => (
            <button key={item} className={`border-b-2 px-2 py-2.5 text-[11px] ${tab === item ? 'border-p1-accent text-p1-accent-soft' : 'border-transparent text-p1-faint hover:text-p1-text'}`} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
        <div className='border border-t-0 border-p1-border bg-p1-inset p-4'>
          {tab === 'Skills' && <SkillsActionsPanel combatant={combatant} />}
          {tab === 'Inventory' && <InventoryPanel combatant={combatant} itemActions={itemActions} />}
          {tab === 'Spells' && <SpellsPanel combatant={combatant} spellActions={spellActions} />}
          {tab === 'Feats' && <AbilitiesPanel combatant={combatant} />}
          {tab === 'Companions' && (
            <CompanionsSection
              character={character}
              canEdit={canEdit}
              onChange={(companions) => patchCharacter((current) => ({ ...current, companions: { list: companions } }))}
            />
          )}
          {tab === 'Details' && <DetailsPanel combatant={combatant} />}
          {tab === 'Notes' && <CharacterNotesPanel notes={character.notes} canEdit={canEdit} onChange={(notes) => patchCharacter((current) => ({ ...current, notes }))} />}
          {tab === 'Extras' && <EmptyState>This miscellaneous section will be updated with more features in the future. You can expect to see support for vehicles, snares, and other extra rules.</EmptyState>}
        </div>
          </>
        )}
      </main>

      {portraitOpen && (
        <Phase1PortraitModal
          currentUrl={character.details?.image_url}
          onSelect={(url) =>
            patchCharacter((current) => ({
              ...current,
              details: { ...current.details, image_url: url },
            }))
          }
          onClose={() => setPortraitOpen(false)}
        />
      )}
      {backgroundOpen && (
        <Phase1BackgroundModal
          currentUrl={character.details?.background_image_url}
          onSelect={(url) =>
            patchCharacter((current) => ({
              ...current,
              details: { ...current.details, background_image_url: url },
            }))
          }
          onClose={() => setBackgroundOpen(false)}
        />
      )}
      {artworkPreviewOpen && character.details?.background_image_url && (
        <Phase1ArtworkPreview
          option={
            getAllBackgroundImages().find((image) => image.url === character.details?.background_image_url) ?? {
              name: 'Custom',
              url: character.details.background_image_url,
            }
          }
          onBack={() => setArtworkPreviewOpen(false)}
        />
      )}
      <Phase1ArtworkOverlay
        url={character.details?.background_image_url}
        canEdit={canEdit}
        artTone={artTone}
        onArtTone={(tone) => {
          setArtTone(tone);
          persistSheetArtTone(tone);
        }}
        onPreview={() => setArtworkPreviewOpen(true)}
        onSelect={() => setBackgroundOpen(true)}
        onClear={() =>
          patchCharacter((current) => ({
            ...current,
            details: { ...current.details, background_image_url: undefined },
          }))
        }
      />
      {restOpen && (
        <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget) setRestOpen(false); }}>
          <section className='w-full max-w-md border border-p1-border bg-p1-surface p-5'>
            <h2 className='text-lg font-semibold'>Rest?</h2>
            <p className='mt-2 text-sm leading-6 text-p1-muted'>You will regain some HP (Con. mod × level), reset spell slots and focus points, and you may recover from or improve certain conditions.</p>
            <div className='mt-4 flex justify-end gap-2'>
              <button className='toolbar-button' onClick={() => setRestOpen(false)}>Cancel</button>
              <button className='toolbar-button text-p1-accent-ink' style={{ background: 'var(--p1-accent)', color: 'var(--p1-accent-ink)', borderColor: 'var(--p1-accent)' }} onClick={rest}><HeartPulse size={14} /> Rest</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function CompanionsSection({ character, canEdit, onChange }: { character: Character; canEdit: boolean; onChange: (companions: Creature[]) => void }) {
  const [creating, setCreating] = useState(false);
  const companions = character.companions?.list ?? [];

  function addCompanion(creature: Creature) {
    onChange([...companions, cloneDeep(creature)]);
    setCreating(false);
  }

  return (
    <div className='space-y-4'>
      {canEdit && (
        <div className='flex justify-end'>
          <button type='button' className='toolbar-button' onClick={() => setCreating(true)}>
            <Plus size={14} /> Create companion
          </button>
        </div>
      )}
      {!companions.length && <EmptyState>No companions found, want to add one?</EmptyState>}
      {companions.map((companion, index) => {
        const combatant = creatureAsCombatant(companion, index, canEdit);
        return (
          <section key={combatant._id} className='border border-p1-border bg-p1-surface p-3'>
            <h3 className='mb-3 text-sm font-semibold'>{companion.name}</h3>
            <CompanionHealth companion={companion} combatant={combatant} canEdit={canEdit} onChange={(next) => onChange(companions.map((item, itemIndex) => (itemIndex === index ? next : item)))} />
          </section>
        );
      })}
      {creating && <SelectCompanionModal onSelect={addCompanion} onClose={() => setCreating(false)} />}
    </div>
  );
}

function CompanionHealth({ companion, combatant, canEdit, onChange }: { companion: Creature; combatant: PopulatedCombatant; canEdit: boolean; onChange: (companion: Creature) => void }) {
  const status = useQuery({
    queryKey: ['phase1-sheet-companion', combatant._id, companion.hp_current, JSON.stringify(companion.details?.conditions ?? [])],
    queryFn: () => calculateEntityStatus(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const maxHp = status.data?.maxHp ?? statsFor(companion).maxHp ?? companion.hp_current ?? 0;
  return (
    <HealthStatusPanel
      combatant={{ ...combatant, data: companion }}
      calculatedStatus={status.data ?? null}
      calculating={status.isLoading}
      onChangeConditions={canEdit ? (conditions) => onChange({ ...companion, details: { ...companion.details, conditions } }) : undefined}
      onPersistHpCurrent={canEdit ? (raw) => onChange((confirmHealth(raw, maxHp, companion)?.entity as Creature) ?? companion) : undefined}
      onPersistTempHp={canEdit ? (raw) => onChange({ ...companion, hp_temp: parseTempHpInput(raw) }) : undefined}
    />
  );
}

function characterAsCombatant(character: Character, canEdit: boolean): PopulatedCombatant {
  return {
    _id: `sheet-${character.id}`,
    type: 'CHARACTER',
    ally: true,
    character: character.id,
    data: character,
    access: { can_edit: canEdit, details_revealed: true },
  };
}

function creatureAsCombatant(creature: Creature, index: number, canEdit: boolean): PopulatedCombatant {
  return {
    _id: `sheet-companion-${index}-${creature.id}`,
    type: 'CREATURE',
    ally: true,
    creature,
    data: creature,
    access: { can_edit: canEdit, details_revealed: true },
  };
}

function mapInventory(inventory: Inventory | null | undefined, key: string, patch: (item: InventoryItem) => InventoryItem): Inventory {
  const current = inventory ?? { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items: [] };
  return { ...current, items: mapInvItems(current.items ?? [], key, patch) };
}

function mapInvItems(items: InventoryItem[], key: string, patch: (item: InventoryItem) => InventoryItem): InventoryItem[] {
  return items.map((item) => {
    const next = (item.id || '') === key ? patch(item) : item;
    if (!next.container_contents?.length) return next;
    return { ...next, container_contents: mapInvItems(next.container_contents, key, patch) };
  });
}

function CharacterNotesPanel({ notes, canEdit, onChange }: { notes: Character['notes']; canEdit: boolean; onChange: (notes: Character['notes']) => void }) {
  const pages = (notes?.pages ?? []).filter((page) => page.name.trim().toLowerCase() !== 'gm notes');
  const [pageIndex, setPageIndex] = useState(0);
  const active = pages[Math.min(pageIndex, Math.max(pages.length - 1, 0))];
  const saved = active ? notePageToMarkdown(active.contents) : '';
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  function saveDraft(text: string) {
    if (!active) {
      onChange(toCharacterNotes(text, notes));
      return;
    }
    const all = notes?.pages ?? [];
    const realIndex = all.findIndex((page) => page === active);
    const nextPages = realIndex < 0
      ? [...all, { name: active.name, icon: active.icon, color: active.color, contents: text }]
      : all.map((page, index) => (index === realIndex ? { ...page, contents: text } : page));
    onChange({ pages: nextPages });
  }

  if (!pages.length && !canEdit) return <EmptyState>No notes yet.</EmptyState>;

  return (
    <div className='flex min-h-[280px] flex-col gap-3'>
      {pages.length > 1 && (
        <div className='flex overflow-x-auto border-b border-p1-border'>
          {pages.map((page, index) => (
            <InnerTab key={`${page.name}-${index}`} active={Math.min(pageIndex, pages.length - 1) === index} onClick={() => setPageIndex(index)}>
              {page.name || `Page ${index + 1}`}
            </InnerTab>
          ))}
        </div>
      )}
      {!canEdit ? (
        saved ? <pre className='whitespace-pre-wrap border border-p1-border bg-p1-surface p-4 text-sm leading-6 text-p1-text'>{saved}</pre> : <EmptyState>No notes yet.</EmptyState>
      ) : (
        <>
          <textarea className='min-h-[220px] flex-1 resize-y border border-p1-border bg-p1-surface p-3 text-sm leading-6 text-p1-text outline-none focus:border-p1-accent/60' value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== saved) saveDraft(draft); }} />
          <button type='button' className='h-8 self-end bg-p1-accent px-3 text-xs font-semibold text-p1-accent-ink' onClick={() => saveDraft(draft)}>Save notes</button>
        </>
      )}
    </div>
  );
}

function toCharacterNotes(text: string, notes: Character['notes']): Character['notes'] {
  const pages = notes?.pages ?? [];
  const index = pages.findIndex((page) => page.name.trim().toLowerCase() !== 'gm notes');
  const page = {
    name: 'Notes',
    icon: 'notebook',
    color: GUIDE_BLUE,
    contents: text,
  };
  if (index < 0) return { pages: [page, ...pages] };
  return { pages: pages.map((item, itemIndex) => (itemIndex === index ? { ...item, contents: text } : item)) };
}

const characterMenuItemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover';

function Phase1CharacterMenu({
  character,
  canEdit,
  xpDraft,
  onXpDraftChange,
  onXpCommit,
}: {
  character: Character;
  canEdit: boolean;
  xpDraft: string;
  onXpDraftChange: (value: string) => void;
  onXpCommit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'json' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function run(kind: 'pdf' | 'json') {
    setOpen(false);
    setExporting(kind);
    try {
      if (kind === 'pdf') await exportToPDF(character);
      else await exportToJSON(character);
    } finally {
      setExporting(null);
    }
  }

  const label = exporting === 'pdf' ? 'Exporting PDF…' : exporting === 'json' ? 'Exporting JSON…' : 'Character';

  return (
    <div ref={menuRef} className='relative'>
      <button
        type='button'
        className='toolbar-button'
        disabled={Boolean(exporting)}
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Menu size={14} /> {label} <ChevronDown size={14} />
      </button>
      {open && (
        <div role='menu' className='absolute right-0 z-20 mt-1 min-w-52 border border-p1-border bg-p1-surface py-1 shadow-2xl'>
          {character.campaign_id ? (
            <Link role='menuitem' className={characterMenuItemClass} to={`/phase1/campaign/${character.campaign_id}`} onClick={() => setOpen(false)}>
              <Flag size={14} /> Campaign
            </Link>
          ) : null}
          <button type='button' role='menuitem' className={characterMenuItemClass} onClick={() => void run('pdf')}>
            <Download size={14} /> Export PDF
          </button>
          <button type='button' role='menuitem' className={characterMenuItemClass} onClick={() => void run('json')}>
            <Download size={14} /> Export JSON
          </button>
          <a
            role='menuitem'
            className={characterMenuItemClass}
            href={`${OLD_UI_ORIGIN}/sheet/${character.id}`}
            target='_blank'
            rel='noreferrer'
            onClick={() => setOpen(false)}
          >
            <ExternalLink size={14} /> Open classic UI
          </a>
          <div className='mx-2 my-1 border-t border-p1-border' />
          <label className='flex items-center gap-2 px-3 py-2 text-sm text-p1-muted'>
            XP
            <input
              className='ml-auto w-16 bg-transparent text-right text-p1-text outline-none'
              value={xpDraft}
              disabled={!canEdit}
              onChange={(event) => onXpDraftChange(event.target.value)}
              onBlur={onXpCommit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function firstRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function UnauthorizedSheet() {
  return (
    <SheetError
      code='401'
      title='Private character'
      body='This character sheet is private. To view it, the sheet must be public, you must own the character, or you must own a campaign the character is in.'
    />
  );
}

function Phase1ArtworkOverlay({
  url,
  canEdit,
  artTone,
  onArtTone,
  onPreview,
  onSelect,
  onClear,
}: {
  url?: string;
  canEdit: boolean;
  artTone: 'light' | 'dark';
  onArtTone: (tone: 'light' | 'dark') => void;
  onPreview: () => void;
  onSelect: () => void;
  onClear: () => void;
}) {
  const option = url ? getAllBackgroundImages().find((image) => image.url === url) ?? { name: 'Custom', url } : null;
  if (!canEdit && !option) return null;

  return (
    <div className='pointer-events-none fixed bottom-3 right-3 z-20 flex max-w-[min(18rem,calc(100vw-1.5rem))] flex-col items-end gap-1'>
      {option && (option.name || option.source?.trim()) && (
        <div className='pointer-events-auto max-w-full rounded border border-p1-border bg-p1-surface/90 px-2 py-1 text-right shadow-md backdrop-blur-sm'>
          {option.name && <p className='truncate text-[11px] text-p1-text'>{option.name}</p>}
          {option.source?.trim() && (
            <a
              href={option.source_url}
              target='_blank'
              rel='noreferrer'
              className='mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[10px] text-p1-muted hover:text-p1-text'
            >
              <Brush size={10} />
              {option.source}
            </a>
          )}
        </div>
      )}
      <div className='pointer-events-auto flex flex-wrap justify-end gap-1'>
        {option && (
          <>
            <button
              type='button'
              className={`icon-button${artTone === 'light' ? ' is-active' : ''}`}
              title='Lighter artwork'
              onClick={() => onArtTone('light')}
            >
              <Sun size={16} />
            </button>
            <button
              type='button'
              className={`icon-button${artTone === 'dark' ? ' is-active' : ''}`}
              title='Darker artwork'
              onClick={() => onArtTone('dark')}
            >
              <Moon size={16} />
            </button>
          </>
        )}
        {canEdit && (
          <>
            {option && (
              <>
                <button type='button' className='icon-button' title='View artwork' onClick={onPreview}>
                  <Eye size={16} />
                </button>
                <button type='button' className='icon-button' title='Clear artwork' onClick={onClear}>
                  <X size={16} />
                </button>
              </>
            )}
            <button type='button' className='icon-button' title={option ? 'Change artwork' : 'Select artwork'} onClick={onSelect}>
              <Brush size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SheetError({ code = 'Error', title, body }: { code?: string; title: string; body: string }) {
  return (
    <div className='grid min-h-screen place-items-center bg-p1-page p-6 text-p1-text'>
      <div className='max-w-lg border border-p1-border bg-p1-surface p-6 text-center'>
        <Eyebrow>{code}</Eyebrow>
        <h1 className='mt-2 text-xl font-semibold'>{title}</h1>
        <p className='mt-3 text-sm leading-6 text-p1-muted'>{body}</p>
        <Link to='/phase1/characters' className='mt-5 inline-block text-sm text-p1-accent hover:underline'>Back to characters</Link>
      </div>
    </div>
  );
}
