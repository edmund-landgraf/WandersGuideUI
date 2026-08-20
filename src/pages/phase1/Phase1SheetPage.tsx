import { CampaignSignIn } from '@auth/CampaignSignIn';
import { useAuthSession } from '@auth/useAuthSession';
import { confirmHealth, handleRest } from '@pages/character_sheet/entity-handler';
import { GUIDE_BLUE } from '@constants/data';
import { notePageToMarkdown } from '@pages/character_sheet/panels/gm-notes';
import type { Campaign, Character, Condition, Creature, Inventory, InventoryItem } from '@schemas/content';
import type { VariableListStr } from '@schemas/variables';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getVariable } from '@variables/variable-manager';
import { cloneDeep } from 'lodash-es';
import { ArrowLeft, ExternalLink, Flag, Hammer, HeartPulse, RotateCcw, Star, User } from 'lucide-react';
import { Phase1DiceButton, Phase1DiceModal } from './phase1-dice';
import { OLD_UI_ORIGIN } from '../phase-switch/PhaseViewSwitch';
import { Phase1ThemeToggle } from './Phase1ThemeToggle';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { parseTempHpInput } from './phase1-change-log';
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
  type InventoryItemActions,
  type Phase1SpellActions,
  type PopulatedCombatant,
} from './phase1-entity-panels';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';
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
  const [diceOpen, setDiceOpen] = useState(false);
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
    <div className='min-h-screen bg-p1-page text-p1-text'>
      <header className='flex h-14 items-center gap-4 border-b border-p1-border bg-p1-header px-5'>
        <button type='button' className='icon-button' title='Back' onClick={() => (location.key === 'default' ? navigate('/phase1/characters') : navigate(-1))}><ArrowLeft size={16} /></button>
        <span className='font-semibold'>Wanderer's Guide</span>
        <span className='h-4 w-px bg-p1-hover' />
        <span className='truncate text-sm text-p1-muted'>{view === 'builder' ? 'Character builder' : 'Character sheet'}</span>
        <div className='ml-auto flex items-center gap-2'>
          {saveCharacter.isPending && <span className='text-[11px] text-p1-faint'>Saving...</span>}
          <Phase1ThemeToggle />
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${view === 'builder' ? 'max-w-6xl' : 'max-w-5xl'}`}>
        <section className='mb-4 flex flex-wrap items-start gap-4 border border-p1-border bg-p1-surface p-4'>
          {character.details?.image_url && <img src={character.details.image_url} alt='' className='h-20 w-20 object-cover' />}
          <div className='min-w-0 flex-1'>
            <Eyebrow>Player character</Eyebrow>
            <h1 className='mt-1 truncate text-2xl font-semibold'>{character.name}</h1>
            <p className='mt-1 text-sm text-p1-muted'>{identity || 'Ancestry, background, and class load with calculated details.'}</p>
            <p className='mt-1 text-xs text-p1-faint'>Level {character.level}{canEdit ? '' : ' · Read only'}</p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {canEdit && (
              view === 'builder' ? (
                <button type='button' className='toolbar-button' onClick={() => setSearchParams({}, { replace: true })}>
                  <User size={14} /> Sheet
                </button>
              ) : (
                <button type='button' className='toolbar-button' onClick={() => setSearchParams({ view: 'builder' }, { replace: true })}>
                  <Hammer size={14} /> Builder
                </button>
              )
            )}
            {character.campaign_id && (
              <Link className='toolbar-button' to={`/phase1/campaign/${character.campaign_id}`}><Flag size={14} /> Campaign</Link>
            )}
            <a
              className='toolbar-button'
              href={`${OLD_UI_ORIGIN}/sheet/${character.id}`}
              target='_blank'
              rel='noreferrer'
              title='Open the original character sheet'
            >
              <ExternalLink size={14} /> Original
            </a>
            {(character.options?.dice_roller || campaignQuery.data?.recommended_options?.dice_roller) && (
              <Phase1DiceButton onOpen={() => setDiceOpen(true)} />
            )}
            {canEdit && <button className='toolbar-button' onClick={() => setRestOpen(true)}><RotateCcw size={14} /> Rest</button>}
            <label className='toolbar-button'>
              XP
              <input
                className='ml-2 w-16 bg-transparent text-right outline-none'
                value={xpDraft}
                disabled={!canEdit}
                onChange={(event) => setXpDraft(event.target.value)}
                onBlur={() => {
                  const value = Number.parseInt(xpDraft, 10);
                  if (Number.isFinite(value)) patchCharacter((current) => ({ ...current, experience: Math.max(0, value) }));
                }}
              />
            </label>
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
          {tab === 'Notes' && <CharacterNotesPanel notes={character.notes} canEdit={canEdit} onSave={(text) => patchCharacter((current) => ({ ...current, notes: toCharacterNotes(text, current.notes) }))} />}
          {tab === 'Extras' && <EmptyState>This miscellaneous section will be updated with more features in the future. You can expect to see support for vehicles, snares, and other extra rules.</EmptyState>}
        </div>
          </>
        )}
      </main>

      {diceOpen && (
        <Phase1DiceModal
          character={character}
          canEdit={canEdit}
          onClose={() => setDiceOpen(false)}
          onSaveHistory={(rolls) => persist({ ...(queryClient.getQueryData<Character | null>(characterKey) ?? character), roll_history: { rolls } })}
        />
      )}
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
  const companions = character.companions?.list ?? [];
  if (!companions.length) return <EmptyState>No companions on this character.</EmptyState>;
  return (
    <div className='space-y-4'>
      {companions.map((companion, index) => {
        const combatant = creatureAsCombatant(companion, index, canEdit);
        return (
          <section key={combatant._id} className='border border-p1-border bg-p1-surface p-3'>
            <h3 className='mb-3 text-sm font-semibold'>{companion.name}</h3>
            <CompanionHealth companion={companion} combatant={combatant} canEdit={canEdit} onChange={(next) => onChange(companions.map((item, itemIndex) => (itemIndex === index ? next : item)))} />
          </section>
        );
      })}
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

function CharacterNotesPanel({ notes, canEdit, onSave }: { notes: Character['notes']; canEdit: boolean; onSave: (text: string) => void }) {
  const saved = characterNotesText(notes);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  if (!canEdit) {
    return saved ? <pre className='whitespace-pre-wrap border border-p1-border bg-p1-surface p-4 text-sm leading-6 text-p1-text'>{saved}</pre> : <EmptyState>No notes yet.</EmptyState>;
  }
  return (
    <div className='flex min-h-[280px] flex-col gap-3'>
      <textarea className='min-h-[220px] flex-1 resize-y border border-p1-border bg-p1-surface p-3 text-sm leading-6 text-p1-text outline-none focus:border-p1-accent/60' value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== saved) onSave(draft); }} />
      <button type='button' className='h-8 self-end bg-p1-accent px-3 text-xs font-semibold text-p1-accent-ink' onClick={() => onSave(draft)}>Save notes</button>
    </div>
  );
}

function characterNotesText(notes: Character['notes']) {
  return (notes?.pages ?? [])
    .filter((page) => page.name.trim().toLowerCase() !== 'gm notes')
    .map((page) => notePageToMarkdown(page.contents).trim())
    .filter(Boolean)
    .join('\n\n');
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
