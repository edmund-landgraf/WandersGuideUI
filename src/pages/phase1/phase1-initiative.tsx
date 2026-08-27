import { GiDiceTwentyFacesTwenty } from '@common/game-icons-inline';
import type { Character, Combatant, Encounter, InitiativeRoundLog, InitiativeRoundLogEntry, LivingEntity } from '@schemas/content';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { isCharacter, isCreature, isTruthy } from '@utils/type-fixing';
import { getFinalProfValue } from '@variables/variable-helpers';
import { getAllSkillVariables } from '@variables/variable-manager';
import { ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { preparePhase1Entity, type Phase1EntityCombatant } from './phase1-entity';

export type InitiativeCombatant = Combatant & { data: LivingEntity };
export type InitiativeSkillOption = { value: string; label: string; num: number };
export type InitiativeRollChoice = { bonus: number; source: string } | null;
export type InitiativeRollBreakdown = NonNullable<Combatant['initiative_roll']>;

export function formatInitiativeRoll(roll: InitiativeRollBreakdown, total?: number) {
  const bonus = roll.source ? `${roll.source} (${sign(roll.bonus)})` : roll.bonus !== 0 ? sign(roll.bonus) : null;
  const equation = bonus ? `d20 (${roll.die}) + ${bonus}` : `d20 (${roll.die})`;
  return total === undefined ? equation : `${equation} = ${total}`;
}

export function buildInitiativeRoundLog(
  round: number,
  combatants: InitiativeCombatant[],
  rolledIds: ReadonlySet<string>,
): InitiativeRoundLog {
  const entries = combatants.map((combatant) => {
    const rolled = rolledIds.has(combatant._id);
    if (rolled && combatant.initiative_roll && combatant.initiative !== undefined) {
      return {
        name: combatant.data.name,
        ally: combatant.ally,
        initiative: combatant.initiative,
        calculation: formatInitiativeRoll(combatant.initiative_roll, combatant.initiative),
        combatant_id: combatant._id,
      };
    }
    return {
      name: combatant.data.name,
      ally: combatant.ally,
      initiative: combatant.initiative ?? null,
      calculation: 'Skipped',
      combatant_id: combatant._id,
    };
  });
  return { id: crypto.randomUUID(), round, entries };
}

export function nextInitiativeRoundNumber(log: InitiativeRoundLog[] | undefined) {
  if (!log?.length) return 1;
  const rounds = log.map((entry) => entry.round).filter((round) => Number.isFinite(round));
  if (rounds.length === 0) return 1;
  return Math.max(...rounds) + 1;
}

export function overlayInitiativeLogs(encounters: Encounter[], logs: ReadonlyMap<number, InitiativeRoundLog[]>): Encounter[] {
  if (logs.size === 0) return encounters;
  return encounters.map((encounter) => {
    const log = logs.get(encounter.id);
    if (log === undefined) return encounter;
    return { ...encounter, meta_data: { ...encounter.meta_data, initiative_log: log } };
  });
}

export function isCombatantOut(combatant: Pick<Combatant, 'out'>) {
  return combatant.out === 'dead' || combatant.out === 'incapacitated';
}

export function roundLogEntryMatchesCombatant(
  entry: InitiativeRoundLogEntry,
  combatant: Pick<Combatant, '_id' | 'ally'> & { data?: { name: string } },
) {
  if (entry.combatant_id) return entry.combatant_id === combatant._id;
  return entry.name === combatant.data?.name && entry.ally === combatant.ally;
}

function sameRoundLog(a: InitiativeRoundLog, b: InitiativeRoundLog) {
  if (a.id && b.id) return a.id === b.id;
  return a.round === b.round;
}

function sameRoundLogEntry(a: InitiativeRoundLogEntry, b: InitiativeRoundLogEntry) {
  if (a.combatant_id && b.combatant_id) return a.combatant_id === b.combatant_id;
  return a.name === b.name && a.ally === b.ally && a.calculation === b.calculation;
}

export function setRoundLogEntryNote(
  log: InitiativeRoundLog[],
  round: InitiativeRoundLog,
  entry: InitiativeRoundLogEntry,
  note: string,
): InitiativeRoundLog[] {
  const nextNote = note.trim() || undefined;
  return log.map((item) => {
    if (!sameRoundLog(item, round)) return item;
    return {
      ...item,
      entries: item.entries.map((current) => (
        sameRoundLogEntry(current, entry) ? { ...current, note: nextNote } : current
      )),
    };
  });
}

export function isEmptyInitiative(combatant: Combatant) {
  return combatant.initiative === undefined || combatant.initiative === null || Number.isNaN(combatant.initiative);
}

export function sortCombatantsByInitiative<T extends Combatant>(combatants: T[]) {
  if (combatants.every(isEmptyInitiative)) return combatants;
  return [...combatants].sort((a, b) => {
    const aEmpty = isEmptyInitiative(a);
    const bEmpty = isEmptyInitiative(b);
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return -1;
    if (bEmpty) return 1;
    let aI = a.initiative;
    let bI = b.initiative;
    if (aI === bI) {
      if (a.ally && !b.ally) return 1;
      if (!a.ally && b.ally) return -1;
      return a._id.localeCompare(b._id);
    }
    if (aI == null || bI == null) return 0;
    return bI - aI;
  });
}

function optionsFromCharacterProfs(profs: Record<string, { total: number } | undefined> | undefined): InitiativeSkillOption[] {
  if (!profs) return [];
  const skills = Object.keys(profs).filter((prof) => prof.startsWith('SKILL_'));
  return ['PERCEPTION', ...skills]
    .map((skill) => {
      const value = profs[skill];
      if (!value) return null;
      return {
        value: skill,
        label: `${toLabel(skill)}, ${sign(value.total)}`,
        num: value.total,
      };
    })
    .filter(isTruthy)
    .sort(compareInitiativeOptions);
}

function optionsFromStore(storeId: string): InitiativeSkillOption[] {
  const skills = getAllSkillVariables(storeId).filter((skill) => skill.name !== 'SKILL_LORE____');
  return ['PERCEPTION', ...skills.map((skill) => skill.name)]
    .map((skill) => {
      const value = getFinalProfValue(storeId, skill);
      return {
        value: skill,
        label: `${toLabel(skill)}, ${value}`,
        num: Number.parseInt(value, 10),
      };
    })
    .sort(compareInitiativeOptions);
}

function compareInitiativeOptions(a: InitiativeSkillOption, b: InitiativeSkillOption) {
  if (a.value === 'PERCEPTION') return -1;
  if (b.value === 'PERCEPTION') return 1;
  if (a.num === b.num) return a.value.localeCompare(b.value);
  return b.num - a.num;
}

async function loadInitiativeOptions(combatant: InitiativeCombatant): Promise<InitiativeSkillOption[]> {
  if (combatant.type === 'CHARACTER' && isCharacter(combatant.data)) {
    const fromStats = optionsFromCharacterProfs(combatant.data.meta_data?.calculated_stats?.profs);
    if (fromStats.length) return fromStats;
  }

  const canPrepare =
    (combatant.type === 'CHARACTER' && isCharacter(combatant.data) && hasFullCharacterDetails(combatant.data))
    || (combatant.type === 'CREATURE' && isCreature(combatant.data));
  if (!canPrepare) return [];

  try {
    const { storeId } = await preparePhase1Entity(combatant as Phase1EntityCombatant);
    return optionsFromStore(storeId);
  } catch {
    return [];
  }
}

async function loadAllInitiativeOptions(combatants: InitiativeCombatant[]) {
  const optionsById: Record<string, InitiativeSkillOption[]> = {};
  const needPrepare: InitiativeCombatant[] = [];

  for (const combatant of combatants) {
    if (combatant.type === 'CHARACTER' && isCharacter(combatant.data)) {
      const fromStats = optionsFromCharacterProfs(combatant.data.meta_data?.calculated_stats?.profs);
      if (fromStats.length) {
        optionsById[combatant._id] = fromStats;
        continue;
      }
    }
    needPrepare.push(combatant);
  }

  for (const combatant of needPrepare.filter((item) => item.type === 'CHARACTER')) {
    optionsById[combatant._id] = await loadInitiativeOptions(combatant);
  }

  const creatureEntries = await Promise.all(
    needPrepare.filter((item) => item.type === 'CREATURE').map(async (combatant) => [combatant._id, await loadInitiativeOptions(combatant)] as const)
  );
  for (const [id, options] of creatureEntries) {
    optionsById[id] = options;
  }

  for (const combatant of combatants) {
    if (!optionsById[combatant._id]) optionsById[combatant._id] = [];
  }
  return optionsById;
}

function hasFullCharacterDetails(character: Character) {
  return Boolean(character.user_id && character.created_at);
}

export function InitiativeRollModal({
  combatants,
  onConfirm,
  onClose,
}: {
  combatants: InitiativeCombatant[];
  onConfirm: (rollBonuses: Map<string, InitiativeRollChoice>) => void;
  onClose: () => void;
}) {
  const [optionsById, setOptionsById] = useState<Record<string, InitiativeSkillOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(combatants.map((combatant) => [combatant._id, 'PERCEPTION']))
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAllInitiativeOptions(combatants)
      .then((loaded) => {
        if (cancelled) return;
        setOptionsById(loaded);
        setSelected((current) => {
          const next = { ...current };
          for (const combatant of combatants) {
            const options = loaded[combatant._id] ?? [];
            if (next[combatant._id] === 'PERCEPTION' && !options.some((option) => option.value === 'PERCEPTION')) {
              next[combatant._id] = null;
            }
          }
          return next;
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [combatants]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const rollBonuses = useMemo(() => {
    const bonuses = new Map<string, InitiativeRollChoice>();
    for (const combatant of combatants) {
      const value = selected[combatant._id];
      const option = value ? (optionsById[combatant._id] ?? []).find((item) => item.value === value) : undefined;
      bonuses.set(combatant._id, option ? { bonus: option.num, source: toLabel(option.value) } : null);
    }
    return bonuses;
  }, [combatants, optionsById, selected]);

  return createPortal(
    <div
      data-entity-modal
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='initiative-roll-title'
        className='flex max-h-[min(82vh,640px)] w-full max-w-md flex-col border border-p1-border bg-p1-surface shadow-2xl'
      >
        <header className='flex items-start gap-3 border-b border-p1-border px-4 py-3'>
          <div className='min-w-0 flex-1'>
            <h2 id='initiative-roll-title' className='text-lg font-semibold'>
              Assign Initiative Skills
            </h2>
            <p className='mt-1 text-sm text-p1-muted'>Set which bonus to use for roll (or none to skip).</p>
          </div>
          <button type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
          {loading && <p className='py-8 text-center text-sm text-p1-muted'>Loading modifiers...</p>}
          {!loading && (
            <div className='flex flex-col gap-3'>
              {combatants.map((combatant) => (
                <InitiativeSelect
                  key={combatant._id}
                  id={combatant._id}
                  label={combatant.data.name}
                  options={optionsById[combatant._id] ?? []}
                  value={selected[combatant._id] ?? null}
                  onChange={(value) => setSelected((current) => ({ ...current, [combatant._id]: value }))}
                />
              ))}
            </div>
          )}
        </div>
        <div className='flex flex-col gap-2 border-t border-p1-border p-4'>
          <button
            type='button'
            className='inline-flex h-10 w-full items-center justify-center border border-p1-border text-sm font-semibold text-p1-text hover:bg-p1-inset disabled:opacity-50'
            disabled={loading}
            onClick={() =>
              setSelected(Object.fromEntries(combatants.map((combatant) => [combatant._id, null])))
            }
          >
            Skip all
          </button>
          <button
            type='button'
            className='inline-flex h-11 w-full items-center justify-center gap-2 bg-p1-action text-sm font-bold italic text-p1-action-ink hover:bg-p1-action-hover disabled:opacity-50'
            disabled={loading}
            onClick={() => onConfirm(rollBonuses)}
          >
            Roll Initiative
            <GiDiceTwentyFacesTwenty size={20} />
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function InitiativeSelect({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: InitiativeSkillOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selectId = `initiative-${id}`;
  return (
    <div>
      <label htmlFor={selectId} className='mb-1.5 block text-sm font-semibold'>
        {label}
      </label>
      <div className='relative'>
        <select
          id={selectId}
          className='h-10 w-full appearance-none border border-p1-border bg-p1-inset py-0 pl-3 pr-16 text-sm text-p1-text outline-none focus:border-p1-accent/60'
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value=''>Skip</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2'>
          {value && (
            <button
              type='button'
              className='pointer-events-auto grid h-7 w-7 place-items-center text-p1-muted hover:text-p1-text'
              title='Skip'
              onClick={() => onChange(null)}
            >
              <X size={14} />
            </button>
          )}
          <ChevronsUpDown className='text-p1-faint' size={14} />
        </div>
      </div>
    </div>
  );
}
