import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Calculator, ChevronDown, ChevronRight, Copy, Crosshair, Eye, Footprints, History, ListChecks, Package, Pencil, Plus, Search, Shield, Sparkles, Swords, Trash2, WandSparkles, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Character, Combatant, CombatantActionLogEntry, CombatantChangeLogEntry, Condition, InitiativeRoundLog, InitiativeRoundLogEntry, Inventory, Item, LivingEntity, Spell } from '@schemas/content';
import { loadEntityAbilities, type Phase1Ability, type Phase1FeatCategory } from './phase1-abilities';
import { type Phase1CreatureStatus } from './phase1-stats';
import type { Phase1EntityCombatant } from './phase1-entity';
import { StatDetailModal, type Phase1StatKey, type Phase1StatTarget } from './phase1-stat-modal';
import { loadEntityDetails, type Phase1ProfRow } from './phase1-details';
import { loadEntitySkillsActions, type Phase1ActionGroup, type Phase1Skill } from './phase1-skills';
import { isDivinePreparedSource, isFocusCastBlocked, isWitchFamiliarSource, loadEntitySpells, spellCatalogSourceIds, spellFitsSlot, spellManageMode, type Phase1SpellEntry, type Phase1SpellSection } from './phase1-spells';
import { wandNeedsOvercharge } from './phase1-item-spells';
import { Phase1SpellbookModal, type SpellbookAssign } from './phase1-spellbook';
import { findInventoryItem, flattenInvItems, inventoryContainerTargets, inventoryItemIsNested, inventoryItemToPhase1, loadEntityInventory, matchesInvItem, type Phase1InvItem } from './phase1-inventory';
import { SelectAddItemsModal, type AddItemKind } from './phase1-add-items';
import { Phase1EditItemModal } from './phase1-edit-item-modal';
import { ConfirmDialog } from './phase1-campaign-settings';
import { EntityNotesPanel, ProseMarkdown, SourceImportNotesPanel } from './phase1-markdown';
import { isContentStackOpen, useContentLinks } from './phase1-content-links';
import { getBestShield, getInvBulk, getItemHealth, isItemContainer, labelizeBulk } from '@items/inv-utils';
import CopperCoin from '@assets/images/currency/copper.png';
import GoldCoin from '@assets/images/currency/gold.png';
import PlatinumCoin from '@assets/images/currency/platinum.png';
import SilverCoin from '@assets/images/currency/silver.png';
import { lookupMonsterArt, type Phase1MonsterArt } from './phase1-monster-image';
import { addConditionWithSpawns, compiledConditions, removeConditionWithSpawns } from '@conditions/condition-handler';
import { ConditionDetailModal, SelectConditionModal } from './phase1-conditions';
import { ActionSymbol } from '@common/Actions';
import { abilityNameAndCost } from '@utils/actions';
import { toStandard2eProse } from '@utils/foundry-text';
import { EditableValueWithNote, RoundNoteField } from './phase1-change-log-ui';
import { formatChangeLogField, formatChangeLogTime, formatChangeLogValue } from './phase1-change-log';
import { actionCostCount, currentActionRound, draftFromAbility, groupActionLogByRound, isExecutableActionCost, isLoggableAbility, roundActionTotal, wouldExceedRoundActions, type ActionLogDraft } from './phase1-action-log';
import { useClickVsDoubleClick } from './phase1-click';
import { roundLogEntryMatchesCombatant } from './phase1-initiative';

export type Phase1SpellActions = {
  setCast: (entry: Phase1SpellEntry, cast: boolean) => Promise<void>;
  setRankSpent: (section: Phase1SpellSection, rank: number, spent: number) => Promise<void>;
  setPreparedSpent: (entry: Phase1SpellEntry, spent: boolean) => Promise<void>;
  setFocusSpent: (section: Phase1SpellSection, spent: number) => Promise<void>;
  setInnateSpent: (entry: Phase1SpellEntry, castsCurrent: number) => Promise<void>;
  addToList: (sourceName: string, spell: Spell, rank: number) => Promise<void>;
  removeFromList: (sourceName: string, spellId: number, rank?: number) => Promise<void>;
  prepareSlot: (sourceName: string, slotId: string | undefined, spell: Spell, rank: number) => Promise<void>;
  applyDivineFont: (sourceName: string, choice: 'heal' | 'harm') => Promise<void>;
  clearSlot: (slotId: string) => Promise<void>;
  castStaff: (entry: Phase1SpellEntry, cast: boolean, option?: 'NORMAL' | 'SLOT-CONSUME', slotRank?: number) => Promise<void>;
  castWand: (entry: Phase1SpellEntry, cast: boolean, overcharge?: boolean) => Promise<void>;
  setItemCharges: (itemId: string, current: number) => Promise<void>;
  addStaffCharges: (itemId: string, slotId: string) => Promise<void>;
};
export const DETAIL_TABS = ['Health', 'Abilities', 'Skills', 'Inventory', 'Spells', 'Notes', 'Details', 'Log'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];
export function normalizeDetailTab(tab: string): DetailTab {
  if (tab === 'Source') return 'Details';
  if ((DETAIL_TABS as readonly string[]).includes(tab)) return tab as DetailTab;
  return 'Health';
}
export type LogActionFn = (draft: ActionLogDraft, beforeLog?: () => void | Promise<void>) => void;
export type PopulatedCombatant = Combatant & { data: LivingEntity; access?: { can_edit: boolean; details_revealed: boolean } };

/** Shared across combatants and kept when leaving/returning to a tab. */
let persistedSkillsInnerTab: 'skills' | 'actions' = 'skills';
let persistedSkillsActionCost = 'ALL';
let persistedNotesInnerTab: 'gm' | 'combat' = 'gm';
let persistedDetailsInnerTab: 'details' | 'source' = 'details';
let persistedAbilitiesInnerTab: Phase1Ability['source'] = 'Feat';
let persistedSpellsRankFilter: number | 'ALL' = 'ALL';
let persistedSpellsSourceKey = 'ALL';
let persistedInventoryTab: 'equipped' | 'carried' | 'containers' = 'equipped';
let persistedActionGroup = 'ALL';
let persistedSheetDetailsTab: 'info' | 'languages' | 'proficiencies' = 'info';
const ABILITY_TAB_ORDER = ['Feat', 'Character', 'Weapon', 'Base', 'Added'] as const;
const FEAT_GROUP_SECTIONS: { id: Phase1FeatCategory; label: string }[] = [
  { id: 'class', label: 'Class Feats' },
  { id: 'ancestry', label: 'Ancestry Feats' },
  { id: 'general', label: 'General & Skill Feats' },
  { id: 'other', label: 'Other Feats' },
];
type AbilityTab = (typeof ABILITY_TAB_ORDER)[number];
function isAbilityTab(source: Phase1Ability['source']): source is AbilityTab {
  return (ABILITY_TAB_ORDER as readonly string[]).includes(source);
}
const ACTION_GROUP_TAB_LABELS: Record<string, string> = {
  'weapon-attacks': 'Attacks',
  feats: 'Feats',
  'basic-actions': 'Basic',
  'skill-actions': 'Skill',
  'speciality-basics': 'Speciality',
  'exploration-activities': 'Exploration',
  'downtime-activities': 'Downtime',
};

export const CONDITION_PILL_CLASS = 'inline-flex max-w-[8.5rem] items-center truncate rounded-full border border-p1-border bg-p1-hover px-2 py-[3px] text-[10px] font-medium leading-none tracking-wide text-p1-text';
export function conditionLabel(condition: Condition) {
  return condition.value != null ? `${condition.name} ${condition.value}` : condition.name;
}
export function setConditionValue(current: Condition[], name: string, value: number) {
  return current.map((item) => (item.name === name ? { ...item, value } : item));
}
export function hasFullEntityDetails(combatant: PopulatedCombatant) {
  return combatant.type === 'CREATURE' || Boolean((combatant.data as Partial<Character>).user_id);
}
export function statsFor(entity: LivingEntity) {
  const profs = entity.meta_data?.calculated_stats?.profs;
  const storedMax = entity.meta_data?.calculated_stats?.hp_max;
  return { ac: entity.meta_data?.calculated_stats?.ac ?? 10, fort: profs?.SAVE_FORT?.total ?? 0, reflex: profs?.SAVE_REFLEX?.total ?? 0, will: profs?.SAVE_WILL?.total ?? 0, maxHp: storedMax && storedMax > 0 ? storedMax : entity.hp_current };
}
export function signed(value: number) { return value >= 0 ? `+${value}` : String(value); }
export function EmptyState({ children }: { children: ReactNode }) { return <div className='border border-p1-border p-8 text-center text-sm text-p1-muted'>{children}</div>; }
export function ErrorState({ error }: { error: Error }) { return <div className='border border-p1-danger/40 bg-p1-danger/10 p-4 text-sm text-p1-danger-soft'>{error.message}</div>; }
export function Eyebrow({ children }: { children: ReactNode }) { return <div className='text-[10px] font-semibold uppercase text-p1-accent'>{children}</div>; }

export function InspectorContent({ combatant, tab, hasMatchingCampaignNote, status, statusLoading, spellActions, onChangeConditions, onSaveGmNotes, onPersistHpCurrent, onPersistTempHp, initiativeLog, canEditRoundNotes, onUpdateRoundNote, onLogAction, onDeleteLogEntry }: { combatant: PopulatedCombatant; tab: DetailTab; hasMatchingCampaignNote?: boolean; status?: Phase1CreatureStatus | null; statusLoading: boolean; spellActions?: Phase1SpellActions; onChangeConditions?: (conditions: Condition[], note?: string | null) => void; onSaveGmNotes?: (text: string) => void; onPersistHpCurrent?: (raw: string, note: string | null) => void; onPersistTempHp?: (raw: string, note: string | null) => void; initiativeLog?: InitiativeRoundLog[]; canEditRoundNotes?: boolean; onUpdateRoundNote?: (round: InitiativeRoundLog, entry: InitiativeRoundLogEntry, note: string) => void; onLogAction?: (draft: ActionLogDraft) => void; onDeleteLogEntry?: (entryId: string) => void }) {
  const [pendingOverLimit, setPendingOverLimit] = useState<{ draft: ActionLogDraft; run: () => void | Promise<void> } | null>(null);
  const round = currentActionRound(initiativeLog);

  const requestLog: LogActionFn = (draft, beforeLog) => {
    const run = async () => {
      await beforeLog?.();
      onLogAction?.(draft);
    };
    if (onLogAction && wouldExceedRoundActions(combatant.action_log, round, draft.cost)) {
      setPendingOverLimit({ draft, run });
      return;
    }
    void run();
  };

  const overLimitDialog = pendingOverLimit ? (
    <ConfirmDialog
      title={`Round ${round} would exceed 3 actions`}
      message={`${pendingOverLimit.draft.name} would bring this round to ${roundActionTotal(combatant.action_log, round) + actionCostCount(pendingOverLimit.draft.cost)} actions. Log it anyway?`}
      confirmLabel='Log anyway'
      cancelLabel='Cancel'
      confirmDanger
      onCancel={() => setPendingOverLimit(null)}
      onConfirm={async () => {
        await pendingOverLimit.run();
        setPendingOverLimit(null);
      }}
    />
  ) : null;

  let body: ReactNode;
  if (tab === 'Health') body = <HealthStatusPanel combatant={combatant} calculatedStatus={status} calculating={statusLoading} onChangeConditions={onChangeConditions} onPersistHpCurrent={onPersistHpCurrent} onPersistTempHp={onPersistTempHp} />;
  else if (tab === 'Abilities') body = <AbilitiesPanel combatant={combatant} onLogAction={onLogAction ? requestLog : undefined} />;
  else if (tab === 'Skills') body = <SkillsActionsPanel combatant={combatant} onLogAction={onLogAction ? requestLog : undefined} />;
  else if (tab === 'Spells') body = <SpellsPanel combatant={combatant} spellActions={spellActions} onLogAction={onLogAction ? requestLog : undefined} />;
  else if (tab === 'Inventory') body = <InventoryPanel combatant={combatant} status={status} />;
  else if (tab === 'Notes') {
    body = (
      <CombatantNotesPanel
        combatant={combatant}
        hasMatchingCampaignNote={hasMatchingCampaignNote}
        onSaveGmNotes={onSaveGmNotes}
        initiativeLog={initiativeLog ?? []}
        canEditRoundNotes={canEditRoundNotes}
        onUpdateRoundNote={onUpdateRoundNote}
      />
    );
  } else if (tab === 'Log') body = <ActionLogPanel combatant={combatant} onDelete={onDeleteLogEntry} />;
  else body = <DetailsAndSourcePanel combatant={combatant} />;

  return (
    <>
      {body}
      {overLimitDialog}
    </>
  );
}

function CombatantNotesPanel({ combatant, hasMatchingCampaignNote, onSaveGmNotes, initiativeLog, canEditRoundNotes, onUpdateRoundNote }: { combatant: PopulatedCombatant; hasMatchingCampaignNote?: boolean; onSaveGmNotes?: (text: string) => void; initiativeLog: InitiativeRoundLog[]; canEditRoundNotes?: boolean; onUpdateRoundNote?: (round: InitiativeRoundLog, entry: InitiativeRoundLogEntry, note: string) => void }) {
  const [innerTab, setInnerTabState] = useState<'gm' | 'combat'>(persistedNotesInnerTab);
  const setInnerTab = (tab: 'gm' | 'combat') => {
    persistedNotesInnerTab = tab;
    setInnerTabState(tab);
  };
  const rounds = [...initiativeLog].reverse().flatMap((round) => {
    const entry = round.entries.find((item) => roundLogEntryMatchesCombatant(item, combatant));
    return entry ? [{ round, entry }] : [];
  });
  const changes = [...(combatant.change_log ?? [])].reverse();

  return (
    <>
      <div className='mb-2.5 grid grid-cols-2 border-b border-p1-border'>
        <InnerTab active={innerTab === 'gm'} onClick={() => setInnerTab('gm')}>GM notes</InnerTab>
        <InnerTab active={innerTab === 'combat'} onClick={() => setInnerTab('combat')}>Combat log</InnerTab>
      </div>
      {innerTab === 'gm' && (
        hasMatchingCampaignNote && !onSaveGmNotes
          ? <p className='border border-p1-border bg-p1-surface p-4 text-sm leading-5 text-p1-text'>see campaign note of same name</p>
          : <EntityNotesPanel key={combatant._id} notes={combatant.data.notes} onSave={onSaveGmNotes} />
      )}
      {innerTab === 'combat' && (
        <div className='space-y-4'>
          {rounds.length === 0 && changes.length === 0 && <p className='py-6 text-center text-xs italic text-p1-faint'>No rounds logged for this combatant yet.</p>}
          {rounds.map(({ round, entry }, index) => (
            <div key={round.id ?? `${round.round}-${index}`} className='border border-p1-border bg-p1-surface p-3'>
              <p className='text-[10px] font-semibold uppercase tracking-wide text-p1-accent'>Round {round.round}</p>
              <p className='mt-1 text-xs text-p1-muted'>{entry.initiative != null ? `Init ${entry.initiative}` : 'No init'}{entry.calculation ? ` · ${entry.calculation}` : ''}</p>
              <div className='mt-2'>
                <RoundNoteField value={entry.note} disabled={!canEditRoundNotes} onCommit={(note) => onUpdateRoundNote?.(round, entry, note)} />
              </div>
            </div>
          ))}
          {changes.length > 0 && (
            <div>
              <p className='mb-2 text-[10px] font-semibold uppercase tracking-wide text-p1-faint'>Status changes</p>
              <ul className='space-y-2'>
                {changes.map((entry: CombatantChangeLogEntry) => (
                  <li key={entry.id} className='border border-p1-border bg-p1-surface px-2.5 py-2 text-[10px] leading-5 text-p1-text'>
                    <div className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
                      <span className='text-p1-faint'>{formatChangeLogTime(entry.at)}</span>
                      <span className='font-semibold'>{formatChangeLogField(entry.field)}</span>
                      <span>
                        {formatChangeLogValue(entry.field, entry.from)}
                        <span className='px-1 text-p1-faint'>→</span>
                        {formatChangeLogValue(entry.field, entry.to)}
                      </span>
                    </div>
                    {entry.note ? <p className='mt-1 italic text-p1-muted'>“{entry.note}”</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function SkillsActionsPanel({ combatant, onLogAction }: { combatant: PopulatedCombatant; onLogAction?: LogActionFn }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [innerTab, setInnerTabState] = useState<'skills' | 'actions'>(persistedSkillsInnerTab);
  const [skillQuery, setSkillQuery] = useState('');
  const [actionQuery, setActionQuery] = useState('');
  const [actionCost, setActionCostState] = useState<string>(persistedSkillsActionCost);
  const setInnerTab = (tab: 'skills' | 'actions') => {
    persistedSkillsInnerTab = tab;
    setInnerTabState(tab);
  };
  const setActionCost = (cost: string) => {
    persistedSkillsActionCost = cost;
    setActionCostState(cost);
  };
  const [actionGroup, setActionGroupState] = useState(persistedActionGroup);
  const setActionGroup = (group: string) => {
    persistedActionGroup = group;
    setActionGroupState(group);
  };
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<Phase1Ability | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Phase1Skill | null>(null);
  const data = useQuery({
    queryKey: ['phase1-entity-skills-actions', 'isolated-store', combatant.type, combatant._id],
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
    <div className='mb-2.5 grid grid-cols-2 border-b border-p1-border'>
      <InnerTab active={innerTab === 'skills'} onClick={() => setInnerTab('skills')}>Skills</InnerTab>
      <InnerTab active={innerTab === 'actions'} onClick={() => setInnerTab('actions')}>Actions / Abilities</InnerTab>
    </div>
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {data.isLoading && <EmptyState>Calculating skills and actions...</EmptyState>}
    {data.isError && <ErrorState error={data.error} />}
    {data.data && innerTab === 'skills' && <SkillsList skills={skills} query={skillQuery} onQuery={setSkillQuery} onOpen={setSelectedSkill} />}
    {data.data && innerTab === 'actions' && <ActionsCatalog groups={groups} allGroupIds={(data.data.groups ?? []).map((group) => group.id)} query={actionQuery} onQuery={setActionQuery} cost={actionCost} onCost={setActionCost} groupFilter={actionGroup} onGroupFilter={setActionGroup} openGroup={openGroup} onOpenGroup={setOpenGroup} filtering={filtering} onOpen={setSelected} onExecute={onLogAction} />}
    {selected && <AbilityModal ability={selected} onClose={() => setSelected(null)} />}
    {selectedSkill && <SkillModal skill={selectedSkill} onClose={() => setSelectedSkill(null)} onLogAction={onLogAction} />}
  </>;
}

function InnerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={`shrink-0 border-b-2 px-2 py-2 text-xs ${active ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:text-p1-text'}`} onClick={onClick}>{children}</button>;
}
export { InnerTab };

function DetailsAndSourcePanel({ combatant }: { combatant: PopulatedCombatant }) {
  const [innerTab, setInnerTabState] = useState<'details' | 'source'>(persistedDetailsInnerTab);
  const setInnerTab = (tab: 'details' | 'source') => {
    persistedDetailsInnerTab = tab;
    setInnerTabState(tab);
  };
  return (
    <>
      <div className='mb-2.5 grid grid-cols-2 border-b border-p1-border'>
        <InnerTab active={innerTab === 'details'} onClick={() => setInnerTab('details')}>Details</InnerTab>
        <InnerTab active={innerTab === 'source'} onClick={() => setInnerTab('source')}>Source</InnerTab>
      </div>
      {innerTab === 'details' ? <DetailsPanel combatant={combatant} /> : <SourceImportNotesPanel notes={combatant.data.notes} />}
    </>
  );
}

function ActionLogPanel({ combatant, onDelete }: { combatant: PopulatedCombatant; onDelete?: (entryId: string) => void }) {
  const groups = groupActionLogByRound(combatant.action_log);
  if (groups.length === 0) return <EmptyState>No actions logged yet. Double-click an attack or 1–3 action ability, or press Cast on a spell.</EmptyState>;
  return (
    <div className='space-y-4'>
      {groups.map((group) => (
        <section key={group.round}>
          <div className='mb-2 flex items-baseline gap-2'>
            <h3 className='text-[10px] font-semibold uppercase tracking-wide text-p1-accent'>Round {group.round}</h3>
            <span className={`text-[10px] ${group.spent > 3 ? 'text-p1-danger-soft' : 'text-p1-faint'}`}>{group.spent} / 3 actions</span>
          </div>
          <ul className='space-y-1.5'>
            {group.entries.map((entry: CombatantActionLogEntry) => (
              <li key={entry.id} className='flex items-center gap-2 border border-p1-border bg-p1-surface px-2.5 py-2'>
                <span className='shrink-0 text-[10px] text-p1-faint'>{formatChangeLogTime(entry.at)}</span>
                <ActionSymbol cost={entry.cost} />
                <span className='min-w-0 flex-1 truncate text-sm'>
                  {entry.name}
                  {entry.extra ? <span className='ml-2 text-[10px] text-p1-muted'>{entry.extra}</span> : null}
                </span>
                {onDelete && (
                  <button type='button' className='icon-button shrink-0' title='Remove log entry' onClick={() => onDelete(entry.id)}>
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SkillsList({ skills, query, onQuery, onOpen }: { skills: Phase1Skill[]; query: string; onQuery: (value: string) => void; onOpen: (skill: Phase1Skill) => void }) {
  return <div>
    <SearchField value={query} onChange={onQuery} placeholder='Search skills' />
    <div className='mt-2 space-y-1.5'>
      {skills.map((skill) => <button key={skill.name} className='flex h-9 w-full items-center border border-p1-border bg-p1-surface px-3 text-left text-sm hover:border-p1-border hover:bg-p1-hover' onClick={() => onOpen(skill)}>
        <span className='truncate'>{skill.name}</span>
        <strong className='ml-auto text-p1-text'>{signed(skill.modifier)}</strong>
        <span className='ml-3 grid h-5 min-w-6 place-items-center bg-p1-hover px-1.5 text-[10px] font-semibold text-p1-muted' title={proficiencyName(skill.rank)}>{skill.rank}</span>
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

export function SkillModal({ skill, onClose, onLogAction }: { skill: Phase1Skill; onClose: () => void; onLogAction?: LogActionFn }) {
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
      <section role='dialog' aria-modal='true' aria-labelledby={`skill-${skill.variableName}-title`} className='flex h-[min(82vh,720px)] w-full max-w-4xl flex-col border border-p1-border bg-p1-surface shadow-2xl'>
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <div className='min-w-0 flex-1'><h2 id={`skill-${skill.variableName}-title`} className='text-xl font-semibold'>{skill.name}</h2><div className='mt-2 flex items-center gap-2'><Tag>{proficiencyName(skill.rank)}</Tag><span className='text-sm font-semibold text-p1-text'>{signed(skill.modifier)}</span></div></div>
          <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close skill details'><X size={18} /></button>
        </header>
        <div className='grid grid-cols-4 border-b border-p1-border bg-p1-inset' role='tablist' aria-label='Skill details'>
          {SKILL_MODAL_TABS.map((item) => <button key={item.id} role='tab' aria-selected={tab === item.id} className={`flex h-11 items-center justify-center gap-2 border-b-2 px-3 text-xs ${tab === item.id ? 'border-p1-accent bg-p1-hover text-p1-accent-soft' : 'border-transparent text-p1-muted hover:text-p1-text'}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto p-5'>
          {tab === 'description' && <div className='mx-auto max-w-3xl text-sm leading-7 text-p1-text'><p>{skill.description}</p></div>}
          {tab === 'actions' && <div className='mx-auto max-w-3xl space-y-1.5'>{skill.actions.map((ability, index) => <AbilityRow key={`${ability.id}-${index}`} ability={ability} onOpen={setSelectedAction} onExecute={onLogAction} compact />)}{skill.actions.length === 0 && <EmptyState>No actions found for this skill.</EmptyState>}</div>}
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
    <div className='mb-5 flex flex-wrap items-center gap-2 border border-p1-border bg-p1-inset px-4 py-4 text-sm'><strong className='mr-1 text-lg text-p1-text'>{signed(skill.breakdown.final)} =</strong>{skill.breakdown.terms.map((term, index) => <span key={`${term.label}-${index}`} className='inline-flex items-center gap-2'>{index > 0 && <span className='text-p1-faint'>{term.value >= 0 ? '+' : '-'}</span>}<span className='border border-p1-border bg-p1-hover px-2.5 py-1 font-mono text-p1-text' title={term.label}>{Math.abs(term.value)}</span></span>)}</div>
    <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>{skill.breakdown.terms.map((term, index) => <section key={`${term.label}-detail-${index}`} className='border border-p1-border bg-p1-inset p-3'><div className='flex items-center gap-3'><strong className='text-sm text-p1-text'>{term.label}</strong><span className='ml-auto font-mono text-sm text-p1-accent-soft'>{signed(term.value)}</span></div><p className='mt-2 text-xs leading-5 text-p1-muted'>{term.detail}</p>{term.sources?.map((source, sourceIndex) => <p key={sourceIndex} className='mt-1 text-[11px] text-p1-faint'>{signed(source.amount)} from {source.source}</p>)}</section>)}</div>
    {skill.breakdown.conditionals.length > 0 && <section className='mt-4 border border-p1-accent/30 bg-p1-accent/[0.07] p-3'><h3 className='text-xs font-semibold uppercase text-p1-accent-soft'>Situational modifiers</h3>{skill.breakdown.conditionals.map((item, index) => <p key={index} className='mt-2 text-xs leading-5 text-p1-text'>{item.text} <span className='text-p1-faint'>from {item.source}</span></p>)}</section>}
  </div>;
}

function SkillTimeline({ skill }: { skill: Phase1Skill }) {
  if (!skill.timeline.length) return <EmptyState>No recorded history found for this proficiency.</EmptyState>;
  return <ol className='mx-auto max-w-2xl'>{skill.timeline.map((item, index) => <li key={`${item.timestamp}-${index}`} className='grid grid-cols-[28px_minmax(0,1fr)]'><span className='relative flex justify-center'><span className={`z-10 mt-1.5 h-3 w-3 border ${item.type === 'ADJUSTMENT' ? 'border-p1-accent bg-p1-accent' : 'border-p1-pc bg-p1-pc'}`} />{index < skill.timeline.length - 1 && <span className='absolute bottom-0 top-4 w-px bg-p1-hover' />}</span><div className='pb-6'><strong className='text-sm text-p1-text'>{item.title}</strong><p className='mt-1 text-xs italic text-p1-muted'>{item.description}</p></div></li>)}</ol>;
}
function ActionsCatalog({ groups, allGroupIds, query, onQuery, cost, onCost, groupFilter, onGroupFilter, openGroup, onOpenGroup, filtering, onOpen, onExecute }: {
  groups: Phase1ActionGroup[]; allGroupIds: string[]; query: string; onQuery: (value: string) => void; cost: string; onCost: (value: string) => void;
  groupFilter: string; onGroupFilter: (value: string) => void;
  openGroup: string | null; onOpenGroup: (value: string | null) => void; filtering: boolean; onOpen: (ability: Phase1Ability) => void;
  onExecute?: (draft: ActionLogDraft) => void;
}) {
  const costs = ['ALL', 'ONE-ACTION', 'TWO-ACTIONS', 'THREE-ACTIONS', 'FREE-ACTION', 'REACTION'];
  const groupTabs = allGroupIds;
  const activeGroup = groupFilter === 'ALL' || groupTabs.includes(groupFilter) ? groupFilter : 'ALL';
  const visibleGroups = activeGroup === 'ALL' ? groups : groups.filter((group) => group.id === activeGroup);
  return <div>
    {groupTabs.length > 1 && (
      <div className='mb-2.5 flex overflow-x-auto border-b border-p1-border'>
        <InnerTab active={activeGroup === 'ALL'} onClick={() => onGroupFilter('ALL')}>All</InnerTab>
        {groupTabs.map((id) => (
          <InnerTab key={id} active={activeGroup === id} onClick={() => onGroupFilter(id)}>
            {ACTION_GROUP_TAB_LABELS[id] ?? groups.find((group) => group.id === id)?.label ?? id}
          </InnerTab>
        ))}
      </div>
    )}
    <SearchField value={query} onChange={onQuery} placeholder='Search actions & activities' />
    <div className='my-2 flex items-center gap-1 border-b border-p1-border pb-2'>
      {costs.map((value) => <button key={value} className={`grid h-8 min-w-8 place-items-center px-2 text-[10px] ${cost === value ? 'bg-p1-accent text-p1-accent-ink' : 'bg-p1-hover text-p1-muted hover:text-p1-text'}`} title={value === 'ALL' ? 'All action costs' : value.toLowerCase().replaceAll('-', ' ')} onClick={() => onCost(value)}>{value === 'ALL' ? 'All' : <ActionSymbol cost={value as Phase1Ability['actions']} />}</button>)}
    </div>
    <div className='space-y-1'>
      {visibleGroups.map((group) => {
        const open = activeGroup !== 'ALL' || filtering || openGroup === group.id;
        return <section key={group.id} className='border-b border-p1-border'>
          {activeGroup === 'ALL' && (
            <button className='flex h-9 w-full items-center px-1 text-left text-sm font-semibold hover:bg-p1-hover' onClick={() => onOpenGroup(openGroup === group.id ? null : group.id)}>
              <span className='truncate'>{group.label}</span><span className='ml-auto mr-2 border border-p1-border px-2 py-0.5 text-[10px] font-normal text-p1-muted'>{group.actions.length}</span><ChevronDown size={14} className={`text-p1-muted transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
          {open && <div className='space-y-1 pb-2 pt-1'>{group.actions.map((ability, index) => <AbilityRow key={`${group.id}-${ability.id}-${index}`} ability={ability} onOpen={onOpen} onExecute={onExecute} compact />)}</div>}
        </section>;
      })}
      {!visibleGroups.length && <EmptyState>No actions match these filters.</EmptyState>}
    </div>
  </div>;
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className='relative'><Search className='absolute left-3 top-1/2 -translate-y-1/2 text-p1-faint' size={14} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className='h-9 w-full border border-p1-border bg-p1-surface pl-9 pr-3 text-sm outline-none placeholder:text-p1-faint focus:border-p1-accent/60' /></div>;
}
function proficiencyName(rank: string) { return ({ U: 'Untrained', T: 'Trained', E: 'Expert', M: 'Master', L: 'Legendary' } as Record<string, string>)[rank] ?? rank; }
export function AbilitiesPanel({ combatant, onLogAction }: { combatant: PopulatedCombatant; onLogAction?: LogActionFn }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [query, setQuery] = useState('');
  const [innerTab, setInnerTabState] = useState<AbilityTab>(isAbilityTab(persistedAbilitiesInnerTab) ? persistedAbilitiesInnerTab : 'Feat');
  const [levelFilter, setLevelFilter] = useState<number | 'ALL'>('ALL');
  const [selected, setSelected] = useState<Phase1Ability | null>(null);
  const abilities = useQuery({
    queryKey: ['phase1-entity-abilities', 'isolated-store', combatant.type, combatant._id],
    enabled: detailsAvailable && combatant.access?.details_revealed !== false,
    queryFn: () => loadEntityAbilities(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const all = abilities.data ?? [];
  const tabSources = ABILITY_TAB_ORDER.filter((source) => all.some((ability) => ability.source === source));
  const activeTab = tabSources.includes(innerTab) ? innerTab : (tabSources[0] ?? 'Feat');
  const setInnerTab = (source: AbilityTab) => {
    persistedAbilitiesInnerTab = source;
    setInnerTabState(source);
  };
  const needle = query.trim().toLowerCase();
  const tabAbilities = all.filter((ability) => ability.source === activeTab);
  const presentLevels = new Set(tabAbilities.map((ability) => ability.level).filter((level): level is number => level != null));
  const minLevel = presentLevels.size ? Math.min(...presentLevels) : 0;
  const maxLevel = presentLevels.size ? Math.max(...presentLevels) : 0;
  const levelRange = presentLevels.size && maxLevel > minLevel ? Array.from({ length: maxLevel - minLevel + 1 }, (_, i) => minLevel + i) : [];
  const activeLevel = levelFilter !== 'ALL' && presentLevels.has(levelFilter) ? levelFilter : 'ALL';
  const visible = tabAbilities.filter((ability) => {
    if (activeLevel !== 'ALL' && ability.level !== activeLevel) return false;
    return !needle || [ability.name, ability.description, ability.source, ...ability.traitNames].join(' ').toLowerCase().includes(needle);
  });

  return <>
    {tabSources.length > 1 && (
      <div className='mb-2.5 grid border-b border-p1-border' style={{ gridTemplateColumns: `repeat(${tabSources.length}, minmax(0, 1fr))` }}>
        {tabSources.map((source) => (
          <InnerTab key={source} active={activeTab === source} onClick={() => { setInnerTab(source); setLevelFilter('ALL'); }}>
            {abilityGroupLabel(source)}
          </InnerTab>
        ))}
      </div>
    )}
    {levelRange.length > 0 && (
      <div className='mb-2.5 flex overflow-x-auto border-b border-p1-border' role='tablist' aria-label='Filter by level'>
        <button type='button' className={`shrink-0 border-b-2 px-3 py-1.5 text-xs ${activeLevel === 'ALL' ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:text-p1-text'}`} onClick={() => setLevelFilter('ALL')}>All</button>
        {levelRange.map((level) => {
          const enabled = presentLevels.has(level);
          return (
            <button
              key={level}
              type='button'
              disabled={!enabled}
              aria-disabled={!enabled}
              title={enabled ? `Level ${level}` : `No level ${level} abilities`}
              className={`shrink-0 border-b-2 px-3 py-1.5 text-xs ${!enabled ? 'cursor-not-allowed border-transparent text-p1-faint/50' : activeLevel === level ? 'border-p1-accent bg-p1-hover text-p1-text' : 'border-transparent text-p1-muted hover:text-p1-text'}`}
              onClick={() => setLevelFilter(activeLevel === level ? 'ALL' : level)}
            >
              {level}
            </button>
          );
        })}
      </div>
    )}
    <div className='relative mb-2.5'>
      <Search className='absolute left-3 top-1/2 -translate-y-1/2 text-p1-faint' size={14} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === 'Feat' ? 'Search feats' : activeTab === 'Character' ? 'Search class features' : 'Search abilities'} className='h-9 w-full border border-p1-border bg-p1-surface pl-9 pr-3 text-sm outline-none placeholder:text-p1-faint focus:border-p1-accent/60' />
    </div>
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {abilities.isLoading && <EmptyState>Loading abilities...</EmptyState>}
    {abilities.isError && <ErrorState error={abilities.error} />}
    {!abilities.isLoading && !visible.length && <EmptyState>No abilities found.</EmptyState>}
    {visible.length > 0 && activeTab === 'Feat' && (
      <div className='space-y-1.5'>
        {FEAT_GROUP_SECTIONS.map((section) => {
          const items = visible.filter((ability) => (ability.featCategory ?? 'other') === section.id);
          if (!items.length) return null;
          return (
            <AbilityGroupCard key={section.id} title={section.label}>
              {items.map((ability, index) => <AbilityRow key={`${ability.id}-${index}`} ability={ability} onOpen={setSelected} onExecute={onLogAction} compact />)}
            </AbilityGroupCard>
          );
        })}
      </div>
    )}
    {visible.length > 0 && activeTab === 'Character' && (
      <AbilityGroupCard title='Class Features'>
        {visible.map((ability, index) => <AbilityRow key={`${ability.id}-${index}`} ability={ability} onOpen={setSelected} onExecute={onLogAction} compact />)}
      </AbilityGroupCard>
    )}
    {visible.length > 0 && activeTab !== 'Feat' && activeTab !== 'Character' && (
      <section className='mb-2.5 border border-p1-border bg-p1-surface'>
        <div className='divide-y divide-white/[0.07]'>
          {visible.map((ability, index) => <AbilityRow key={`${ability.id}-${index}`} ability={ability} onOpen={setSelected} onExecute={onLogAction} />)}
        </div>
      </section>
    )}
    {selected && <AbilityModal ability={selected} onClose={() => setSelected(null)} />}
  </>;
}

function AbilityGroupCard({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className='overflow-visible rounded-lg border border-white/12 bg-p1-surface/80'>
      <button type='button' className='flex h-7 w-full items-center px-2.5 text-left text-xs font-semibold hover:bg-p1-hover' onClick={() => setOpen((value) => !value)}>
        <span className='truncate'>{title}</span>
        <ChevronDown size={12} className={`ml-auto text-p1-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className='divide-y divide-white/[0.07] border-t border-white/10'>{children}</div>}
    </section>
  );
}

function AbilityRow({ ability, onOpen, onExecute, compact = false }: { ability: Phase1Ability; onOpen: (ability: Phase1Ability) => void; onExecute?: (draft: ActionLogDraft) => void; compact?: boolean }) {
  const kind = classifyAbility(ability);
  const preview = plainText(ability.description).slice(0, 180);
  const { name, cost } = abilityNameAndCost(ability.name, ability.actions);
  const loggable = Boolean(onExecute) && isLoggableAbility(ability);
  const onClick = useClickVsDoubleClick(() => onOpen(ability), loggable ? () => onExecute?.(draftFromAbility(ability)) : undefined);
  const rowRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number>(0);
  const showTimer = useRef<number>(0);
  const [hoverBox, setHoverBox] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  const clearHoverTimers = () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  };
  const placeHover = () => {
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const gutter = compact ? 30 : 42;
    const width = Math.max(180, rect.width - gutter - 8);
    const left = Math.min(rect.left + gutter, window.innerWidth - width - 8);
    const above = window.innerHeight - rect.bottom < 160;
    setHoverBox(above
      ? { left, width, bottom: window.innerHeight - rect.top + 4 }
      : { left, width, top: rect.bottom + 4 });
  };
  useEffect(() => () => clearHoverTimers(), []);

  return <button
    ref={rowRef}
    className={`group relative grid w-full items-stretch text-left hover:bg-p1-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-p1-accent ${compact ? 'grid-cols-[30px_minmax(0,1fr)] bg-transparent' : 'grid-cols-[42px_minmax(0,1fr)] border border-p1-border bg-p1-surface hover:border-p1-border'}`}
    onClick={onClick}
    onMouseEnter={() => {
      clearHoverTimers();
      showTimer.current = window.setTimeout(placeHover, 300);
    }}
    onMouseLeave={() => {
      clearHoverTimers();
      hideTimer.current = window.setTimeout(() => setHoverBox(null), 80);
    }}
    title={loggable ? 'Click for info, double-click to log' : undefined}
  >
    <span className='grid place-items-center border-r border-p1-border text-p1-muted' title={kind.label}>
      {kind.type === 'ranged' ? <Crosshair size={compact ? 13 : 17} /> : kind.type === 'melee' ? <Swords size={compact ? 13 : 17} /> : <Sparkles size={compact ? 12 : 16} />}
      <span className='sr-only'>{kind.label}</span>
    </span>
    <span className={`flex min-w-0 items-center ${compact ? 'gap-1.5 px-2 py-1' : 'gap-2 px-3 py-2.5'}`}>
      <ActionSymbol cost={cost} size={compact ? 12 : undefined} />
      <span className={`min-w-0 flex-1 truncate ${compact ? 'text-xs' : 'text-sm'}`}>{name}</span>
      {ability.level != null && <span className={`text-p1-faint ${compact ? 'text-[9px]' : 'text-[10px]'}`}>Lvl {ability.level}</span>}
    </span>
    {hoverBox && createPortal(
      <span
        className='pointer-events-none hidden max-h-[40vh] overflow-hidden border border-p1-border bg-p1-surface p-3 shadow-xl md:block'
        style={{ position: 'fixed', zIndex: 90, left: hoverBox.left, width: hoverBox.width, top: hoverBox.top, bottom: hoverBox.bottom }}
      >
        <span className='flex items-center gap-2 text-xs font-semibold text-p1-text'><ActionSymbol cost={cost} />{name}</span>
        {ability.traitNames.length > 0 && <span className='mt-1.5 block truncate text-[9px] uppercase text-p1-muted'>{ability.traitNames.join(' | ')}</span>}
        <span className='mt-2 block text-[11px] leading-4 text-p1-muted'>{preview}{plainText(ability.description).length > preview.length ? '...' : ''}</span>
      </span>,
      document.body
    )}
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
      <section role='dialog' aria-modal='true' aria-labelledby={`ability-${ability.id}-title`} className={`flex max-h-[min(82vh,820px)] w-full flex-col border border-p1-border bg-p1-surface shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
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
          {ability.special && <div className='mt-4 border-t border-p1-border pt-4'><strong className='mr-2 text-p1-text'>Special</strong><ProseMarkdown>{ability.special}</ProseMarkdown></div>}
        </div>
      </section>
    </div>,
    document.body
  );
}

export type InventoryItemActions = {
  toggleEquipped: (item: Phase1InvItem) => void;
  toggleInvested: (item: Phase1InvItem) => void;
  setQuantity: (item: Phase1InvItem, quantity: number) => void;
  addItem?: (item: Item, type: AddItemKind, coins?: Inventory['coins']) => void | Promise<void>;
  deleteItem?: (item: Phase1InvItem) => void;
  updateItem?: (item: Phase1InvItem, next: Item) => void;
  moveItem?: (item: Phase1InvItem, containerKey: string | null) => void;
};

export function InventoryPanel({ combatant, itemActions, status }: { combatant: PopulatedCombatant; itemActions?: InventoryItemActions; status?: Phase1CreatureStatus | null }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [query, setQuery] = useState('');
  const [invTab, setInvTabState] = useState(persistedInventoryTab);
  const [selected, setSelected] = useState<Phase1InvItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ item: Phase1InvItem; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<Phase1InvItem | null>(null);
  const data = useQuery({
    queryKey: ['phase1-entity-inventory', 'isolated-store', combatant.type, combatant._id],
    enabled: detailsAvailable && combatant.access?.details_revealed !== false,
    queryFn: () => loadEntityInventory(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const setInvTab = (tab: typeof persistedInventoryTab) => {
    persistedInventoryTab = tab;
    setInvTabState(tab);
  };
  const needle = query.trim().toLowerCase();
  const rawInventory = combatant.data.inventory;
  const extras = Object.fromEntries(
    Object.entries((rawInventory ?? {}) as Record<string, unknown>).filter(([key]) => key !== 'coins' && key !== 'items')
  );
  const extraKeys = Object.keys(extras);
  const topLevelItems = (rawInventory?.items ?? []).map((entry, index) => inventoryItemToPhase1(entry, entry.id || String(index)));
  const visibleItems = needle ? flattenInvItems(topLevelItems).filter((item) => matchesInvItem(item, needle)) : topLevelItems;
  const equipped = visibleItems.filter((item) => item.isEquipped && !item.isContainer);
  const carried = visibleItems.filter((item) => !item.isEquipped && !item.isContainer);
  const containers = visibleItems.filter((item) => item.isContainer);
  const buckets: Array<{ id: typeof persistedInventoryTab; label: string; items: typeof equipped }> = [
    { id: 'equipped', label: 'Equipped', items: equipped },
    { id: 'carried', label: 'Carried', items: carried },
    { id: 'containers', label: 'Containers', items: containers },
  ];
  const allItems = flattenInvItems(topLevelItems);
  const canAdd = Boolean(itemActions?.addItem);
  const tabBuckets = buckets.filter((bucket) => {
    if (canAdd) return true;
    if (needle) return bucket.items.length > 0;
    if (bucket.id === 'containers') return allItems.some((item) => item.isContainer);
    if (bucket.id === 'equipped') return allItems.some((item) => item.isEquipped && !item.isContainer);
    return allItems.some((item) => !item.isEquipped && !item.isContainer);
  });
  const activeInv = tabBuckets.some((bucket) => bucket.id === invTab) ? invTab : (tabBuckets[0]?.id ?? 'equipped');
  const activeItems = buckets.find((bucket) => bucket.id === activeInv)?.items ?? [];
  const inventory = rawInventory ? { coins: rawInventory.coins, extras, items: topLevelItems } : data.data;
  const liveSelected = selected ? flattenInvItems(topLevelItems).find((item) => item.key === selected.key) ?? selected : null;
  const editingSource = editing ? findInventoryItem(combatant.data.inventory?.items, editing.key)?.item : undefined;
  const coins = inventory?.coins ?? { cp: 0, sp: 0, gp: 0, pp: 0 };
  const carriedBulk = labelizeBulk(getInvBulk(rawInventory ?? undefined), true);
  const bulkLimit = data.data?.bulkLimit ?? 5 + (status?.attributes.strength ?? 0);
  const overBulk = Math.floor(getInvBulk(rawInventory ?? undefined)) > bulkLimit;

  return <>
    {extraKeys.map((key) => <DataSection key={key} title={toInventoryExtraLabel(key)} data={extras[key]} />)}
    {tabBuckets.length > 1 && (
      <div className='mb-2.5 mt-3 flex overflow-x-auto border-b border-p1-border'>
        {tabBuckets.map((bucket) => (
          <InnerTab key={bucket.id} active={activeInv === bucket.id} onClick={() => setInvTab(bucket.id)}>{bucket.label}</InnerTab>
        ))}
      </div>
    )}
    <div className={`mb-2.5 flex flex-wrap items-center gap-2 ${tabBuckets.length > 1 ? '' : 'mt-3'}`}>
      <div className='relative min-w-0 flex-1'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 text-p1-faint' size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search items' className='h-9 w-full border border-p1-border bg-p1-surface pl-9 pr-3 text-sm outline-none placeholder:text-p1-faint focus:border-p1-accent/60' />
      </div>
      <span className={`shrink-0 whitespace-nowrap border px-2.5 py-1.5 text-xs ${overBulk ? 'border-p1-danger/50 bg-p1-danger/10 text-p1-danger-soft' : 'border-p1-border bg-p1-surface text-p1-muted'}`}>
        Bulk: {carriedBulk} / {bulkLimit}
      </span>
      <CoinStrip coins={coins} />
      {itemActions?.addItem && (
        <button
          type='button'
          className='inline-flex h-9 shrink-0 items-center gap-1 border border-p1-border bg-p1-surface px-3 text-xs font-semibold text-p1-text hover:bg-p1-hover'
          onClick={() => setAdding(true)}
        >
          <Plus size={14} />
          Add items
        </button>
      )}
    </div>
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {detailsAvailable && !rawInventory && data.isLoading && <EmptyState>Loading inventory...</EmptyState>}
    {detailsAvailable && data.isError && !rawInventory && <ErrorState error={data.error} />}
    {detailsAvailable && topLevelItems.length === 0 && <EmptyState>No items in inventory.</EmptyState>}
    {detailsAvailable && needle && !visibleItems.length && topLevelItems.length > 0 && <EmptyState>No items match this search.</EmptyState>}
    {detailsAvailable && activeItems.length > 0 && (
      <InventoryItemSection
        title={buckets.find((bucket) => bucket.id === activeInv)?.label ?? 'Items'}
        items={activeItems}
        onOpen={setSelected}
        onContextMenu={itemActions ? (event, item) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ item, x: event.clientX, y: event.clientY });
        } : undefined}
        flat={Boolean(needle)}
        collapsible={activeInv === 'containers' && !needle}
        hideTitle={tabBuckets.length > 1}
      />
    )}
    {liveSelected && (
      <ItemModal
        item={liveSelected}
        actions={itemActions ? {
          ...itemActions,
          toggleEquipped: (item) => {
            itemActions.toggleEquipped(item);
            setInvTab(item.isEquipped ? 'carried' : 'equipped');
          },
        } : undefined}
        onClose={() => setSelected(null)}
      />
    )}
    {menu && itemActions && (
      <InventoryItemContextMenu
        x={menu.x}
        y={menu.y}
        equipped={menu.item.isEquipped}
        canEquip={!menu.item.isFormula}
        nested={inventoryItemIsNested(topLevelItems, menu.item.key)}
        containers={inventoryContainerTargets(topLevelItems, menu.item.key)}
        canEdit={Boolean(itemActions.updateItem)}
        canClone={Boolean(itemActions.addItem)}
        canDelete={Boolean(itemActions.deleteItem) && !menu.item.unselectable}
        canMove={Boolean(itemActions.moveItem) && !menu.item.unselectable}
        onClose={() => setMenu(null)}
        onToggleEquipped={() => {
          itemActions.toggleEquipped(menu.item);
          setInvTab(menu.item.isEquipped ? 'carried' : 'equipped');
          setMenu(null);
        }}
        onEdit={() => {
          setMenu(null);
          setEditing(menu.item);
        }}
        onClone={() => {
          const source = findInventoryItem(combatant.data.inventory?.items, menu.item.key)?.item;
          setMenu(null);
          if (!source || !itemActions.addItem) return;
          void itemActions.addItem(source, 'GIVE');
          setInvTab(isItemContainer(source) ? 'containers' : 'carried');
        }}
        onDelete={() => {
          itemActions.deleteItem?.(menu.item);
          setMenu(null);
          if (selected?.key === menu.item.key) setSelected(null);
        }}
        onMove={(containerKey) => {
          itemActions.moveItem?.(menu.item, containerKey);
          setMenu(null);
          setInvTab(containerKey ? 'containers' : (menu.item.isEquipped ? 'equipped' : 'carried'));
        }}
      />
    )}
    {editing && editingSource && itemActions?.updateItem && (
      <Phase1EditItemModal
        item={editingSource}
        onSave={(item) => {
          itemActions.updateItem?.(editing, item);
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    )}
    {adding && itemActions?.addItem && (
      <SelectAddItemsModal
        inventory={combatant.data.inventory}
        onAdd={async (item, type, coins) => {
          await itemActions.addItem?.(item, type, coins);
          setInvTab(isItemContainer(item) ? 'containers' : 'carried');
        }}
        onClose={() => setAdding(false)}
      />
    )}
  </>;
}

function CoinStrip({ coins }: { coins: { cp: number; sp: number; gp: number; pp: number } }) {
  const entries = [
    { label: 'Platinum', amount: coins.pp, src: PlatinumCoin },
    { label: 'Gold', amount: coins.gp, src: GoldCoin },
    { label: 'Silver', amount: coins.sp, src: SilverCoin },
    { label: 'Copper', amount: coins.cp, src: CopperCoin },
  ] as const;
  return (
    <div className='flex shrink-0 items-center gap-2'>
      {entries.map((entry) => (
        <span key={entry.label} className='inline-flex items-center gap-1 text-xs font-semibold text-p1-muted' title={entry.label}>
          {entry.amount.toLocaleString()}
          <img src={entry.src} alt={entry.label} className='h-4 w-4' />
        </span>
      ))}
    </div>
  );
}

function InventoryItemSection({ title, items, onOpen, onContextMenu, flat = false, collapsible = false, hideTitle = false }: {
  title: string;
  items: Phase1InvItem[];
  onOpen: (item: Phase1InvItem) => void;
  onContextMenu?: (event: ReactMouseEvent, item: Phase1InvItem) => void;
  flat?: boolean;
  collapsible?: boolean;
  hideTitle?: boolean;
}) {
  if (!items.length) return null;
  return (
    <section className='mb-2.5 border border-p1-border bg-p1-surface'>
      {!hideTitle && <h3 className='border-b border-p1-border px-3 py-2 text-xs font-semibold'>{title}</h3>}
      <div className='hidden grid-cols-[42px_minmax(0,1fr)_2.5rem_2.5rem_8rem] items-center gap-2 border-b border-p1-border px-0 py-1.5 text-[10px] uppercase tracking-wide text-p1-faint sm:grid'>
        <span />
        <span className='px-3'>Name</span>
        <span className='text-right'>Qty</span>
        <span className='text-right'>Bulk</span>
        <span className='pr-3 text-right'>Price</span>
      </div>
      <div className='divide-y divide-white/[0.07]'>
        {items.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            depth={0}
            showContents={!flat}
            collapsible={collapsible && !flat}
          />
        ))}
      </div>
    </section>
  );
}

function ItemRow({ item, onOpen, onContextMenu, depth, showContents = true, collapsible = false }: {
  item: Phase1InvItem;
  onOpen: (item: Phase1InvItem) => void;
  onContextMenu?: (event: ReactMouseEvent, item: Phase1InvItem) => void;
  depth: number;
  showContents?: boolean;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = plainText(item.description).slice(0, 180);
  const icon = itemGroupIcon(item.group);
  const canToggle = collapsible && item.isContainer;
  const contentsOpen = showContents && (!canToggle || expanded);
  return <>
    <button
      className='group relative grid w-full grid-cols-[42px_minmax(0,1fr)] items-stretch border-0 bg-transparent text-left hover:bg-p1-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-p1-accent sm:grid-cols-[42px_minmax(0,1fr)_2.5rem_2.5rem_8rem] sm:gap-2'
      style={{ paddingLeft: depth * 12 }}
      onClick={() => {
        if (canToggle) setExpanded((open) => !open);
        else onOpen(item);
      }}
      onContextMenu={onContextMenu ? (event) => onContextMenu(event, item) : undefined}
    >
      <span className='grid place-items-center border-r border-p1-border text-p1-muted' title={item.group}>
        {icon}
      </span>
      <span className='flex min-w-0 items-center gap-2 px-3 py-2.5'>
        {canToggle && (
          expanded
            ? <ChevronDown size={14} className='shrink-0 text-p1-faint' />
            : <ChevronRight size={14} className='shrink-0 text-p1-faint' />
        )}
        <span className='min-w-0 flex-1 truncate text-sm'>{item.name}</span>
        {item.isEquipped && <Tag>Equipped</Tag>}
        {item.isInvested && <Tag>Invested</Tag>}
        <span className='ml-auto flex shrink-0 items-center gap-2 text-[10px] text-p1-faint sm:hidden'>
          {item.showQuantity && item.quantity > 0 && <span>×{item.quantity}</span>}
          {item.bulkLabel !== '—' && <span>{item.bulkLabel}</span>}
          {item.priceLabel !== '—' && <span>{item.priceLabel}</span>}
        </span>
      </span>
      <span className='hidden items-center justify-end text-xs tabular-nums text-p1-muted sm:flex'>{item.showQuantity ? item.quantity : ''}</span>
      <span className='hidden items-center justify-end text-xs tabular-nums text-p1-muted sm:flex'>{item.bulkLabel !== '—' ? item.bulkLabel : ''}</span>
      <span className='hidden items-center justify-end whitespace-nowrap pr-3 text-xs tabular-nums text-p1-muted sm:flex'>{item.priceLabel !== '—' ? item.priceLabel : ''}</span>
      <span className='pointer-events-none invisible absolute bottom-[calc(100%+4px)] left-10 right-2 z-40 hidden border border-p1-border bg-p1-surface p-3 opacity-0 shadow-xl transition-opacity delay-300 group-hover:visible group-hover:opacity-100 md:block'>
        <span className='flex items-center gap-2 text-xs font-semibold text-p1-text'>{item.name}</span>
        {item.traitNames.length > 0 && <span className='mt-1.5 block truncate text-[9px] uppercase text-p1-muted'>{item.traitNames.join(' | ')}</span>}
        {item.damageSummary && <span className='mt-1 block text-[10px] text-p1-muted'>{item.damageSummary}</span>}
        <span className='mt-2 block text-[11px] leading-4 text-p1-muted'>{preview}{plainText(item.description).length > preview.length ? '...' : ''}</span>
      </span>
    </button>
    {contentsOpen && item.contents.length > 0 && (
      <div>
        {item.contents.map((child) => (
          <ItemRow
            key={child.key}
            item={child}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            depth={depth + 1}
            showContents={showContents}
            collapsible={collapsible}
          />
        ))}
      </div>
    )}
  </>;
}

function InventoryItemContextMenu({
  x,
  y,
  equipped,
  canEquip,
  nested,
  containers,
  canEdit,
  canClone,
  canDelete,
  canMove,
  onClose,
  onToggleEquipped,
  onEdit,
  onClone,
  onDelete,
  onMove,
}: {
  x: number;
  y: number;
  equipped: boolean;
  canEquip: boolean;
  nested: boolean;
  containers: Array<{ key: string; name: string }>;
  canEdit: boolean;
  canClone: boolean;
  canDelete: boolean;
  canMove: boolean;
  onClose: () => void;
  onToggleEquipped: () => void;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  onMove: (containerKey: string | null) => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState({ w: 176, h: 200 });
  const [subBox, setSubBox] = useState({ w: 176, h: 120 });
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const showMove = canMove && (nested || containers.length > 0);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu) setMenuBox({ w: menu.offsetWidth, h: menu.offsetHeight });
    const sub = subMenuRef.current;
    if (sub) setSubBox({ w: sub.offsetWidth, h: sub.offsetHeight });
  }, [moveOpen, canEquip, canEdit, canClone, canDelete, showMove, containers.length]);
  const pad = 8;
  const left = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - menuBox.w - pad));
  const top = Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - menuBox.h - pad));
  const cascadeRight = left + menuBox.w + subBox.w + pad < window.innerWidth;
  const cascadeLeft = cascadeRight ? left + menuBox.w : Math.max(pad, left - subBox.w);
  const cascadeTop = Math.min(top, Math.max(pad, window.innerHeight - subBox.h - pad));
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} />
      <div ref={menuRef} role='menu' className='fixed z-[110] min-w-44 border border-p1-border bg-p1-surface py-1 shadow-2xl' style={{ left, top }}>
        {canEquip && (
          <button
            type='button'
            role='menuitem'
            className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
            onMouseEnter={() => setMoveOpen(false)}
            onClick={onToggleEquipped}
          >
            {equipped ? 'Unequip' : 'Equip'}
          </button>
        )}
        {canEdit && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={onEdit}>
            <Pencil size={14} /> Edit
          </button>
        )}
        {canClone && (
          <button
            type='button'
            role='menuitem'
            className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
            onMouseEnter={() => setMoveOpen(false)}
            onClick={onClone}
          >
            <Copy size={14} /> Clone
          </button>
        )}
        {showMove && (
          <button
            type='button'
            role='menuitem'
            className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
            onMouseEnter={() => setMoveOpen(true)}
            onClick={() => setMoveOpen(true)}
          >
            Move
            <ChevronRight size={14} className='text-p1-faint' />
          </button>
        )}
        {canDelete && (
          <button type='button' role='menuitem' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-p1-danger-soft hover:bg-p1-hover' onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
      {showMove && moveOpen && (
        <div
          ref={subMenuRef}
          role='menu'
          className='fixed z-[111] min-w-44 border border-p1-border bg-p1-surface py-1 shadow-2xl'
          style={{ left: cascadeLeft, top: cascadeTop }}
          onMouseEnter={() => setMoveOpen(true)}
        >
          <button type='button' role='menuitem' className='flex w-full items-center px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover' onClick={() => onMove(null)}>
            Unstored
          </button>
          {containers.length > 0 && <div className='my-1 border-t border-p1-border' />}
          {containers.map((container) => (
            <button
              key={container.key}
              type='button'
              role='menuitem'
              className='flex w-full items-center px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
              onClick={() => onMove(container.key)}
            >
              {container.name}
            </button>
          ))}
        </div>
      )}
    </>,
    document.body
  );
}

function ItemModal({ item, actions, onClose }: { item: Phase1InvItem; actions?: InventoryItemActions; onClose: () => void }) {
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
      <section role='dialog' aria-modal='true' aria-labelledby={`item-${item.key}-title`} className={`flex max-h-[min(82vh,820px)] w-full flex-col border border-p1-border bg-p1-surface shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <span className='text-p1-muted'>{itemGroupIcon(item.group)}</span>
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
          {actions && !item.isFormula && (
            <div className='flex shrink-0 flex-wrap items-center gap-1.5'>
              <button type='button' className='h-8 border border-p1-border px-3 text-xs font-semibold text-p1-text hover:bg-p1-hover' onClick={() => actions.toggleEquipped(item)}>{item.isEquipped ? 'Unequip' : 'Equip'}</button>
              <button type='button' className='h-8 border border-p1-border px-3 text-xs font-semibold text-p1-text hover:bg-p1-hover' onClick={() => actions.toggleInvested(item)}>{item.isInvested ? 'Uninvest' : 'Invest'}</button>
            </div>
          )}
          <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close item'><X size={18} /></button>
        </header>
        <div className='min-h-0 overflow-y-auto px-5 py-4'>
          <div className='mb-4 space-y-1 border-b border-p1-border pb-4 text-sm leading-6'>
            <AbilityFact label='Level' value={String(item.level)} />
            <AbilityFact label='Bulk' value={item.bulkLabel} />
            <AbilityFact label='Price' value={item.priceLabel !== '—' ? item.priceLabel : null} />
            <AbilityFact label='Hands' value={item.hands} />
            <AbilityFact label='Usage' value={item.usage} />
            <AbilityFact label='Damage' value={item.damageSummary} />
            <AbilityFact label='Range' value={item.range} />
            <AbilityFact label='AC Bonus' value={item.acBonus != null ? String(item.acBonus) : null} />
            {item.quantity > 0 && (
              <div className='flex items-center gap-2'>
                <AbilityFact label='Quantity' value={String(item.quantity)} />
                {actions && (
                  <span className='flex items-center gap-1'>
                    <button type='button' className='grid h-6 w-6 place-items-center border border-p1-border text-xs hover:bg-p1-hover' onClick={() => actions.setQuantity(item, Math.max(0, item.quantity - 1))}>-</button>
                    <button type='button' className='grid h-6 w-6 place-items-center border border-p1-border text-xs hover:bg-p1-hover' onClick={() => actions.setQuantity(item, item.quantity + 1)}>+</button>
                  </span>
                )}
              </div>
            )}
          </div>
          <ProseMarkdown>{item.description}</ProseMarkdown>
          {item.isContainer && item.contents.length > 0 && (
            <div className='mt-4 border-t border-p1-border pt-4'>
              <h3 className='mb-2 text-xs font-semibold uppercase text-p1-muted'>Contents</h3>
              <div className='divide-y divide-white/[0.07] border border-p1-border'>
                {item.contents.map((child) => (
                  <div key={child.key} className='flex items-center gap-2 px-3 py-2 text-sm'>
                    <span className='text-p1-muted'>{itemGroupIcon(child.group)}</span>
                    <span className='min-w-0 flex-1 truncate'>{child.name}</span>
                    {child.quantity > 1 && <span className='text-[10px] text-p1-faint'>x{child.quantity}</span>}
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
  return value ? <div><strong className='mr-2 text-p1-text'>{label}</strong><span className='text-p1-muted'>{value}</span></div> : null;
}
export function Tag({ children }: { children: ReactNode }) { return <span className='border border-p1-border bg-p1-hover px-2 py-0.5 text-[10px] uppercase text-p1-muted'>{children}</span>; }
function plainText(value: string) {
  return toStandard2eProse(value)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function classifyAbility(ability: Phase1Ability) {
  if (ability.source === 'Weapon') {
    const text = `${ability.name} ${ability.description}`.toLowerCase();
    if (/\branged\b/.test(text)) return { type: 'ranged' as const, label: 'Ranged Strike' };
    return { type: 'melee' as const, label: 'Melee Strike' };
  }
  const text = `${ability.name} ${ability.description} ${ability.requirements ?? ''}`.toLowerCase();
  if (/\branged\b/.test(text)) return { type: 'ranged' as const, label: 'Ranged ability' };
  if (/\bmelee\b/.test(text)) return { type: 'melee' as const, label: 'Melee ability' };
  return { type: 'feature' as const, label: 'General ability' };
}
function abilityGroupLabel(source: Phase1Ability['source']) {
  if (source === 'Weapon') return 'Weapon Attacks';
  if (source === 'Character') return 'Class Features';
  if (source === 'Feat') return 'Feats';
  return `${source} Abilities`;
}
export function HealthStatusPanel({ combatant, calculatedStatus, calculating, onChangeConditions, onPersistHpCurrent, onPersistTempHp }: { combatant: PopulatedCombatant; calculatedStatus?: Phase1CreatureStatus | null; calculating: boolean; onChangeConditions?: (conditions: Condition[], note?: string | null) => void; onPersistHpCurrent?: (raw: string, note: string | null) => void; onPersistTempHp?: (raw: string, note: string | null) => void }) {
  const entity = combatant.data;
  const status = calculatedStatus ?? fallbackStatus(entity);  const resistanceSummary = status.resistances.length + status.weaknesses.length + status.immunities.length;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewing, setViewing] = useState<Condition | null>(null);
  const [openStat, setOpenStat] = useState<Phase1StatKey | null>(null);
  const [shieldItem, setShieldItem] = useState<Phase1InvItem | null>(null);
  const rawConditions = entity.details?.conditions ?? [];
  const conditions = compiledConditions(rawConditions);
  const canManage = Boolean(onChangeConditions);
  const canEditHp = Boolean(onPersistHpCurrent);
  const canEditTempHp = Boolean(onPersistTempHp);
  const canOpenStats = hasFullEntityDetails(combatant) && combatant.access?.details_revealed !== false;
  const openStatDetail = canOpenStats ? setOpenStat : undefined;
  const shield = getBestShield('CHARACTER', entity.inventory ?? undefined);
  const shieldHealth = shield ? getItemHealth(shield.item) : null;
  const currentHp = entity.hp_current ?? status.maxHp;

  const showPortrait = combatant.type !== 'CHARACTER';

  return (
    <div className='space-y-2.5'>
      <div className={showPortrait ? 'grid grid-cols-[minmax(0,1fr)_86px] gap-2.5' : undefined}>
        <section className='border border-p1-border bg-p1-surface'>
          <div className='grid grid-cols-2 px-3 py-3 text-center'>
            {canEditHp ? (
              <EditableValueWithNote
                label='Hit points'
                displayValue={<><span className='text-p1-hp'>{currentHp}</span><span className='mx-1.5 text-p1-faint'>/</span>{status.maxHp}</>}
                editValue={String(currentHp)}
                canEdit
                accentClass='text-p1-hp'
                onCommit={(raw, note) => onPersistHpCurrent?.(raw, note)}
              />
            ) : (
              <MetricButton disabled={!openStatDetail} onClick={() => openStatDetail?.('hp')} label='Hit points' value={<><span className='text-p1-hp'>{currentHp}</span><span className='mx-1.5 text-p1-faint'>/</span>{status.maxHp}</>} />
            )}
            {canEditTempHp ? (
              <EditableValueWithNote
                label='Temp. HP'
                displayValue={entity.hp_temp || '-'}
                editValue={entity.hp_temp ? String(entity.hp_temp) : ''}
                canEdit
                accentClass={entity.hp_temp ? 'text-p1-temp-hp' : 'text-p1-faint'}
                onCommit={(raw, note) => onPersistTempHp?.(raw, note)}
              />
            ) : (
              <Metric label='Temp. HP' value={entity.hp_temp || '-'} />
            )}
          </div>
          <button
            type='button'
            disabled={!openStatDetail}
            className='w-full border-t border-p1-border px-3 py-2 text-center text-[10px] text-p1-muted hover:bg-p1-hover hover:text-p1-text disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-p1-muted'
            onClick={() => openStatDetail?.('resist')}
          >
            {resistanceSummary ? 'Resistances, weaknesses & immunities' : 'No resistances or weaknesses'}
          </button>
        </section>
        {showPortrait && <CreaturePortrait combatant={combatant} />}
      </div>

      {resistanceSummary > 0 && (
        <button type='button' disabled={!openStatDetail} className='w-full border border-p1-border bg-p1-surface px-3 py-2 text-left text-[11px] leading-5 hover:border-p1-border hover:bg-p1-hover disabled:cursor-default disabled:hover:border-p1-border disabled:hover:bg-p1-surface' onClick={() => openStatDetail?.('resist')}>
          <StatusLine label='Resist' values={status.resistances} />
          <StatusLine label='Weak' values={status.weaknesses} />
          <StatusLine label='Immune' values={status.immunities} />
        </button>
      )}

      {combatant.type === 'CREATURE' && <section className='border border-p1-border bg-p1-surface px-3 py-2 text-center text-[11px] text-p1-muted'>
        {status.recallKnowledge ? <><strong className='font-semibold text-p1-text'>Recall Knowledge</strong> <span className='italic text-p1-muted'>({[status.recallKnowledge.trait, status.recallKnowledge.rarity].filter(Boolean).join(', ')})</span> {status.recallKnowledge.skill} DC {status.recallKnowledge.dc}</> : <span className='text-p1-faint'>Recall Knowledge unavailable</span>}
      </section>}

      <section className='grid grid-cols-3 divide-x divide-p1-border border border-p1-border bg-p1-surface'>
        <IconMetric icon={<Eye size={15} />} label='Perception' value={signed(status.perception)} detail={status.vision} onClick={() => openStatDetail?.('perception')} disabled={!openStatDetail} />
        <IconMetric icon={<Footprints size={15} />} label='Speed' value={status.speed ? `${status.speed} ft.` : '-'} detail={status.otherSpeeds.join(', ') || 'Land speed'} onClick={() => openStatDetail?.('speed')} disabled={!openStatDetail} />
        <div className='min-w-0 px-2 py-3 text-center'>
          <div className='flex items-center justify-center gap-1.5 text-xs text-p1-muted'>
            <Activity size={15} />
            Conditions
            {canManage && (
              <button
                type='button'
                aria-label='Add condition'
                className='grid h-4 w-4 place-items-center rounded-full bg-p1-hover text-p1-muted hover:bg-p1-hover hover:text-p1-text'
                onClick={() => setPickerOpen(true)}
              >
                <Plus size={10} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className='mt-1.5 flex min-h-6 flex-wrap items-center justify-center gap-1'>
            {conditions.length === 0 && <span className='text-[9px] italic text-p1-faint'>None active</span>}
            {conditions.map((condition) => (
              <button
                key={`${condition.name}-${condition.source ?? 'direct'}`}
                type='button'
                className={`${CONDITION_PILL_CLASS} hover:border-p1-border hover:bg-p1-hover`}
                title={condition.source ? `${conditionLabel(condition)} from ${condition.source}` : conditionLabel(condition)}
                onClick={() => {
                  if (canManage && (condition.source || condition.value === undefined)) {
                    onChangeConditions?.(removeConditionWithSpawns(rawConditions, condition), null);
                    return;
                  }
                  setViewing(condition);
                }}
              >
                {conditionLabel(condition)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className='grid grid-cols-[42%_58%] border border-p1-border bg-p1-surface'>
        <button type='button' disabled={!openStatDetail} className='grid place-items-center border-r border-p1-border px-3 py-3 text-center hover:bg-p1-hover disabled:cursor-default disabled:hover:bg-transparent' onClick={() => openStatDetail?.('ac')}>
          <Shield size={26} className='mb-1 text-p1-faint' />
          <strong className='text-xl leading-none'>{status.ac}</strong>
          <span className='mt-1 text-[9px] uppercase text-p1-faint'>Armor class</span>
        </button>
        <div className='divide-y divide-white/[0.07] px-3 py-1.5'>
          <DefenseRow label='Fortitude' value={status.fortitude} onClick={() => openStatDetail?.('fortitude')} disabled={!openStatDetail} />
          <DefenseRow label='Reflex' value={status.reflex} onClick={() => openStatDetail?.('reflex')} disabled={!openStatDetail} />
          <DefenseRow label='Will' value={status.will} onClick={() => openStatDetail?.('will')} disabled={!openStatDetail} />
          <button type='button' disabled={!openStatDetail} className='flex w-full items-center py-1.5 text-left text-xs hover:bg-p1-hover disabled:cursor-default disabled:hover:bg-transparent' onClick={() => openStatDetail?.('classDc')}>
            <span className='text-p1-muted'>Class DC</span>
            <strong className='ml-auto'>{status.classDc}</strong>
          </button>
        </div>
      </section>
      {shield && shieldHealth && (
        <button type='button' className='flex w-full items-center gap-3 border border-p1-border bg-p1-surface px-3 py-2 text-left text-xs hover:border-p1-border hover:bg-p1-hover' onClick={() => setShieldItem(inventoryItemToPhase1(shield, 'equipped-shield'))}>
          <Shield size={16} className='shrink-0 text-p1-faint' />
          <span className='min-w-0 flex-1 truncate text-p1-muted'>{shield.item.name}</span>
          <span className='shrink-0 text-p1-text'>{signed(shield.item.meta_data?.ac_bonus ?? 0)} AC</span>
          <span className='shrink-0 text-p1-muted'>Hardness {shieldHealth.hardness}</span>
          <span className='shrink-0 text-p1-muted'>HP {shieldHealth.hp_current}/{shieldHealth.hp_max}</span>
        </button>
      )}

      <section className='grid grid-cols-2 gap-x-2 gap-y-1.5 border border-p1-border bg-p1-surface p-3'>
        {ATTRIBUTE_LABELS.map(([key, label]) => <AttributePill key={key} label={label} value={status.attributes[key]} onClick={() => openStatDetail?.(key)} disabled={!openStatDetail} />)}
      </section>

      {calculating && !calculatedStatus && <p className='text-center text-[10px] text-p1-faint'>Calculating combatant statistics...</p>}
      {calculatedStatus === null && <p className='text-center text-[10px] text-p1-danger-soft'>Using stored values; calculated statistics were unavailable.</p>}
      {pickerOpen && (
        <SelectConditionModal
          current={compiledConditions(rawConditions)}
          onSelect={(condition, note) => {
            onChangeConditions?.(addConditionWithSpawns(rawConditions, condition), note ?? null);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {viewing && (
        <ConditionDetailModal
          condition={viewing}
          canManage={canManage && !viewing.source}
          onValueChange={(value, note) => {
            onChangeConditions?.(setConditionValue(rawConditions, viewing.name, value), note ?? null);
            setViewing({ ...viewing, value });
          }}
          onRemove={(note) => {
            onChangeConditions?.(removeConditionWithSpawns(rawConditions, viewing), note ?? null);
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
        />
      )}
      {openStat && (
        <StatDetailModal
          key={openStat}
          combatant={combatant as Phase1EntityCombatant}
          stat={openStat}
          onClose={() => setOpenStat(null)}
        />
      )}
      {shieldItem && <ItemModal item={shieldItem} onClose={() => setShieldItem(null)} />}
    </div>
  );
}

const ATTRIBUTE_LABELS: Array<[keyof Phase1CreatureStatus['attributes'], string]> = [
  ['strength', 'Strength'], ['intelligence', 'Intelligence'],
  ['dexterity', 'Dexterity'], ['wisdom', 'Wisdom'],
  ['constitution', 'Constitution'], ['charisma', 'Charisma'],
];

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div><div className='text-xs text-p1-muted'>{label}</div><div className='mt-1 text-lg font-semibold'>{value}</div></div>;
}
function MetricButton({ label, value, onClick, disabled }: { label: string; value: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='w-full hover:bg-p1-hover disabled:cursor-default disabled:hover:bg-transparent' onClick={onClick}><Metric label={label} value={value} /></button>;
}
function IconMetric({ icon, label, value, detail, onClick, disabled }: { icon: ReactNode; label: string; value: ReactNode; detail: string; onClick?: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='min-w-0 px-2 py-3 text-center hover:bg-p1-hover disabled:cursor-default disabled:hover:bg-transparent' title={detail} onClick={onClick}><div className='flex items-center justify-center gap-1.5 text-xs text-p1-muted'>{icon}{label}</div><div className='mt-1 text-lg font-semibold'>{value}</div><div className='mt-1 truncate text-[9px] text-p1-faint'>{detail}</div></button>;
}
function DefenseRow({ label, value, onClick, disabled }: { label: string; value: number; onClick?: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='flex w-full items-center py-1.5 text-left text-xs hover:bg-p1-hover disabled:cursor-default disabled:hover:bg-transparent' onClick={onClick}><span className='text-p1-muted'>{label}</span><strong className='ml-auto'>{signed(value)}</strong></button>;
}
function AttributePill({ label, value, onClick, disabled }: { label: string; value: number; onClick?: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='flex h-6 items-center bg-p1-hover px-2 text-left text-[11px] hover:bg-p1-hover disabled:cursor-default disabled:hover:bg-p1-hover' onClick={onClick}><span className='truncate text-p1-muted'>{label}</span><strong className='ml-auto pl-2'>{signed(value)}</strong></button>;
}
function StatusLine({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return <div><span className='mr-2 font-semibold text-p1-muted'>{label}</span><span className='text-p1-muted'>{values.join(', ')}</span></div>;
}
export function DetailsPanel({ combatant }: { combatant: PopulatedCombatant }) {
  const { open } = useContentLinks();
  const [openGroup, setOpenGroup] = useState<string | null>('attacks');
  const [openProf, setOpenProf] = useState<Phase1StatTarget | null>(null);
  const [detailTab, setDetailTabState] = useState(persistedSheetDetailsTab);
  const setDetailTab = (tab: typeof persistedSheetDetailsTab) => {
    persistedSheetDetailsTab = tab;
    setDetailTabState(tab);
  };
  const detailsAvailable = hasFullEntityDetails(combatant) && combatant.access?.details_revealed !== false;
  const data = useQuery({
    queryKey: ['phase1-entity-details', 'isolated-store', combatant.type, combatant._id, JSON.stringify(combatant.data.details ?? null)],
    enabled: detailsAvailable,
    queryFn: () => loadEntityDetails(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const fallback = entityDescription(combatant.data);
  const details = data.data;

  return (
    <div className='space-y-2.5'>
      <div className='flex overflow-x-auto border-b border-p1-border'>
        <InnerTab active={detailTab === 'info'} onClick={() => setDetailTab('info')}>Info</InnerTab>
        <InnerTab active={detailTab === 'languages'} onClick={() => setDetailTab('languages')}>Languages</InnerTab>
        <InnerTab active={detailTab === 'proficiencies'} onClick={() => setDetailTab('proficiencies')}>Proficiencies</InnerTab>
      </div>
      {data.isLoading && <p className='text-center text-[10px] text-p1-faint'>Loading details...</p>}
      {data.isError && <p className='text-center text-[10px] text-p1-danger-soft'>{data.error instanceof Error ? data.error.message : 'Could not load extra details.'}</p>}
      {detailTab === 'info' && (
        <>
          <section className='border border-p1-border bg-p1-surface p-4'>
            {details?.description || fallback ? <ProseMarkdown>{details?.description || fallback}</ProseMarkdown> : <p className='text-sm italic text-p1-muted'>No description given.</p>}
          </section>
          {details?.info.map((field) => (
            <section key={field.label} className='border border-p1-border bg-p1-surface px-3 py-2.5'>
              <h3 className='text-[10px] font-semibold uppercase text-p1-muted'>{field.label}</h3>
              <p className='mt-1 text-sm leading-6 text-p1-text'>{field.value}</p>
            </section>
          ))}
        </>
      )}
      {detailTab === 'languages' && details && (
        <>
          <LinkedNameSection title='Languages' items={details.languages} empty='No languages found.' onOpen={open} />
          <LinkedNameSection title='Traits' items={details.rarity ? [{ name: details.rarity }, ...details.traits] : details.traits} empty='No traits found.' onOpen={open} />
          <section className='border border-p1-border bg-p1-surface px-3 py-2.5'>
            <h3 className='text-[10px] font-semibold uppercase text-p1-muted'>Size</h3>
            <div className='mt-2'><Tag>{details.size}</Tag></div>
          </section>
        </>
      )}
      {detailTab === 'languages' && !details && !data.isLoading && <EmptyState>No languages found.</EmptyState>}
      {detailTab === 'proficiencies' && details && (
        <section className='border border-p1-border bg-p1-surface'>
          <div className='space-y-1 p-2'>
            {details.profGroups.map((group) => (
              <section key={group.id} className='border border-p1-border bg-p1-inset'>
                <button type='button' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-p1-hover' onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}>
                  <span className='min-w-0 flex-1 font-semibold text-p1-text'>{group.label}</span>
                  <ChevronDown size={14} className={`text-p1-muted transition-transform ${openGroup === group.id ? 'rotate-180' : ''}`} />
                </button>
                {openGroup === group.id && (
                  <div className='space-y-1 border-t border-p1-border p-2'>
                    {group.items.map((item) => (
                      <ProficiencyRow key={item.variableName} item={item} onOpen={() => setOpenProf({ variableName: item.variableName, isDC: item.isDC })} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </section>
      )}
      {openProf && <StatDetailModal combatant={combatant as Phase1EntityCombatant} stat={openProf} onClose={() => setOpenProf(null)} />}
    </div>
  );
}

function LinkedNameSection({ title, items, empty, onOpen }: { title: string; items: Array<{ name: string; href?: string }>; empty: string; onOpen: (href: string) => void }) {
  return (
    <section className='border border-p1-border bg-p1-surface px-3 py-2.5'>
      <h3 className='text-[10px] font-semibold uppercase text-p1-muted'>{title}</h3>
      <div className='mt-2 flex flex-wrap gap-1.5'>
        {items.length === 0 && <p className='text-sm italic text-p1-muted'>{empty}</p>}
        {items.map((item, index) => item.href ? (
          <button key={`${item.name}-${index}`} type='button' className='border border-p1-border bg-p1-hover px-2 py-0.5 text-[11px] text-p1-text hover:border-p1-border hover:bg-p1-hover' onClick={() => onOpen(item.href!)}>{item.name}</button>
        ) : (
          <span key={`${item.name}-${index}`} className='border border-p1-border bg-p1-hover px-2 py-0.5 text-[11px] text-p1-text'>{item.name}</span>
        ))}
      </div>
    </section>
  );
}

function ProficiencyRow({ item, onOpen }: { item: Phase1ProfRow; onOpen: () => void }) {
  return (
    <button type='button' className='flex w-full items-center gap-2 bg-p1-hover px-2 py-1.5 text-left text-xs hover:bg-p1-hover' onClick={onOpen}>
      <span className='min-w-0 flex-1 truncate text-p1-text'>{item.label}</span>
      {item.value && <strong className='shrink-0 text-p1-text'>{item.value}</strong>}
      <span className='shrink-0 border border-p1-border px-1.5 py-0.5 text-[10px] font-semibold text-p1-text'>{item.rank}</span>
    </button>
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
        className='grid min-h-[96px] place-items-center overflow-hidden border border-p1-border bg-p1-surface hover:border-p1-border'
        disabled={!src || failed}
        onClick={() => { if (src && !failed) setOpen(true); }}
        title={src && !failed ? 'View image' : undefined}
      >
        {src && !failed ? <img src={src} alt={combatant.data.name} className='h-full max-h-28 w-full object-contain p-1.5' onError={() => setFailed(true)} /> : <Swords size={24} className='text-p1-faint' />}
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
      <section role='dialog' aria-modal='true' aria-label={alt} className='relative max-h-[min(90vh,900px)] max-w-[min(90vw,900px)] border border-p1-border bg-p1-surface p-3 shadow-2xl'>
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
export function fallbackStatus(entity: LivingEntity): Phase1CreatureStatus {
  const stats = statsFor(entity);
  return {
    maxHp: stats.maxHp, ac: stats.ac, fortitude: stats.fort, reflex: stats.reflex, will: stats.will, classDc: 10,
    perception: 0, speed: 0, otherSpeeds: [], vision: 'Normal vision',
    attributes: { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 },
    conditions: entity.details?.conditions?.map((condition) => condition.value ? `${condition.name} ${condition.value}` : condition.name) ?? [],
    resistances: [], weaknesses: [], immunities: [], recallKnowledge: null,
  };
}
export function SpellsPanel({ combatant, spellActions, onLogAction }: { combatant: PopulatedCombatant; spellActions?: Phase1SpellActions; onLogAction?: LogActionFn }) {
  const [query, setQuery] = useState('');
  const [rankFilter, setRankFilterState] = useState<number | 'ALL'>(persistedSpellsRankFilter);
  const [sourceKey, setSourceKeyState] = useState(persistedSpellsSourceKey);
  const [selected, setSelected] = useState<Phase1SpellEntry | null>(null);
  const [openProf, setOpenProf] = useState<Phase1StatTarget | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [spellError, setSpellError] = useState('');
  const [book, setBook] = useState<{ sourceName: string; sourceType?: string; manageMode?: ReturnType<typeof spellManageMode>; assign?: SpellbookAssign | null; adding?: boolean } | null>(null);
  const [staffChargePick, setStaffChargePick] = useState<Phase1SpellSection | null>(null);
  const [staffCastPick, setStaffCastPick] = useState<Phase1SpellEntry | null>(null);
  const [wandOvercharge, setWandOvercharge] = useState<Phase1SpellEntry | null>(null);
  const detailsAvailable = hasFullEntityDetails(combatant);
  const data = useQuery({
    queryKey: ['phase1-entity-spells', 'isolated-store', combatant.type, combatant._id, JSON.stringify(combatant.data.spells ?? null), JSON.stringify((combatant.data.inventory?.items ?? []).map((item) => ({ id: item.id, eq: item.is_equipped, ch: item.item.meta_data?.charges, hp: item.item.meta_data?.hp })))],
    enabled: detailsAvailable && combatant.access?.details_revealed !== false,
    queryFn: () => loadEntitySpells(combatant as Phase1EntityCombatant),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const setRankFilter = (rank: number | 'ALL') => {
    persistedSpellsRankFilter = rank;
    setRankFilterState(rank);
  };
  const setSourceKey = (key: string) => {
    persistedSpellsSourceKey = key;
    setSourceKeyState(key);
  };
  const allSections = data.data?.sections ?? [];
  const bookTradition = book ? allSections.find((section) => section.source?.name === book.sourceName)?.source?.tradition : undefined;
  const sourceTabs = allSections.map((section) => ({ key: section.key, label: section.label }));
  const activeSource = sourceKey === 'ALL' || sourceTabs.some((tab) => tab.key === sourceKey) ? sourceKey : 'ALL';
  const availableRanks = [...new Set(allSections.flatMap((section) => [
    ...section.entries.map(spellRankKey),
    ...section.slots.map((slot) => (slot.rank === 0 ? -1 : slot.rank)),
  ]))].sort((a, b) => a - b);
  const activeRank = rankFilter === 'ALL' || availableRanks.includes(rankFilter) ? rankFilter : 'ALL';
  const needle = query.trim().toLowerCase();
  const sections = allSections.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => {
      if (activeRank !== 'ALL' && spellRankKey(entry) !== activeRank) return false;
      if (!needle) return true;
      if (entry.empty || !entry.spell) return false;
      return [entry.spell.name, entry.spell.description, ...entry.traitNames].join(' ').toLowerCase().includes(needle);
    }),
  })).filter((section) => {
    if (activeSource !== 'ALL' && section.key !== activeSource) return false;
    if (section.entries.length > 0) return true;
    if (needle) return false;
    const hasSlotsAtRank = activeRank === 'ALL'
      ? section.slots.length > 0
      : section.slots.some((slot) => (slot.rank === 0 ? -1 : slot.rank) === activeRank);
    if (hasSlotsAtRank && (section.mode === 'PREPARED' || section.mode === 'SPONTANEOUS')) return true;
    if (!needle && spellManageMode(section.source?.type, section.source?.name, section.mode)) return true;
    if (!needle && (section.mode === 'STAFF' || section.mode === 'WAND' || section.mode === 'SPELLHEART')) return true;
    return section.mode === 'RITUAL' && !needle && activeRank === 'ALL';
  });
  const addTarget = (() => {
    const manageable = (section: Phase1SpellSection) => Boolean(spellManageMode(section.source?.type, section.source?.name, section.mode));
    const tabSection = activeSource !== 'ALL' ? allSections.find((section) => section.key === activeSource) : undefined;
    if (tabSection && manageable(tabSection)) return tabSection;
    return sections.find(manageable) ?? allSections.find(manageable);
  })();

  function openBook(section: Phase1SpellSection, opts?: { assign?: SpellbookAssign | null; adding?: boolean }) {
    const sourceName = section.source?.name ?? (section.mode === 'RITUAL' ? 'RITUALS' : section.label);
    const manageMode = spellManageMode(section.source?.type, sourceName, section.mode) ?? undefined;
    const slotsOnly = manageMode === 'SLOTS-ONLY';
    setBook({
      sourceName,
      sourceType: section.source?.type,
      manageMode,
      assign: opts?.assign,
      adding: opts?.adding || slotsOnly,
    });
  }

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

  function spellDraft(entry: Phase1SpellEntry): ActionLogDraft | null {
    if (!entry.spell) return null;
    return {
      name: entry.spell.name,
      cost: isExecutableActionCost(entry.spell.cast) ? entry.spell.cast : null,
      kind: 'spell',
      extra: rankLabel(entry.rank),
    };
  }

  function logSpell(entry: Phase1SpellEntry) {
    const draft = spellDraft(entry);
    if (!draft || !onLogAction) return;
    onLogAction(draft);
  }

  function castAndLog(entry: Phase1SpellEntry, key: string, closeModal = false) {
    if (entry.mode === 'SPELLHEART') return;
    if (entry.mode === 'FOCUS' && isFocusCastBlocked(entry.spell, combatant.data)) {
      setSpellError('You can’t cast a focus spell whose minimum rank is greater than half your level (rounded up).');
      return;
    }
    if (entry.mode === 'STAFF' && entry.staffCasting === 'SPONTANEOUS' && entry.rank > 0 && !entry.exhausted) {
      setStaffCastPick(entry);
      return;
    }
    if (entry.mode === 'WAND' && wandNeedsOvercharge(entry)) {
      setWandOvercharge(entry);
      return;
    }
    const draft = spellDraft(entry);
    const cast = () => runSpellAction(key, async () => {
      if (entry.mode === 'STAFF') await spellActions!.castStaff(entry, true, 'NORMAL');
      else if (entry.mode === 'WAND') await spellActions!.castWand(entry, true);
      else await spellActions!.setCast(entry, true);
    }, closeModal);
    if (!draft || !onLogAction) {
      void cast();
      return;
    }
    onLogAction(draft, cast);
  }

  return <>
    {sourceTabs.length > 1 && (
      <div className='mb-2.5 flex overflow-x-auto border-b border-p1-border'>
        <InnerTab active={activeSource === 'ALL'} onClick={() => setSourceKey('ALL')}>All</InnerTab>
        {sourceTabs.map((tab) => (
          <InnerTab key={tab.key} active={activeSource === tab.key} onClick={() => setSourceKey(tab.key)}>{tab.label.replace(/ Spells$/i, '')}</InnerTab>
        ))}
      </div>
    )}
    {availableRanks.length > 1 && (
      <div className='mb-2.5 flex overflow-x-auto border-b border-p1-border'>
        <InnerTab active={activeRank === 'ALL'} onClick={() => setRankFilter('ALL')}>All</InnerTab>
        {availableRanks.map((rank) => (
          <InnerTab key={rank} active={activeRank === rank} onClick={() => setRankFilter(rank)}>
            {rank < 0 ? 'Cantrip' : String(rank)}
          </InnerTab>
        ))}
      </div>
    )}
    <div className='flex items-center gap-2'>
      <div className='min-w-0 flex-1'>
        <SearchField value={query} onChange={setQuery} placeholder='Search spells' />
      </div>
      {spellActions && addTarget && (
        <button
          type='button'
          className='inline-flex h-9 shrink-0 items-center gap-1 border border-p1-border bg-p1-surface px-3 text-xs font-semibold text-p1-text hover:bg-p1-hover'
          onClick={() => openBook(addTarget, { adding: true })}
        >
          <Plus size={14} />
          Add spells
        </button>
      )}
    </div>
    {spellError && <div className='mt-2 border border-p1-danger/40 bg-p1-danger/10 px-3 py-2 text-xs text-p1-danger-soft'>{spellError}</div>}
    {!detailsAvailable && <EmptyState>Private character details are unavailable in this account context.</EmptyState>}
    {data.isLoading && <EmptyState>Loading spellcasting...</EmptyState>}
    {data.isError && <ErrorState error={data.error} />}
    <div className='mt-3 space-y-3'>
      {sections.map((section) => <SpellSection key={section.key} section={section} rankFilter={activeRank} spellActions={spellActions} busyKey={busyKey} canOpenStats={detailsAvailable && combatant.access?.details_revealed !== false} onOpen={setSelected} onOpenBook={(opts) => openBook(section, opts)} onOpenProf={setOpenProf} onCast={(entry) => castAndLog(entry, `cast-${entry.key}`)} onUncast={(entry) => runSpellAction(`uncast-${entry.key}`, () => {
        if (entry.mode === 'STAFF') return spellActions!.castStaff(entry, false);
        if (entry.mode === 'WAND') return spellActions!.castWand(entry, false);
        return spellActions!.setCast(entry, false);
      })} onRankSpent={(rank, spent) => runSpellAction(`rank-${section.key}-${rank}`, () => spellActions!.setRankSpent(section, rank, spent))} onFocusSpent={(spent) => runSpellAction(`focus-${section.key}`, () => spellActions!.setFocusSpent(section, spent))} onPreparedSpent={(entry, spent) => runSpellAction(`prepared-${entry.key}`, () => spellActions!.setPreparedSpent(entry, spent))} onInnateSpent={(entry, castsCurrent) => runSpellAction(`innate-${entry.key}`, () => spellActions!.setInnateSpent(entry, castsCurrent))} onRemoveFromList={(entry) => entry.spell && runSpellAction(`remove-${entry.key}`, () => spellActions!.removeFromList(entry.sourceName, entry.spell!.id, entry.rank))} onClearSlot={(entry) => entry.slotId && runSpellAction(`clear-${entry.key}`, () => spellActions!.clearSlot(entry.slotId!))} onAddStaffCharges={section.canAddStaffCharges ? () => setStaffChargePick(section) : undefined} onStaffCharges={(spent) => section.entries[0]?.itemId && runSpellAction(`staff-ch-${section.key}`, () => spellActions!.setItemCharges(section.entries[0].itemId!, spent))} entity={combatant.data} onApplyFont={spellActions && section.mode === 'PREPARED' && isDivinePreparedSource(section.source) ? (choice) => runSpellAction(`font-${section.key}-${choice}`, () => spellActions.applyDivineFont(section.source!.name, choice)) : undefined} onLogCantrip={onLogAction ? logSpell : undefined} />)}
      {data.data && !sections.length && <EmptyState>{needle ? 'No spells match this search.' : 'No spells found.'}</EmptyState>}
    </div>
    {selected && selected.spell && <SpellModal entry={selected} entity={combatant.data} spellActions={spellActions} busy={Boolean(busyKey)} onCast={() => castAndLog(selected, `modal-cast-${selected.key}`, true)} onUncast={() => runSpellAction(`modal-uncast-${selected.key}`, () => {
      if (selected.mode === 'STAFF') return spellActions!.castStaff(selected, false);
      if (selected.mode === 'WAND') return spellActions!.castWand(selected, false);
      return spellActions!.setCast(selected, false);
    }, true)} onClose={() => setSelected(null)} />}
    {openProf && <StatDetailModal combatant={combatant as Phase1EntityCombatant} stat={openProf} onClose={() => setOpenProf(null)} />}
    {staffChargePick && spellActions && (
      <ConfirmDialog
        title='Expend a spell slot'
        message={<div className='space-y-2'><p>Select a slot to add that many charges to the staff.</p><div className='flex flex-col gap-1'>{(staffChargePick.staffSlots ?? []).map((slot) => (
          <button key={slot.id} type='button' className='h-8 border border-p1-border px-2 text-left text-xs hover:bg-p1-hover' onClick={() => {
            const itemId = staffChargePick.entries[0]?.itemId;
            if (!itemId) return;
            void runSpellAction(`staff-add-${slot.id}`, () => spellActions.addStaffCharges(itemId, slot.id));
            setStaffChargePick(null);
          }}>Rank {slot.rank} · {slot.source}</button>
        ))}{(staffChargePick.staffSlots ?? []).length === 0 && <p className='text-xs text-p1-muted'>No unused ranked slots.</p>}</div></div>}
        confirmLabel='Close'
        confirmDanger={false}
        onCancel={() => setStaffChargePick(null)}
        onConfirm={() => setStaffChargePick(null)}
      />
    )}
    {staffCastPick && spellActions && (
      <ConfirmDialog
        title='Cast from staff'
        message={<div className='space-y-2'>
          <p>Spend staff charges equal to the spell’s rank, or consume a spell slot of that rank to add 1 charge and cast.</p>
          <button type='button' className='h-8 w-full border border-p1-border px-2 text-xs hover:bg-p1-hover' onClick={() => {
            const entry = staffCastPick;
            setStaffCastPick(null);
            void runSpellAction(`staff-slot-${entry.key}`, () => spellActions.castStaff(entry, true, 'SLOT-CONSUME', entry.rank));
          }}>Consume a rank {staffCastPick.rank} slot</button>
        </div>}
        confirmLabel='Use charges'
        cancelLabel='Cancel'
        confirmDanger={false}
        onCancel={() => setStaffCastPick(null)}
        onConfirm={() => {
          const entry = staffCastPick;
          setStaffCastPick(null);
          void runSpellAction(`staff-normal-${entry.key}`, () => spellActions.castStaff(entry, true, 'NORMAL'));
        }}
      />
    )}
    {wandOvercharge && spellActions && (
      <ConfirmDialog
        title='Overcharge wand'
        message='You already cast this wand today. Overcharging breaks the wand (DC 10 flat check in play). Confirm to mark it broken and cast again.'
        confirmLabel='Break wand'
        onCancel={() => setWandOvercharge(null)}
        onConfirm={() => {
          const entry = wandOvercharge;
          setWandOvercharge(null);
          void runSpellAction(`wand-over-${entry.key}`, () => spellActions.castWand(entry, true, true));
        }}
      />
    )}
    {openProf && <StatDetailModal combatant={combatant as Phase1EntityCombatant} stat={openProf} onClose={() => setOpenProf(null)} />}
    {book && spellActions && (
      <Phase1SpellbookModal
        sourceName={book.sourceName}
        sourceType={book.sourceType}
        manageMode={book.manageMode || undefined}
        tradition={bookTradition}
        list={data.data?.list ?? combatant.data.spells?.list ?? []}
        catalogSources={spellCatalogSourceIds((combatant.data as Character).content_sources?.enabled)}
        assign={book.assign}
        initialAdding={book.adding}
        busy={Boolean(busyKey)}
        onClose={() => setBook(null)}
        onAdd={(spell, rank) => runSpellAction(`book-add-${spell.id}-${rank}`, async () => {
          if (book.manageMode === 'SLOTS-ONLY') {
            const preferId = book.assign && spellFitsSlot(spell, book.assign.rank, rank) ? book.assign.slotId : undefined;
            await spellActions.prepareSlot(book.sourceName, preferId, spell, rank);
            if (book.assign) setBook(null);
            return;
          }
          await spellActions.addToList(book.sourceName, spell, rank);
        })}
        onRemove={(spellId, rank) => runSpellAction(`book-remove-${spellId}-${rank}`, () => spellActions.removeFromList(book.sourceName, spellId, rank))}
        onPick={book.manageMode === 'SLOTS-AND-LIST' ? (entry) => runSpellAction(`book-prep-${entry.spell.id}-${entry.rank}`, async () => {
          const preferId = book.assign && spellFitsSlot(entry.spell, book.assign.rank, entry.rank) ? book.assign.slotId : undefined;
          await spellActions.prepareSlot(book.sourceName, preferId, entry.spell, entry.rank);
          if (book.assign) setBook(null);
        }) : undefined}
        onApplyFont={isDivinePreparedSource({ name: book.sourceName, tradition: bookTradition })
          ? (choice) => runSpellAction(`font-${book.sourceName}-${choice}`, () => spellActions.applyDivineFont(book.sourceName, choice))
          : undefined}
      />
    )}
  </>;
}

function SpellSection({ section, rankFilter, spellActions, busyKey, canOpenStats, onOpen, onOpenBook, onOpenProf, onCast, onUncast, onRankSpent, onFocusSpent, onPreparedSpent, onInnateSpent, onRemoveFromList, onClearSlot, onAddStaffCharges, onStaffCharges, onApplyFont, onLogCantrip, entity }: {
  section: Phase1SpellSection;
  rankFilter: number | 'ALL';
  spellActions?: Phase1SpellActions;
  busyKey: string | null;
  canOpenStats: boolean;
  onOpen: (entry: Phase1SpellEntry) => void;
  onOpenBook: (opts?: { assign?: SpellbookAssign | null; adding?: boolean }) => void;
  onOpenProf: (stat: Phase1StatTarget) => void;
  onCast: (entry: Phase1SpellEntry) => void;
  onUncast: (entry: Phase1SpellEntry) => void;
  onRankSpent: (rank: number, spent: number) => void;
  onFocusSpent: (spent: number) => void;
  onPreparedSpent: (entry: Phase1SpellEntry, spent: boolean) => void;
  onInnateSpent: (entry: Phase1SpellEntry, castsCurrent: number) => void;
  onRemoveFromList: (entry: Phase1SpellEntry) => void;
  onClearSlot: (entry: Phase1SpellEntry) => void;
  onAddStaffCharges?: () => void;
  onStaffCharges?: (spent: number) => void;
  onApplyFont?: (choice: 'heal' | 'harm') => void;
  onLogCantrip?: (entry: Phase1SpellEntry) => void;
  entity: LivingEntity;
}) {
  const slotRanks = section.slots.map((slot) => (slot.rank === 0 ? -1 : slot.rank));
  const ranks = [...new Set([...section.entries.map(spellRankKey), ...slotRanks])]
    .filter((rank) => rankFilter === 'ALL' || rank === rankFilter)
    .sort((a, b) => a - b);
  const canManageBook = Boolean(spellActions) && Boolean(spellManageMode(section.source?.type, section.source?.name, section.mode));
  const manageMode = spellManageMode(section.source?.type, section.source?.name, section.mode);
  const focusSpent = section.focusPoints ? section.focusPoints.max - section.focusPoints.current : 0;
  const bookLabel = manageMode === 'SLOTS-ONLY' ? 'Prepare' : isWitchFamiliarSource(section.source) ? 'Familiar' : 'Spellbook';
  return <section className='border border-p1-border bg-p1-surface'>
    <header className='border-b border-p1-border px-3 py-2.5'>
      <div className='flex items-center gap-2'>
        <WandSparkles size={14} className='text-p1-accent' />
        <h3 className='truncate text-sm font-semibold'>{section.label}</h3>
        <Tag>{section.mode.toLowerCase()}</Tag>
        {canManageBook && (
          <button type='button' className='ml-auto inline-flex h-7 items-center gap-1 border border-p1-border px-2 text-[10px] font-semibold text-p1-muted hover:bg-p1-hover hover:text-p1-text' onClick={() => onOpenBook({ adding: manageMode === 'SLOTS-ONLY' })}>
            <BookOpen size={12} />
            {bookLabel}
          </button>
        )}
        {section.mode === 'FOCUS' && section.focusPoints && section.focusPoints.max > 0 && (
          <SlotCircles count={section.focusPoints.max} spent={focusSpent} editable={Boolean(spellActions)} title='Focus points spent' onChange={onFocusSpent} />
        )}
        {section.mode === 'STAFF' && section.charges && (
          <div className='ml-auto flex items-center gap-2'>
            {onAddStaffCharges && (
              <button type='button' className='h-7 border border-p1-border px-2 text-[10px] font-semibold text-p1-muted hover:bg-p1-hover hover:text-p1-text' onClick={onAddStaffCharges}>Add charges</button>
            )}
            <SlotCircles count={section.charges.max} spent={section.charges.current} editable={Boolean(spellActions) && Boolean(onStaffCharges)} title='Staff charges spent' onChange={(spent) => onStaffCharges?.(spent)} />
          </div>
        )}
      </div>
      {(section.attack != null || section.dc != null) && (
        <div className='mt-2 flex gap-2 text-[11px] text-p1-muted'>
          {section.attack != null && (
            <button type='button' disabled={!canOpenStats} className='border border-p1-border bg-p1-hover px-2 py-1 hover:border-p1-border disabled:cursor-default disabled:hover:border-p1-border' onClick={() => onOpenProf({ variableName: 'SPELL_ATTACK' })}>
              Spell attack <strong className='ml-1 text-p1-text'>{signed(section.attack)}</strong>
            </button>
          )}
          {section.dc != null && (
            <button type='button' disabled={!canOpenStats} className='border border-p1-border bg-p1-hover px-2 py-1 hover:border-p1-border disabled:cursor-default disabled:hover:border-p1-border' onClick={() => onOpenProf({ variableName: 'SPELL_DC', isDC: true })}>
              Spell DC <strong className='ml-1 text-p1-text'>{section.dc}</strong>
            </button>
          )}
        </div>
      )}
      {onApplyFont && (
        <div className='mt-2 flex flex-wrap items-center gap-2 text-[11px]'>
          <span className='text-p1-muted'>Divine Font</span>
          <div className='flex border border-p1-border' role='radiogroup' aria-label='Divine Font'>
            <button type='button' className='h-7 px-2.5 text-[10px] font-semibold text-p1-muted hover:bg-p1-hover hover:text-p1-text' disabled={Boolean(busyKey)} onClick={() => onApplyFont('heal')}>Heal</button>
            <button type='button' className='h-7 border-l border-p1-border px-2.5 text-[10px] font-semibold text-p1-muted hover:bg-p1-hover hover:text-p1-text' disabled={Boolean(busyKey)} onClick={() => onApplyFont('harm')}>Harm</button>
          </div>
          <span className='text-[10px] text-p1-faint'>Fills empty ranked slots with that spell (1 + Cha extra slots from your class).</span>
        </div>
      )}
    </header>
    <div className='divide-y divide-white/[0.07]'>
      {ranks.map((rank) => {
        const entries = section.entries.filter((entry) => (entry.cantrip ? -1 : entry.rank) === rank);
        const slots = rank < 0 ? [] : section.slots.filter((slot) => slot.rank === rank);
        const rankSpent = slots.filter((slot) => slot.exhausted).length;
        const showRankCircles = rank >= 0 && slots.length > 0 && (section.mode === 'SPONTANEOUS' || section.mode === 'PREPARED');
        return <div key={rank}>
          <div className='flex h-8 items-center gap-2 bg-p1-inset px-3 text-xs font-semibold text-p1-muted'>
            <span>{rank < 0 ? 'Cantrips' : rankLabel(rank)}</span>
            {showRankCircles && <SlotCircles count={slots.length} spent={rankSpent} editable={Boolean(spellActions)} title={`${rankLabel(rank)} slots spent`} onChange={(spent) => onRankSpent(rank, spent)} />}
            <span className='ml-auto border border-p1-border px-1.5 py-0.5 text-[9px] font-normal text-p1-muted'>{entries.length}</span>
          </div>
          <div className='divide-y divide-white/[0.06]'>
            {entries.map((entry) => (
              <SpellRow
                key={entry.key}
                entry={entry}
                entity={entity}
                spellActions={spellActions}
                busy={Boolean(busyKey)}
                onOpen={onOpen}
                onOpenEmpty={() => entry.slotId && onOpenBook({ assign: { slotId: entry.slotId, rank: entry.rank }, adding: manageMode === 'SLOTS-ONLY' })}
                onCast={() => onCast(entry)}
                onUncast={() => onUncast(entry)}
                onPreparedSpent={(spent) => onPreparedSpent(entry, spent)}
                onInnateSpent={(castsCurrent) => onInnateSpent(entry, castsCurrent)}
                onRemoveFromList={() => onRemoveFromList(entry)}
                onClearSlot={() => onClearSlot(entry)}
                onLogCantrip={onLogCantrip}
              />
            ))}
          </div>
        </div>;
      })}
      {section.mode === 'SPELLHEART' && section.entries.length === 0 && (
        <p className='px-3 py-2 text-center text-sm italic text-p1-muted'>No spells detected in spellhearts</p>
      )}
      {section.mode === 'SPELLHEART' && section.entries.length === 0 && (
        <p className='px-3 py-2 text-center text-sm italic text-p1-muted'>No spells detected in spellhearts</p>
      )}
      {manageMode && spellActions && (
        <button type='button' className='flex min-h-10 w-full items-center gap-2 px-3 py-1.5 text-left text-sm italic text-p1-muted hover:bg-p1-hover' onClick={() => onOpenBook({ adding: true })}>
          <Plus size={14} />
          {manageMode === 'SLOTS-ONLY' ? 'Prepare from tradition' : 'Add spells'}
        </button>
      )}
    </div>
  </section>;
}

function SpellRow({ entry, entity, spellActions, busy, onOpen, onOpenEmpty, onCast, onUncast, onPreparedSpent, onInnateSpent, onRemoveFromList, onClearSlot, onLogCantrip }: {
  entry: Phase1SpellEntry;
  entity: LivingEntity;
  spellActions?: Phase1SpellActions;
  busy: boolean;
  onOpen: (entry: Phase1SpellEntry) => void;
  onOpenEmpty: () => void;
  onCast: () => void;
  onUncast: () => void;
  onPreparedSpent: (spent: boolean) => void;
  onInnateSpent: (castsCurrent: number) => void;
  onRemoveFromList: () => void;
  onClearSlot: () => void;
  onLogCantrip?: (entry: Phase1SpellEntry) => void;
}) {
  const innateSpent = entry.usesMax != null && entry.usesCurrent != null ? entry.usesMax - entry.usesCurrent : 0;
  const cantripExecute = entry.cantrip && entry.spell && onLogCantrip && isExecutableActionCost(entry.spell.cast)
    ? () => onLogCantrip(entry)
    : undefined;
  const onNameClick = useClickVsDoubleClick(() => onOpen(entry), cantripExecute);
  if (entry.empty || !entry.spell) {
    return (
      <button
        type='button'
        className='flex min-h-10 w-full items-center gap-2 px-3 py-1.5 text-left italic text-p1-muted hover:bg-p1-hover'
        onClick={onOpenEmpty}
      >
        Empty slot
      </button>
    );
  }
  const canRemove = Boolean(spellActions) && (entry.mode === 'PREPARED' || entry.mode === 'SPONTANEOUS' || entry.mode === 'RITUAL');
  const focusBlocked = entry.mode === 'FOCUS' && isFocusCastBlocked(entry.spell, entity);
  const showCast = Boolean(spellActions) && !entry.cantrip && entry.mode !== 'RITUAL' && entry.mode !== 'SPELLHEART';
  const showUncast = entry.mode === 'STAFF' || entry.mode === 'WAND' ? (entry.usesCurrent ?? 0) > 0 : entry.exhausted;
  return <div className='flex min-h-10 items-center gap-2 px-3 py-1.5 hover:bg-p1-hover' onContextMenu={(event) => {
    if (!canRemove) return;
    event.preventDefault();
    onRemoveFromList();
  }}>
    {entry.mode === 'PREPARED' && !entry.cantrip && (
      <SlotCircles count={1} spent={entry.exhausted ? 1 : 0} editable={Boolean(spellActions)} title={`${entry.spell.name} slot`} onChange={(spent) => onPreparedSpent(spent > 0)} />
    )}
    {entry.mode === 'INNATE' && !entry.cantrip && entry.usesMax != null && entry.usesMax > 0 && (
      <SlotCircles count={entry.usesMax} spent={innateSpent} editable={Boolean(spellActions)} title={`${entry.spell.name} uses spent`} onChange={onInnateSpent} />
    )}
    <button className='flex min-w-0 flex-1 items-center gap-2 text-left' onClick={onNameClick} title={cantripExecute ? 'Click for info, double-click to log' : undefined}>
      <ActionSymbol cost={entry.spell.cast} />
      <span className='min-w-0 flex-1'><span className='block truncate text-sm font-medium'>{entry.itemKind ? `${entry.sourceName} — ${entry.spell.name}` : entry.spell.name}</span><span className='mt-0.5 block truncate text-[9px] uppercase text-p1-faint'>{entry.traitNames.join(' | ') || entry.spell.traditions.join(' | ')}</span></span>
      {entry.mode !== 'INNATE' && entry.usesMax != null && <span className='text-[10px] text-p1-muted'>{entry.usesCurrent}/{entry.usesMax}</span>}
    </button>
    {showCast && (
      <div className='flex shrink-0 items-center gap-1.5'>
        {entry.mode === 'PREPARED' && entry.slotId && (
          <button className='h-7 border border-p1-border px-2.5 text-[10px] font-semibold text-p1-muted hover:bg-p1-hover disabled:cursor-wait disabled:opacity-50' disabled={busy} onClick={onClearSlot}>Clear</button>
        )}
        <button className='h-7 border border-p1-accent/40 px-2.5 text-[10px] font-semibold text-p1-accent-soft hover:bg-p1-accent/10 disabled:cursor-wait disabled:opacity-50' disabled={busy || focusBlocked || !entry.available} title={focusBlocked ? 'Focus spell rank is too high for your level' : undefined} onClick={onCast}>{busy ? 'Saving...' : 'Cast'}</button>
        {showUncast && <button className='h-7 border border-p1-border px-2.5 text-[10px] font-semibold text-p1-muted hover:bg-p1-hover disabled:cursor-wait disabled:opacity-50' disabled={busy} onClick={onUncast}>Uncast</button>}
      </div>
    )}
  </div>;
}

function SpellModal({ entry, entity, spellActions, busy, onCast, onUncast, onClose }: { entry: Phase1SpellEntry; entity: LivingEntity; spellActions?: Phase1SpellActions; busy: boolean; onCast: () => void; onUncast: () => void; onClose: () => void }) {
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
  if (!spell) return null;
  const focusBlocked = entry.mode === 'FOCUS' && isFocusCastBlocked(spell, entity);
  const showCast = spellActions && !entry.cantrip && entry.mode !== 'RITUAL' && entry.mode !== 'SPELLHEART';
  return createPortal(
    <div data-entity-modal className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role='dialog' aria-modal='true' aria-labelledby={`spell-${spell.id}-title`} className='flex max-h-[min(84vh,840px)] w-full max-w-3xl flex-col border border-p1-border bg-p1-surface shadow-2xl'>
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'><ActionSymbol cost={spell.cast} size='1.75rem' /><h2 id={`spell-${spell.id}-title`} className='text-xl font-semibold leading-tight'>{spell.name}</h2></div>
            <div className='mt-2 flex flex-wrap gap-1.5'><Tag>{entry.cantrip ? 'Cantrip' : rankLabel(entry.rank)}</Tag><Tag>{spell.rarity}</Tag>{entry.traitNames.map((trait) => <Tag key={trait}>{trait}</Tag>)}</div>
          </div>
          {showCast && (
            entry.exhausted
              ? <button className='h-8 shrink-0 border border-p1-border px-3 text-xs font-semibold text-p1-text hover:bg-p1-hover disabled:cursor-wait disabled:opacity-50' disabled={busy} onClick={onUncast}>{busy ? 'Saving...' : 'Uncast'}</button>
              : <button className='h-8 shrink-0 border border-p1-accent/50 bg-p1-accent px-3 text-xs font-semibold text-p1-accent-ink disabled:cursor-wait disabled:opacity-50' disabled={busy || focusBlocked || !entry.available} title={focusBlocked ? 'Focus spell rank is too high for your level' : undefined} onClick={onCast}>{busy ? 'Saving...' : `Cast ${rankLabel(entry.rank)}`}</button>
          )}
          <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close spell details'><X size={18} /></button>
        </header>
        <div className='min-h-0 overflow-y-auto px-5 py-4'>
          <div className='mb-4 space-y-1 border-b border-p1-border pb-4 text-sm leading-6'>
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
          {spell.heightened?.text?.map((heightened, index) => <div key={index} className='mt-4 border-t border-p1-border pt-4'><strong className='mr-2 text-p1-text'>Heightened ({heightened.amount})</strong><ProseMarkdown>{heightened.text}</ProseMarkdown></div>)}
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
              className={`h-3 w-3 rounded-full border transition hover:scale-110 ${filled ? 'border-p1-muted bg-p1-muted' : 'border-p1-muted bg-transparent hover:border-p1-accent'}`}
              onClick={(event) => { event.stopPropagation(); clickCircle(index); }}
            />
          );
        }
        return <span key={index} className={`h-3 w-3 rounded-full border ${filled ? 'border-p1-muted bg-p1-muted' : 'border-p1-muted'}`} />;
      })}
    </span>
  );
}

function spellRankKey(entry: Phase1SpellEntry) {
  return entry.cantrip ? -1 : entry.rank;
}
function rankLabel(rank: number) {
  if (rank === 0) return 'Cantrip';
  const mod = rank % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}
function DataSection({ title, data }: { title: string; data: unknown }) {
  const parsed = parseDisplayData(data);
  return (
    <section>
      <h3 className='mb-3 text-xs font-semibold uppercase text-p1-muted'>{title}</h3>
      {parsed.kind === 'empty' ? (
        <p className='border border-p1-border bg-p1-surface p-4 text-xs text-p1-muted'>No data available.</p>
      ) : parsed.kind === 'json' ? (
        <div className='overflow-x-auto border border-p1-border bg-p1-surface p-4 font-mono text-xs leading-5 text-p1-muted'>
          <JsonNode value={parsed.value} depth={0} />
        </div>
      ) : (
        <pre className='whitespace-pre-wrap break-words border border-p1-border bg-p1-surface p-4 font-mono text-xs leading-5 text-p1-muted'>{parsed.value}</pre>
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
  if (value === null) return <span className='text-p1-faint'>null</span>;
  if (typeof value === 'boolean') return <span className='text-p1-accent'>{String(value)}</span>;
  if (typeof value === 'number') return <span className='text-p1-code-number'>{value}</span>;
  if (typeof value === 'string') return <JsonString value={value} field={field} />;
  if (Array.isArray(value)) return <JsonCollection kind='array' value={value} depth={depth} field={field} />;
  if (typeof value === 'object') return <JsonCollection kind='object' value={value as Record<string, unknown>} depth={depth} field={field} />;
  return <span className='text-p1-muted'>{String(value)}</span>;
}

function JsonString({ value, field }: { value: string; field?: string }) {
  const long = isLongText(value, field);
  if (!long) return <span className='text-p1-code-string'>"{value}"</span>;
  const preview = value.replace(/\s+/g, ' ').trim().slice(0, 72);
  return (
    <details className='group my-1'>
      <summary className='cursor-pointer list-none text-p1-code-string marker:content-none [&::-webkit-details-marker]:hidden'>
        <span className='mr-1 inline-block text-p1-faint group-open:hidden'><ChevronRight size={12} className='inline' /></span>
        <span className='mr-1 hidden text-p1-faint group-open:inline'><ChevronDown size={12} className='inline' /></span>
        "{preview}{value.length > 72 ? '…' : ''}"
        <span className='ml-2 text-[10px] text-p1-faint'>{value.length} chars</span>
      </summary>
      <div className='ability-prose mt-2 max-w-none border border-p1-border bg-p1-inset p-3 font-sans text-[13px] leading-6 text-p1-text'>
        {looksLikeMarkdown(value) ? <ProseMarkdown className='max-w-none text-[13px] leading-6'>{value}</ProseMarkdown> : <div className='whitespace-pre-wrap'>{value}</div>}
      </div>
    </details>
  );
}

function JsonCollection({ kind, value, depth, field }: { kind: 'array'; value: unknown[]; depth: number; field?: string } | { kind: 'object'; value: Record<string, unknown>; depth: number; field?: string }) {
  const entries = kind === 'array' ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  const [open, setOpen] = useState(() => shouldExpandCollection(kind, value, depth, field));
  if (entries.length === 0) return <span className='text-p1-faint'>{kind === 'array' ? '[]' : '{}'}</span>;
  return (
    <span className='inline-block min-w-0 align-top'>
      <button type='button' className='inline-flex items-center gap-1 text-left text-p1-faint hover:text-p1-accent' onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{kind === 'array' ? '[' : '{'}</span>
        {!open && <span className='text-p1-faint'>{collectionPreview(kind, value, entries.length)}</span>}
        {!open && <span>{kind === 'array' ? ']' : '}'}</span>}
      </button>
      {open && (
        <>
          <div className='ml-2 border-l border-p1-border pl-3'>
            {entries.map(([key, item]) => (
              <div key={key} className='py-px'>
                {kind === 'object' && <span className='text-p1-code-key'>{key}</span>}
                {kind === 'object' && <span className='text-p1-faint'>: </span>}
                <JsonNode value={item} depth={depth + 1} field={kind === 'object' ? key : field} />
              </div>
            ))}
          </div>
          <div className='text-p1-faint'>{kind === 'array' ? ']' : '}'}</div>
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
  if (kind === 'array') return depth === 0 && (value as unknown[]).length <= 8;
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
