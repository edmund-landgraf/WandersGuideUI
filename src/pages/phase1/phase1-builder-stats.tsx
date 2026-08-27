import { useMemo, useState } from 'react';
import { getFinalHealthValue, getFinalProfValue } from '@variables/variable-helpers';
import { getAllSkillVariables, getVariable } from '@variables/variable-manager';
import { compileProficiencyType, variableToLabel } from '@variables/variable-utils';
import type { VariableAttr, VariableProf } from '@schemas/variables';
import type { Character, ContentPackage, OperationCharacterResultPackage } from '@schemas/content';
import { SkillModal } from './phase1-entity-panels';
import { StatDetailModal, StatHoverCard, type Phase1StatTarget } from './phase1-stat-modal';
import { statCalculationPreview } from './phase1-stat-details';
import { buildSkill, skillCatalogFromContent } from './phase1-skills';

const ATTRIBUTES = [
  ['STR', 'ATTRIBUTE_STR', 'strength'],
  ['DEX', 'ATTRIBUTE_DEX', 'dexterity'],
  ['CON', 'ATTRIBUTE_CON', 'constitution'],
  ['INT', 'ATTRIBUTE_INT', 'intelligence'],
  ['WIS', 'ATTRIBUTE_WIS', 'wisdom'],
  ['CHA', 'ATTRIBUTE_CHA', 'charisma'],
] as const;

const STORE = 'CHARACTER';

export function Phase1BuilderStats({
  results,
  character,
  content,
}: {
  results: OperationCharacterResultPackage | null;
  character: Character;
  content: ContentPackage;
}) {
  void results;
  const hp = getFinalHealthValue(STORE);
  const perception = getFinalProfValue(STORE, 'PERCEPTION');
  const classDc = getFinalProfValue(STORE, 'CLASS_DC', true);
  const classDcProf = compileProficiencyType(getVariable<VariableProf>(STORE, 'CLASS_DC')?.value);
  const fort = getFinalProfValue(STORE, 'SAVE_FORT');
  const reflex = getFinalProfValue(STORE, 'SAVE_REFLEX');
  const will = getFinalProfValue(STORE, 'SAVE_WILL');
  const skills = getAllSkillVariables(STORE).filter((skill) => skill.name !== 'SKILL_LORE____' && compileProficiencyType(skill.value) !== 'U');
  const catalog = useMemo(() => skillCatalogFromContent(content), [content]);
  const [openStat, setOpenStat] = useState<Phase1StatTarget | null>(null);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const selectedSkill = openSkill ? skills.find((skill) => skill.name === openSkill) : null;

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-6 gap-1 border border-p1-border bg-p1-inset p-2'>
        {ATTRIBUTES.map(([label, name, key]) => {
          const attribute = getVariable<VariableAttr>(STORE, name);
          const value = attribute?.value.value ?? 0;
          return (
            <CalcButton key={name} stat={key} onClick={() => setOpenStat(key)} className='px-0 py-1 text-center' hover='below'>
              <div className='text-[10px] uppercase text-p1-faint'>{label}</div>
              <div className='text-sm font-semibold'>
                {value < 0 ? '-' : '+'}
                {Math.abs(value)}
              </div>
            </CalcButton>
          );
        })}
      </div>
      <dl className='space-y-1 text-sm'>
        <StatRow label='Hit Points' value={String(hp)} stat='hp' onClick={() => setOpenStat('hp')} />
        <StatRow label='Class DC' value={`${classDc} ${classDcProf}`} stat='classDc' onClick={() => setOpenStat('classDc')} />
        <StatRow label='Perception' value={perception} stat='perception' onClick={() => setOpenStat('perception')} />
        <StatRow label='Fortitude' value={fort} stat='fortitude' onClick={() => setOpenStat('fortitude')} />
        <StatRow label='Reflex' value={reflex} stat='reflex' onClick={() => setOpenStat('reflex')} />
        <StatRow label='Will' value={will} stat='will' onClick={() => setOpenStat('will')} />
      </dl>
      {skills.length > 0 && (
        <div>
          <div className='mb-1 text-[10px] font-semibold uppercase text-p1-faint'>Skills</div>
          <div className='space-y-0.5 text-sm'>
            {skills.map((skill) => (
              <CalcButton
                key={skill.name}
                stat={{ variableName: skill.name }}
                onClick={() => setOpenSkill(skill.name)}
                className='flex w-full justify-between gap-2 px-1 py-0.5 text-left'
              >
                <span className='truncate text-p1-muted'>{variableToLabel(skill)}</span>
                <span>
                  {getFinalProfValue(STORE, skill.name)} {compileProficiencyType(skill.value)}
                </span>
              </CalcButton>
            ))}
          </div>
        </div>
      )}
      {openStat && (
        <StatDetailModal
          storeId={STORE}
          entity={character}
          content={content}
          stat={openStat}
          onClose={() => setOpenStat(null)}
        />
      )}
      {selectedSkill && (
        <SkillModal skill={buildSkill(selectedSkill, STORE, catalog)} onClose={() => setOpenSkill(null)} />
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
  stat,
  onClick,
}: {
  label: string;
  value: string;
  stat: Phase1StatTarget;
  onClick: () => void;
}) {
  return (
    <CalcButton stat={stat} onClick={onClick} className='flex w-full justify-between gap-3 px-1 py-0.5 text-left'>
      <dt className='text-p1-muted'>{label}</dt>
      <dd className='font-medium'>{value}</dd>
    </CalcButton>
  );
}

function CalcButton({
  stat,
  onClick,
  className,
  children,
  hover = 'end',
}: {
  stat: Phase1StatTarget;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
  hover?: 'end' | 'below';
}) {
  const preview = statCalculationPreview(STORE, stat);
  return (
    <button type='button' className={`group relative z-10 hover:z-50 hover:bg-p1-hover ${className}`} onClick={onClick}>
      {children}
      <StatHoverCard breakdown={preview.breakdown} timeline={preview.timeline} placement={hover} />
    </button>
  );
}
