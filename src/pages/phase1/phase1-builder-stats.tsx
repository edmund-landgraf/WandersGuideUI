import { getFinalHealthValue, getFinalProfValue } from '@variables/variable-helpers';
import { getAllSkillVariables, getVariable } from '@variables/variable-manager';
import { compileProficiencyType, variableToLabel } from '@variables/variable-utils';
import type { VariableAttr, VariableProf } from '@schemas/variables';
import type { OperationCharacterResultPackage } from '@schemas/content';

const ATTRIBUTES = [
  ['STR', 'ATTRIBUTE_STR'],
  ['DEX', 'ATTRIBUTE_DEX'],
  ['CON', 'ATTRIBUTE_CON'],
  ['INT', 'ATTRIBUTE_INT'],
  ['WIS', 'ATTRIBUTE_WIS'],
  ['CHA', 'ATTRIBUTE_CHA'],
] as const;

export function Phase1BuilderStats({ results }: { results: OperationCharacterResultPackage | null }) {
  void results;
  const hp = getFinalHealthValue('CHARACTER');
  const perception = getFinalProfValue('CHARACTER', 'PERCEPTION');
  const classDc = getFinalProfValue('CHARACTER', 'CLASS_DC', true);
  const classDcProf = compileProficiencyType(getVariable<VariableProf>('CHARACTER', 'CLASS_DC')?.value);
  const fort = getFinalProfValue('CHARACTER', 'SAVE_FORT');
  const reflex = getFinalProfValue('CHARACTER', 'SAVE_REFLEX');
  const will = getFinalProfValue('CHARACTER', 'SAVE_WILL');
  const skills = getAllSkillVariables('CHARACTER')
    .filter((skill) => skill.name !== 'SKILL_LORE____' && compileProficiencyType(skill.value) !== 'U')
    .slice(0, 8);

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-6 gap-1 border border-p1-border bg-p1-inset p-2'>
        {ATTRIBUTES.map(([label, name]) => {
          const attribute = getVariable<VariableAttr>('CHARACTER', name);
          const value = attribute?.value.value ?? 0;
          return (
            <div key={name} className='text-center'>
              <div className='text-[10px] uppercase text-p1-faint'>{label}</div>
              <div className='text-sm font-semibold'>
                {value < 0 ? '-' : '+'}
                {Math.abs(value)}
              </div>
            </div>
          );
        })}
      </div>
      <dl className='space-y-1 text-sm'>
        <StatRow label='Hit Points' value={String(hp)} />
        <StatRow label='Class DC' value={`${classDc} ${classDcProf}`} />
        <StatRow label='Perception' value={perception} />
        <StatRow label='Fortitude' value={fort} />
        <StatRow label='Reflex' value={reflex} />
        <StatRow label='Will' value={will} />
      </dl>
      {skills.length > 0 && (
        <div>
          <div className='mb-1 text-[10px] font-semibold uppercase text-p1-faint'>Skills</div>
          <div className='space-y-0.5 text-sm'>
            {skills.map((skill) => (
              <div key={skill.name} className='flex justify-between gap-2'>
                <span className='truncate text-p1-muted'>{variableToLabel(skill)}</span>
                <span>
                  {getFinalProfValue('CHARACTER', skill.name)} {compileProficiencyType(skill.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between gap-3'>
      <dt className='text-p1-muted'>{label}</dt>
      <dd className='font-medium'>{value}</dd>
    </div>
  );
}
