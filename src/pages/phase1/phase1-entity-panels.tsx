import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Calculator, ChevronDown, ChevronRight, Crosshair, Eye, Footprints, History, ListChecks, Package, Plus, Search, Shield, Sparkles, Swords, WandSparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Character, Combatant, Condition, LivingEntity } from '@schemas/content';
import { loadEntityAbilities, type Phase1Ability } from './phase1-abilities';
import { type Phase1CreatureStatus } from './phase1-stats';
import type { Phase1EntityCombatant } from './phase1-entity';
import { StatDetailModal, type Phase1StatKey, type Phase1StatTarget } from './phase1-stat-modal';
import { loadEntityDetails, type Phase1ProfRow } from './phase1-details';
import { loadEntitySkillsActions, type Phase1ActionGroup, type Phase1Skill } from './phase1-skills';
import { loadEntitySpells, type Phase1SpellEntry, type Phase1SpellSection } from './phase1-spells';
import { flattenInvItems, inventoryItemToPhase1, loadEntityInventory, matchesInvItem, type Phase1InvItem } from './phase1-inventory';
import { EntityNotesPanel, ProseMarkdown, SourceImportNotesPanel } from './phase1-markdown';
import { isContentStackOpen, useContentLinks } from './phase1-content-links';
import { getBestShield, getItemHealth } from '@items/inv-utils';
import { lookupMonsterArt, type Phase1MonsterArt } from './phase1-monster-image';
import { addConditionWithSpawns, compiledConditions, removeConditionWithSpawns } from '@conditions/condition-handler';
import { ConditionDetailModal, SelectConditionModal } from './phase1-conditions';
import { ActionSymbol } from '@common/Actions';
import { abilityNameAndCost } from '@utils/actions';
import { toStandard2eProse } from '@utils/foundry-text';
import { EditableValueWithNote } from './phase1-change-log-ui';

export type Phase1SpellActions = {
  setCast: (entry: Phase1SpellEntry, cast: boolean) => Promise<void>;
  setRankSpent: (section: Phase1SpellSection, rank: number, spent: number) => Promise<void>;
  setPreparedSpent: (entry: Phase1SpellEntry, spent: boolean) => Promise<void>;
  setFocusSpent: (section: Phase1SpellSection, spent: number) => Promise<void>;
  setInnateSpent: (entry: Phase1SpellEntry, castsCurrent: number) => Promise<void>;
};
export const DETAIL_TABS = ['Health', 'Abilities', 'Skills', 'Inventory', 'Spells', 'GM Notes', 'Source', 'Details'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];
export type PopulatedCombatant = Combatant & { data: LivingEntity; access?: { can_edit: boolean; details_revealed: boolean } };

export const CONDITION_PILL_CLASS = 'inline-flex max-w-[8.5rem] items-center truncate rounded-full border border-white/12 bg-white/[0.055] px-2 py-[3px] text-[10px] font-medium leading-none tracking-wide text-[#d5dcde]';
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
export function EmptyState({ children }: { children: ReactNode }) { return <div className='border border-white/10 p-8 text-center text-sm text-[#7f8a90]'>{children}</div>; }
export function ErrorState({ error }: { error: Error }) { return <div className='border border-[#a95249]/40 bg-[#a95249]/10 p-4 text-sm text-[#efaaa3]'>{error.message}</div>; }
export function Eyebrow({ children }: { children: ReactNode }) { return <div className='text-[10px] font-semibold uppercase text-[#d6a85f]'>{children}</div>; }

export function InspectorContent({ combatant, tab, hasMatchingCampaignNote, status, statusLoading, spellActions, onChangeConditions, onSaveGmNotes, onPersistHpCurrent, onPersistTempHp }: { combatant: PopulatedCombatant; tab: DetailTab; hasMatchingCampaignNote?: boolean; status?: Phase1CreatureStatus | null; statusLoading: boolean; spellActions?: Phase1SpellActions; onChangeConditions?: (conditions: Condition[], note?: string | null) => void; onSaveGmNotes?: (text: string) => void; onPersistHpCurrent?: (raw: string, note: string | null) => void; onPersistTempHp?: (raw: string, note: string | null) => void }) {
  const entity = combatant.data;
  if (tab === 'Health') return <HealthStatusPanel combatant={combatant} calculatedStatus={status} calculating={statusLoading} onChangeConditions={onChangeConditions} onPersistHpCurrent={onPersistHpCurrent} onPersistTempHp={onPersistTempHp} />;
  if (tab === 'Abilities') return <AbilitiesPanel combatant={combatant} />;
  if (tab === 'Skills') return <SkillsActionsPanel combatant={combatant} />;
  if (tab === 'Spells') return <SpellsPanel combatant={combatant} spellActions={spellActions} />;
  if (tab === 'Inventory') return <InventoryPanel combatant={combatant} />;
  if (tab === 'GM Notes') {
    if (hasMatchingCampaignNote && !onSaveGmNotes) return <p className='border border-white/10 bg-[#11171a] p-4 text-sm leading-5 text-[#c4cbce]'>see campaign note of same name</p>;
    return <EntityNotesPanel key={combatant._id} notes={entity.notes} onSave={onSaveGmNotes} />;
  }
  if (tab === 'Source') return <SourceImportNotesPanel notes={entity.notes} />;
  return <DetailsPanel combatant={combatant} />;
}

export function SkillsActionsPanel({ combatant }: { combatant: PopulatedCombatant }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [innerTab, setInnerTab] = useState<'skills' | 'actions'>('skills');
  const [skillQuery, setSkillQuery] = useState('');
  const [actionQuery, setActionQuery] = useState('');
  const [actionCost, setActionCost] = useState<string>('ALL');
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
export function AbilitiesPanel({ combatant }: { combatant: PopulatedCombatant }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Phase1Ability | null>(null);
  const abilities = useQuery({
    queryKey: ['phase1-entity-abilities', 'isolated-store', combatant.type, combatant._id],
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
    {(['Weapon', 'Base', 'Added', 'Character', 'Feat'] as const).map((source) => {
      const group = visible.filter((ability) => ability.source === source);
      if (!group.length) return null;
      return <section key={source} className='mb-2.5 border border-white/10 bg-[#11171a]'>
        <h3 className='border-b border-white/10 px-3 py-2 text-xs font-semibold'>{abilityGroupLabel(source)}</h3>
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

export type InventoryItemActions = {
  toggleEquipped: (item: Phase1InvItem) => void;
  toggleInvested: (item: Phase1InvItem) => void;
  setQuantity: (item: Phase1InvItem, quantity: number) => void;
};

export function InventoryPanel({ combatant, itemActions }: { combatant: PopulatedCombatant; itemActions?: InventoryItemActions }) {
  const detailsAvailable = hasFullEntityDetails(combatant);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Phase1InvItem | null>(null);
  const data = useQuery({
    queryKey: ['phase1-entity-inventory', 'isolated-store', combatant.type, combatant._id, JSON.stringify(combatant.data.inventory ?? null)],
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
    {selected && <ItemModal item={selected} actions={itemActions} onClose={() => setSelected(null)} />}
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
          {actions && !item.isFormula && (
            <div className='flex shrink-0 flex-wrap items-center gap-1.5'>
              <button type='button' className='h-8 border border-white/15 px-3 text-xs font-semibold text-[#c4cbce] hover:bg-white/[0.04]' onClick={() => actions.toggleEquipped(item)}>{item.isEquipped ? 'Unequip' : 'Equip'}</button>
              <button type='button' className='h-8 border border-white/15 px-3 text-xs font-semibold text-[#c4cbce] hover:bg-white/[0.04]' onClick={() => actions.toggleInvested(item)}>{item.isInvested ? 'Uninvest' : 'Invest'}</button>
            </div>
          )}
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
            {item.quantity > 0 && (
              <div className='flex items-center gap-2'>
                <AbilityFact label='Quantity' value={String(item.quantity)} />
                {actions && (
                  <span className='flex items-center gap-1'>
                    <button type='button' className='grid h-6 w-6 place-items-center border border-white/15 text-xs hover:bg-white/[0.05]' onClick={() => actions.setQuantity(item, Math.max(0, item.quantity - 1))}>-</button>
                    <button type='button' className='grid h-6 w-6 place-items-center border border-white/15 text-xs hover:bg-white/[0.05]' onClick={() => actions.setQuantity(item, item.quantity + 1)}>+</button>
                  </span>
                )}
              </div>
            )}
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
export function Tag({ children }: { children: ReactNode }) { return <span className='border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-[#98a2a7]'>{children}</span>; }
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
  if (source === 'Character') return 'Character Abilities';
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

  return (
    <div className='space-y-2.5'>
      <div className='grid grid-cols-[minmax(0,1fr)_86px] gap-2.5'>
        <section className='border border-white/10 bg-[#11171a]'>
          <div className='grid grid-cols-2 px-3 py-3 text-center'>
            {canEditHp ? (
              <EditableValueWithNote
                label='Hit points'
                displayValue={<><span className='text-[#5bd6a2]'>{currentHp}</span><span className='mx-1.5 text-[#59656b]'>/</span>{status.maxHp}</>}
                editValue={String(currentHp)}
                canEdit
                accentClass='text-[#5bd6a2]'
                onCommit={(raw, note) => onPersistHpCurrent?.(raw, note)}
              />
            ) : (
              <MetricButton disabled={!openStatDetail} onClick={() => openStatDetail?.('hp')} label='Hit points' value={<><span className='text-[#5bd6a2]'>{currentHp}</span><span className='mx-1.5 text-[#59656b]'>/</span>{status.maxHp}</>} />
            )}
            {canEditTempHp ? (
              <EditableValueWithNote
                label='Temp. HP'
                displayValue={entity.hp_temp || '-'}
                editValue={entity.hp_temp ? String(entity.hp_temp) : ''}
                canEdit
                accentClass={entity.hp_temp ? 'text-[#7eb6ff]' : 'text-[#59656b]'}
                onCommit={(raw, note) => onPersistTempHp?.(raw, note)}
              />
            ) : (
              <Metric label='Temp. HP' value={entity.hp_temp || '-'} />
            )}
          </div>
          <button
            type='button'
            disabled={!openStatDetail}
            className='w-full border-t border-white/[0.07] px-3 py-2 text-center text-[10px] text-[#7d898f] hover:bg-white/[0.03] hover:text-[#c4cbce] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[#7d898f]'
            onClick={() => openStatDetail?.('resist')}
          >
            {resistanceSummary ? 'Resistances, weaknesses & immunities' : 'No resistances or weaknesses'}
          </button>
        </section>
        <CreaturePortrait combatant={combatant} />
      </div>

      {resistanceSummary > 0 && (
        <button type='button' disabled={!openStatDetail} className='w-full border border-white/10 bg-[#11171a] px-3 py-2 text-left text-[11px] leading-5 hover:border-white/20 hover:bg-white/[0.03] disabled:cursor-default disabled:hover:border-white/10 disabled:hover:bg-[#11171a]' onClick={() => openStatDetail?.('resist')}>
          <StatusLine label='Resist' values={status.resistances} />
          <StatusLine label='Weak' values={status.weaknesses} />
          <StatusLine label='Immune' values={status.immunities} />
        </button>
      )}

      {combatant.type === 'CREATURE' && <section className='border border-white/10 bg-[#11171a] px-3 py-2 text-center text-[11px] text-[#aeb7bc]'>
        {status.recallKnowledge ? <><strong className='font-semibold text-[#d5dadd]'>Recall Knowledge</strong> <span className='italic text-[#89949a]'>({[status.recallKnowledge.trait, status.recallKnowledge.rarity].filter(Boolean).join(', ')})</span> {status.recallKnowledge.skill} DC {status.recallKnowledge.dc}</> : <span className='text-[#68747a]'>Recall Knowledge unavailable</span>}
      </section>}

      <section className='grid grid-cols-3 divide-x divide-white/10 border border-white/10 bg-[#11171a]'>
        <IconMetric icon={<Eye size={15} />} label='Perception' value={signed(status.perception)} detail={status.vision} onClick={() => openStatDetail?.('perception')} disabled={!openStatDetail} />
        <IconMetric icon={<Footprints size={15} />} label='Speed' value={status.speed ? `${status.speed} ft.` : '-'} detail={status.otherSpeeds.join(', ') || 'Land speed'} onClick={() => openStatDetail?.('speed')} disabled={!openStatDetail} />
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

      <section className='grid grid-cols-[42%_58%] border border-white/10 bg-[#11171a]'>
        <button type='button' disabled={!openStatDetail} className='grid place-items-center border-r border-white/10 px-3 py-3 text-center hover:bg-white/[0.03] disabled:cursor-default disabled:hover:bg-transparent' onClick={() => openStatDetail?.('ac')}>
          <Shield size={26} className='mb-1 text-[#59656b]' />
          <strong className='text-xl leading-none'>{status.ac}</strong>
          <span className='mt-1 text-[9px] uppercase text-[#68747a]'>Armor class</span>
        </button>
        <div className='divide-y divide-white/[0.07] px-3 py-1.5'>
          <DefenseRow label='Fortitude' value={status.fortitude} onClick={() => openStatDetail?.('fortitude')} disabled={!openStatDetail} />
          <DefenseRow label='Reflex' value={status.reflex} onClick={() => openStatDetail?.('reflex')} disabled={!openStatDetail} />
          <DefenseRow label='Will' value={status.will} onClick={() => openStatDetail?.('will')} disabled={!openStatDetail} />
          <button type='button' disabled={!openStatDetail} className='flex w-full items-center py-1.5 text-left text-xs hover:bg-white/[0.03] disabled:cursor-default disabled:hover:bg-transparent' onClick={() => openStatDetail?.('classDc')}>
            <span className='text-[#aab3b7]'>Class DC</span>
            <strong className='ml-auto'>{status.classDc}</strong>
          </button>
        </div>
      </section>
      {shield && shieldHealth && (
        <button type='button' className='flex w-full items-center gap-3 border border-white/10 bg-[#11171a] px-3 py-2 text-left text-xs hover:border-white/20 hover:bg-white/[0.03]' onClick={() => setShieldItem(inventoryItemToPhase1(shield, 'equipped-shield'))}>
          <Shield size={16} className='shrink-0 text-[#59656b]' />
          <span className='min-w-0 flex-1 truncate text-[#aab3b7]'>{shield.item.name}</span>
          <span className='shrink-0 text-[#c4cbce]'>{signed(shield.item.meta_data?.ac_bonus ?? 0)} AC</span>
          <span className='shrink-0 text-[#89949a]'>Hardness {shieldHealth.hardness}</span>
          <span className='shrink-0 text-[#89949a]'>HP {shieldHealth.hp_current}/{shieldHealth.hp_max}</span>
        </button>
      )}

      <section className='grid grid-cols-2 gap-x-2 gap-y-1.5 border border-white/10 bg-[#11171a] p-3'>
        {ATTRIBUTE_LABELS.map(([key, label]) => <AttributePill key={key} label={label} value={status.attributes[key]} onClick={() => openStatDetail?.(key)} disabled={!openStatDetail} />)}
      </section>

      {calculating && !calculatedStatus && <p className='text-center text-[10px] text-[#68747a]'>Calculating combatant statistics...</p>}
      {calculatedStatus === null && <p className='text-center text-[10px] text-[#a87a70]'>Using stored values; calculated statistics were unavailable.</p>}
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
  return <div><div className='text-xs text-[#b8c0c4]'>{label}</div><div className='mt-1 text-lg font-semibold'>{value}</div></div>;
}
function MetricButton({ label, value, onClick, disabled }: { label: string; value: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='w-full hover:bg-white/[0.03] disabled:cursor-default disabled:hover:bg-transparent' onClick={onClick}><Metric label={label} value={value} /></button>;
}
function IconMetric({ icon, label, value, detail, onClick, disabled }: { icon: ReactNode; label: string; value: ReactNode; detail: string; onClick?: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='min-w-0 px-2 py-3 text-center hover:bg-white/[0.03] disabled:cursor-default disabled:hover:bg-transparent' title={detail} onClick={onClick}><div className='flex items-center justify-center gap-1.5 text-xs text-[#b8c0c4]'>{icon}{label}</div><div className='mt-1 text-lg font-semibold'>{value}</div><div className='mt-1 truncate text-[9px] text-[#68747a]'>{detail}</div></button>;
}
function DefenseRow({ label, value, onClick, disabled }: { label: string; value: number; onClick?: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='flex w-full items-center py-1.5 text-left text-xs hover:bg-white/[0.03] disabled:cursor-default disabled:hover:bg-transparent' onClick={onClick}><span className='text-[#aab3b7]'>{label}</span><strong className='ml-auto'>{signed(value)}</strong></button>;
}
function AttributePill({ label, value, onClick, disabled }: { label: string; value: number; onClick?: () => void; disabled?: boolean }) {
  return <button type='button' disabled={disabled} className='flex h-6 items-center bg-white/[0.045] px-2 text-left text-[11px] hover:bg-white/[0.08] disabled:cursor-default disabled:hover:bg-white/[0.045]' onClick={onClick}><span className='truncate text-[#b1b9bd]'>{label}</span><strong className='ml-auto pl-2'>{signed(value)}</strong></button>;
}
function StatusLine({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return <div><span className='mr-2 font-semibold text-[#8f999e]'>{label}</span><span className='text-[#c3c9cc]'>{values.join(', ')}</span></div>;
}
export function DetailsPanel({ combatant }: { combatant: PopulatedCombatant }) {
  const { open } = useContentLinks();
  const [openGroup, setOpenGroup] = useState<string | null>('attacks');
  const [openProf, setOpenProf] = useState<Phase1StatTarget | null>(null);
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
      <section className='border border-white/10 bg-[#11171a] p-4'>
        {details?.description || fallback ? <ProseMarkdown>{details?.description || fallback}</ProseMarkdown> : <p className='text-sm italic text-[#7f8a90]'>No description given.</p>}
      </section>
      {data.isLoading && <p className='text-center text-[10px] text-[#68747a]'>Loading details...</p>}
      {data.isError && <p className='text-center text-[10px] text-[#a87a70]'>{data.error instanceof Error ? data.error.message : 'Could not load extra details.'}</p>}
      {details?.info.map((field) => (
        <section key={field.label} className='border border-white/10 bg-[#11171a] px-3 py-2.5'>
          <h3 className='text-[10px] font-semibold uppercase text-[#89949a]'>{field.label}</h3>
          <p className='mt-1 text-sm leading-6 text-[#c4cbce]'>{field.value}</p>
        </section>
      ))}
      {details && (
        <>
          <LinkedNameSection title='Languages' items={details.languages} empty='No languages found.' onOpen={open} />
          <LinkedNameSection title='Traits' items={details.rarity ? [{ name: details.rarity }, ...details.traits] : details.traits} empty='No traits found.' onOpen={open} />
          <section className='border border-white/10 bg-[#11171a] px-3 py-2.5'>
            <h3 className='text-[10px] font-semibold uppercase text-[#89949a]'>Size</h3>
            <div className='mt-2'><Tag>{details.size}</Tag></div>
          </section>
          <section className='border border-white/10 bg-[#11171a]'>
            <h3 className='border-b border-white/10 px-3 py-2 text-[10px] font-semibold uppercase text-[#89949a]'>Proficiencies</h3>
            <div className='space-y-1 p-2'>
              {details.profGroups.map((group) => (
                <section key={group.id} className='border border-white/10 bg-[#0d1215]'>
                  <button type='button' className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.03]' onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}>
                    <span className='min-w-0 flex-1 font-semibold text-[#e2e6e8]'>{group.label}</span>
                    <ChevronDown size={14} className={`text-[#7c878d] transition-transform ${openGroup === group.id ? 'rotate-180' : ''}`} />
                  </button>
                  {openGroup === group.id && (
                    <div className='space-y-1 border-t border-white/10 p-2'>
                      {group.items.map((item) => (
                        <ProficiencyRow key={item.variableName} item={item} onOpen={() => setOpenProf({ variableName: item.variableName, isDC: item.isDC })} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </section>
        </>
      )}
      {openProf && <StatDetailModal combatant={combatant as Phase1EntityCombatant} stat={openProf} onClose={() => setOpenProf(null)} />}
    </div>
  );
}

function LinkedNameSection({ title, items, empty, onOpen }: { title: string; items: Array<{ name: string; href?: string }>; empty: string; onOpen: (href: string) => void }) {
  return (
    <section className='border border-white/10 bg-[#11171a] px-3 py-2.5'>
      <h3 className='text-[10px] font-semibold uppercase text-[#89949a]'>{title}</h3>
      <div className='mt-2 flex flex-wrap gap-1.5'>
        {items.length === 0 && <p className='text-sm italic text-[#7f8a90]'>{empty}</p>}
        {items.map((item, index) => item.href ? (
          <button key={`${item.name}-${index}`} type='button' className='border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#c4cbce] hover:border-white/20 hover:bg-white/[0.08]' onClick={() => onOpen(item.href!)}>{item.name}</button>
        ) : (
          <span key={`${item.name}-${index}`} className='border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#c4cbce]'>{item.name}</span>
        ))}
      </div>
    </section>
  );
}

function ProficiencyRow({ item, onOpen }: { item: Phase1ProfRow; onOpen: () => void }) {
  return (
    <button type='button' className='flex w-full items-center gap-2 bg-white/[0.03] px-2 py-1.5 text-left text-xs hover:bg-white/[0.07]' onClick={onOpen}>
      <span className='min-w-0 flex-1 truncate text-[#dce1e3]'>{item.label}</span>
      {item.value && <strong className='shrink-0 text-[#e2e6e8]'>{item.value}</strong>}
      <span className='shrink-0 border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#dce1e3]'>{item.rank}</span>
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
export function SpellsPanel({ combatant, spellActions }: { combatant: PopulatedCombatant; spellActions?: Phase1SpellActions }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Phase1SpellEntry | null>(null);
  const [openProf, setOpenProf] = useState<Phase1StatTarget | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [spellError, setSpellError] = useState('');
  const detailsAvailable = hasFullEntityDetails(combatant);
  const data = useQuery({
    queryKey: ['phase1-entity-spells', 'isolated-store', combatant.type, combatant._id, JSON.stringify(combatant.data.spells ?? null)],
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
      {sections.map((section) => <SpellSection key={section.key} section={section} spellActions={spellActions} busyKey={busyKey} canOpenStats={detailsAvailable && combatant.access?.details_revealed !== false} onOpen={setSelected} onOpenProf={setOpenProf} onCast={(entry) => runSpellAction(`cast-${entry.key}`, () => spellActions!.setCast(entry, true))} onUncast={(entry) => runSpellAction(`uncast-${entry.key}`, () => spellActions!.setCast(entry, false))} onRankSpent={(rank, spent) => runSpellAction(`rank-${section.key}-${rank}`, () => spellActions!.setRankSpent(section, rank, spent))} onFocusSpent={(spent) => runSpellAction(`focus-${section.key}`, () => spellActions!.setFocusSpent(section, spent))} onPreparedSpent={(entry, spent) => runSpellAction(`prepared-${entry.key}`, () => spellActions!.setPreparedSpent(entry, spent))} onInnateSpent={(entry, castsCurrent) => runSpellAction(`innate-${entry.key}`, () => spellActions!.setInnateSpent(entry, castsCurrent))} />)}
      {data.data && !sections.length && <EmptyState>{needle ? 'No spells match this search.' : 'No spells found.'}</EmptyState>}
    </div>
    {selected && <SpellModal entry={selected} spellActions={spellActions} busy={Boolean(busyKey)} onCast={() => runSpellAction(`modal-cast-${selected.key}`, () => spellActions!.setCast(selected, true), true)} onUncast={() => runSpellAction(`modal-uncast-${selected.key}`, () => spellActions!.setCast(selected, false), true)} onClose={() => setSelected(null)} />}
    {openProf && <StatDetailModal combatant={combatant as Phase1EntityCombatant} stat={openProf} onClose={() => setOpenProf(null)} />}
  </>;
}

function SpellSection({ section, spellActions, busyKey, canOpenStats, onOpen, onOpenProf, onCast, onUncast, onRankSpent, onFocusSpent, onPreparedSpent, onInnateSpent }: {
  section: Phase1SpellSection;
  spellActions?: Phase1SpellActions;
  busyKey: string | null;
  canOpenStats: boolean;
  onOpen: (entry: Phase1SpellEntry) => void;
  onOpenProf: (stat: Phase1StatTarget) => void;
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
      {(section.attack != null || section.dc != null) && (
        <div className='mt-2 flex gap-2 text-[11px] text-[#9ca6ab]'>
          {section.attack != null && (
            <button type='button' disabled={!canOpenStats} className='border border-white/10 bg-white/[0.035] px-2 py-1 hover:border-white/20 disabled:cursor-default disabled:hover:border-white/10' onClick={() => onOpenProf({ variableName: 'SPELL_ATTACK' })}>
              Spell attack <strong className='ml-1 text-[#e1e5e7]'>{signed(section.attack)}</strong>
            </button>
          )}
          {section.dc != null && (
            <button type='button' disabled={!canOpenStats} className='border border-white/10 bg-white/[0.035] px-2 py-1 hover:border-white/20 disabled:cursor-default disabled:hover:border-white/10' onClick={() => onOpenProf({ variableName: 'SPELL_DC', isDC: true })}>
              Spell DC <strong className='ml-1 text-[#e1e5e7]'>{section.dc}</strong>
            </button>
          )}
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
