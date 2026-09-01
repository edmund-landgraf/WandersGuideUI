import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import { fetchContentAll, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import { createDefaultOperation } from '@operations/operation-utils';
import { AbilityBlock, AbilityBlockType, ContentSource, Item, Language, Rarity, Spell } from '@schemas/content';
import {
  Operation,
  OperationAdjValue,
  OperationGiveAbilityBlock,
  OperationGiveLanguage,
  OperationGiveSpell,
  OperationSelectFilters,
  OperationSelectFiltersAbilityBlock,
  OperationSelectFiltersAdjValue,
  OperationSelectFiltersLanguage,
  OperationSelectFiltersSpell,
  OperationSelectFiltersTrait,
  OperationSelectOption,
  OperationSelectOptionAbilityBlock,
  OperationSelectOptionAdjValue,
  OperationSelectOptionCustom,
  OperationSelectOptionLanguage,
  OperationSelectOptionSpell,
  OperationSelectOptionType,
  InjectedSelectOption,
  OperationSelect,
} from '@schemas/operations';
import { ExtendedProficiencyValue, ExtendedVariableValue, VariableType, VariableValue } from '@schemas/variables';
import { getVariable } from '@variables/variable-manager';
import { labelToVariable } from '@variables/variable-utils';
import { flatten, isEqual, uniqBy, uniqWith } from 'lodash-es';
import { MinusCircle, PlusCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phase1ContentPickButton } from './content-picker';
import { HowToUseOperations, OperationSection, OperationWrapper } from './operation-section';
import { OpsConfirm, OpsField, OpsSegmented, OpsSelect } from './ops-ui';
import { AdjustValueInput } from './value-ops';
import { Phase1VariableSelect } from './variable-select';

export function SelectionOperation(props: {
  data: {
    title?: string;
    description?: string;
    modeType: 'PREDEFINED' | 'FILTERED';
    optionType: OperationSelectOptionType;
    optionsPredefined?: OperationSelectOption[];
    optionsFilters?: OperationSelectFilters;
  };
  onChange: (option: {
    title?: string;
    description?: string;
    modeType: 'PREDEFINED' | 'FILTERED';
    optionType: OperationSelectOptionType;
    optionsPredefined?: OperationSelectOption[];
    optionsFilters?: OperationSelectFilters;
  }) => void;
  onRemove: () => void;
}) {
  const routeChange = (data: {
    title?: string;
    description?: string;
    modeType?: 'PREDEFINED' | 'FILTERED';
    optionType?: OperationSelectOptionType;
    optionsPredefined?: OperationSelectOption[];
    optionsFilters?: OperationSelectFilters;
  }) => {
    props.onChange({
      title: data.title ?? props.data.title,
      modeType: data.modeType ?? props.data.modeType,
      optionType: data.optionType ?? props.data.optionType,
      optionsPredefined: data.optionsPredefined ?? props.data.optionsPredefined,
      optionsFilters: data.optionsFilters ?? props.data.optionsFilters,
    });
  };

  return (
    <OperationWrapper onRemove={props.onRemove} title='Selection'>
      <OpsSelect
        className='w-[130px]'
        placeholder='Type'
        value={props.data.optionType}
        onChange={(value) => routeChange({ optionType: value as OperationSelectOptionType })}
        options={[
          { label: 'Ability Block', value: 'ABILITY_BLOCK' },
          { label: 'Spell', value: 'SPELL' },
          { label: 'Adjust Value', value: 'ADJ_VALUE' },
          { label: 'Language', value: 'LANGUAGE' },
          { label: 'Trait', value: 'TRAIT' },
          { label: 'Custom', value: 'CUSTOM' },
        ]}
      />
      <div className='w-full space-y-2.5'>
        <OpsField label='Selection Title'>
          <Input
            placeholder='"Select an Option"'
            value={props.data.title ?? ''}
            onChange={(e) => routeChange({ title: e.target.value })}
          />
        </OpsField>
        {['ABILITY_BLOCK', 'SPELL', 'LANGUAGE', 'ADJ_VALUE', 'TRAIT'].includes(props.data.optionType ?? '') && (
          <OpsSegmented
            value={props.data.modeType}
            onChange={(value) => routeChange({ modeType: value as 'PREDEFINED' | 'FILTERED' })}
            options={[
              { label: 'Predefined', value: 'PREDEFINED' },
              { label: 'Filtered', value: 'FILTERED' },
            ]}
          />
        )}
        {props.data.modeType === 'PREDEFINED' && (
          <SelectionPredefined
            optionType={props.data.optionType}
            options={props.data.optionsPredefined}
            onChange={(options) => routeChange({ optionsPredefined: options })}
          />
        )}
        {props.data.modeType === 'FILTERED' && (
          <SelectionFiltered
            optionType={props.data.optionType}
            filters={props.data.optionsFilters}
            onChange={(filters) => routeChange({ optionsFilters: filters })}
          />
        )}
      </div>
    </OperationWrapper>
  );
}

function SelectionFiltered(props: {
  optionType: OperationSelectOptionType | null;
  filters?: OperationSelectFilters;
  onChange: (filters: OperationSelectFilters) => void;
}) {
  if (props.optionType === 'ABILITY_BLOCK') {
    return <SelectionFilteredAbilityBlock filters={props.filters as OperationSelectFiltersAbilityBlock} onChange={props.onChange} />;
  }
  if (props.optionType === 'SPELL') {
    return <SelectionFilteredSpell filters={props.filters as OperationSelectFiltersSpell} onChange={props.onChange} />;
  }
  if (props.optionType === 'LANGUAGE') {
    return <SelectionFilteredLanguage filters={props.filters as OperationSelectFiltersLanguage} onChange={props.onChange} />;
  }
  if (props.optionType === 'TRAIT') {
    return <SelectionFilteredTrait filters={props.filters as OperationSelectFiltersTrait} onChange={props.onChange} />;
  }
  if (props.optionType === 'ADJ_VALUE') {
    return <SelectionFilteredAdjValue filters={props.filters as OperationSelectFiltersAdjValue} onChange={props.onChange} />;
  }
  return null;
}

function SelectionFilteredAbilityBlock(props: {
  filters?: OperationSelectFiltersAbilityBlock;
  onChange: (filters: OperationSelectFiltersAbilityBlock) => void;
}) {
  const [type, setType] = useState<AbilityBlockType | undefined>(props.filters?.abilityBlockType);
  const [minLevel, setMinLevel] = useState<number | undefined>(props.filters?.level.min ?? undefined);
  const [maxLevel, setMaxLevel] = useState<number | undefined>(props.filters?.level.max ?? undefined);
  const [traits, setTraits] = useState<(string | number)[]>(props.filters?.traits ?? []);
  const [isFromClass, setIsFromClass] = useState<boolean | undefined>(props.filters?.isFromClass);
  const [isFromAncestry, setIsFromAncestry] = useState<boolean | undefined>(props.filters?.isFromAncestry);
  const [isFromArchetype, setIsFromArchetype] = useState<boolean | undefined>(props.filters?.isFromArchetype);

  useEffect(() => {
    props.onChange({
      id: props.filters?.id ?? crypto.randomUUID(),
      type: 'ABILITY_BLOCK',
      level: { min: minLevel, max: maxLevel },
      traits,
      abilityBlockType: type,
      isFromClass,
      isFromAncestry,
      isFromArchetype,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLevel, maxLevel, traits, type, isFromClass, isFromAncestry, isFromArchetype]);

  return (
    <div className='space-y-2.5'>
      <OpsSelect
        placeholder='Type'
        value={type}
        onChange={(value) => setType(value as AbilityBlockType)}
        options={[
          { label: 'Action', value: 'action' },
          { label: 'Feat', value: 'feat' },
          { label: 'Physical Feature', value: 'physical-feature' },
          { label: 'Sense', value: 'sense' },
          { label: 'Class Feature', value: 'class-feature' },
          { label: 'Heritage', value: 'heritage' },
        ]}
      />
      <OpsField label='Levels'>
        <div className='flex items-center gap-2'>
          <Input type='number' min={-1} max={20} placeholder='Min' value={minLevel ?? ''} onChange={(e) => setMinLevel(parseInt(e.target.value || '0', 10))} />
          -
          <Input type='number' min={-1} max={20} placeholder='Max' value={maxLevel ?? ''} onChange={(e) => setMaxLevel(parseInt(e.target.value || '0', 10))} />
        </div>
      </OpsField>
      <OpsField label='Has Traits'>
        <Input
          placeholder='Enter trait'
          value={traits.join(', ')}
          onChange={(e) => setTraits(e.target.value.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))}
        />
      </OpsField>
      <label className='flex items-center gap-2 text-xs'>
        <input type='checkbox' checked={!!isFromAncestry} onChange={(e) => setIsFromAncestry(e.target.checked)} />
        Only from your ancestry (unreliable)
      </label>
      <label className='flex items-center gap-2 text-xs'>
        <input type='checkbox' checked={!!isFromClass} onChange={(e) => setIsFromClass(e.target.checked)} />
        Only from your class (unreliable)
      </label>
      <label className='flex items-center gap-2 text-xs'>
        <input type='checkbox' checked={!!isFromArchetype} onChange={(e) => setIsFromArchetype(e.target.checked)} />
        Only from your archetypes (unreliable)
      </label>
    </div>
  );
}

function SelectionFilteredSpell(props: {
  filters?: OperationSelectFiltersSpell;
  onChange: (filters: OperationSelectFiltersSpell) => void;
}) {
  const [minLevel, setMinLevel] = useState<number | undefined>(props.filters?.level.min ?? undefined);
  const [maxLevel, setMaxLevel] = useState<number | undefined>(props.filters?.level.max ?? undefined);
  const [traits, setTraits] = useState<(string | number)[]>(props.filters?.traits ?? []);
  const [traditions, setTraditions] = useState<string[]>(props.filters?.traditions ?? []);
  const [type, setType] = useState(props.filters?.spellData?.type ?? 'NORMAL');
  const [castingSource, setCastingSource] = useState(props.filters?.spellData?.castingSource);
  const [rank, setRank] = useState(props.filters?.spellData?.rank);
  const [tradition, setTradition] = useState(props.filters?.spellData?.tradition);
  const [casts, setCasts] = useState(props.filters?.spellData?.casts);

  useEffect(() => {
    props.onChange({
      id: props.filters?.id ?? crypto.randomUUID(),
      type: 'SPELL',
      level: { min: minLevel, max: maxLevel },
      traits,
      traditions,
      spellData: { type: type ?? 'NORMAL', castingSource, rank, tradition, casts },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLevel, maxLevel, traits, traditions, type, castingSource, rank, tradition, casts]);

  return (
    <div className='space-y-2.5'>
      <p className='text-sm'>Spell Data</p>
      <OpsSegmented
        value={type}
        onChange={(v) => setType(v as 'NORMAL' | 'FOCUS' | 'INNATE')}
        options={[
          { label: 'Normal', value: 'NORMAL' },
          { label: 'Focus', value: 'FOCUS' },
          { label: 'Innate', value: 'INNATE' },
        ]}
      />
      {type === 'NORMAL' && (
        <div className='flex gap-2'>
          <Input className='w-[190px] font-mono' placeholder='Casting Source' value={castingSource ?? ''} onChange={(e) => setCastingSource(labelToVariable(e.target.value, false))} />
          <Input className='w-[70px]' type='number' min={0} max={10} placeholder='Rank' value={rank ?? ''} onChange={(e) => setRank(parseInt(e.target.value || '0', 10))} />
        </div>
      )}
      {type === 'FOCUS' && (
        <Input className='w-[190px] font-mono' placeholder='Casting Source' value={castingSource ?? ''} onChange={(e) => setCastingSource(labelToVariable(e.target.value, false))} />
      )}
      {type === 'INNATE' && (
        <div className='flex flex-wrap gap-2'>
          <OpsSegmented
            value={tradition}
            onChange={(v) => setTradition(v as 'ARCANE' | 'OCCULT' | 'PRIMAL' | 'DIVINE')}
            options={[
              { label: 'Arcane', value: 'ARCANE' },
              { label: 'Divine', value: 'DIVINE' },
              { label: 'Occult', value: 'OCCULT' },
              { label: 'Primal', value: 'PRIMAL' },
            ]}
          />
          <Input className='w-[70px]' type='number' min={0} max={10} placeholder='Rank' value={rank ?? ''} onChange={(e) => setRank(parseInt(e.target.value || '0', 10))} />
          <label className='flex items-center gap-1'>
            <Input className='w-[70px]' type='number' min={0} max={10} placeholder='Casts' value={casts ?? ''} onChange={(e) => setCasts(parseInt(e.target.value || '0', 10))} />
            <span className='text-xs'>/day</span>
          </label>
        </div>
      )}
      <p className='text-sm'>List Filters</p>
      <OpsField label='Levels'>
        <div className='flex items-center gap-2'>
          <Input type='number' placeholder='Min' value={minLevel ?? ''} onChange={(e) => setMinLevel(parseInt(e.target.value || '0', 10))} />
          -
          <Input type='number' placeholder='Max' value={maxLevel ?? ''} onChange={(e) => setMaxLevel(parseInt(e.target.value || '0', 10))} />
        </div>
      </OpsField>
      <div className='flex gap-2'>
        <OpsField label='Has Traits' className='flex-1'>
          <Input placeholder='Enter trait' value={traits.join(', ')} onChange={(e) => setTraits(e.target.value.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))} />
        </OpsField>
        <OpsField label='Has Traditions' className='flex-1'>
          <Input placeholder='Enter tradition' value={traditions.join(', ')} onChange={(e) => setTraditions(e.target.value.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))} />
        </OpsField>
      </div>
    </div>
  );
}

function SelectionFilteredLanguage(props: {
  filters?: OperationSelectFiltersLanguage;
  onChange: (filters: OperationSelectFiltersLanguage) => void;
}) {
  const [rarity, setRarity] = useState<Rarity | undefined>(props.filters?.rarity ?? undefined);
  const [core, setCore] = useState<boolean | 'ANY'>(props.filters?.core ?? 'ANY');

  useEffect(() => {
    props.onChange({
      id: props.filters?.id ?? crypto.randomUUID(),
      type: 'LANGUAGE',
      rarity,
      core: core === 'ANY' ? undefined : core,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rarity, core]);

  return (
    <div className='space-y-2.5'>
      <OpsField label='Rarity'>
        <OpsSelect
          placeholder='Select rarity'
          value={rarity}
          onChange={(value) => setRarity(value ? (value as Rarity) : undefined)}
          options={[
            { label: 'Common', value: 'COMMON' },
            { label: 'Uncommon', value: 'UNCOMMON' },
            { label: 'Rare', value: 'RARE' },
            { label: 'Unique', value: 'UNIQUE' },
          ]}
        />
      </OpsField>
      <OpsSegmented
        value={core === 'ANY' ? 'ANY' : core ? 'CORE' : 'NON-CORE'}
        onChange={(value) => setCore(value === 'ANY' ? 'ANY' : value === 'CORE')}
        options={[
          { label: 'Any', value: 'ANY' },
          { label: 'Core Only', value: 'CORE' },
          { label: 'Non-Core Only', value: 'NON-CORE' },
        ]}
      />
    </div>
  );
}

function SelectionFilteredTrait(props: {
  filters?: OperationSelectFiltersTrait;
  onChange: (filters: OperationSelectFiltersTrait) => void;
}) {
  const [isCreature, setIsCreature] = useState<boolean | undefined>(props.filters?.isCreature ?? undefined);
  const [isAncestry, setIsAncestry] = useState<boolean | undefined>(props.filters?.isAncestry ?? undefined);
  const [isClass, setIsClass] = useState<boolean | undefined>(props.filters?.isClass ?? undefined);

  useEffect(() => {
    props.onChange({
      id: props.filters?.id ?? crypto.randomUUID(),
      type: 'TRAIT',
      isCreature,
      isAncestry,
      isClass,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreature, isAncestry, isClass]);

  return (
    <div className='space-y-2'>
      <label className='flex items-center gap-2 text-xs'>
        <input type='checkbox' checked={!!isClass} onChange={(e) => setIsClass(e.target.checked)} />
        Class Traits
      </label>
      <label className='flex items-center gap-2 text-xs'>
        <input type='checkbox' checked={!!isAncestry} onChange={(e) => setIsAncestry(e.target.checked)} />
        Ancestry Traits
      </label>
      <label className='flex items-center gap-2 text-xs'>
        <input type='checkbox' checked={!!isCreature} onChange={(e) => setIsCreature(e.target.checked)} />
        Creature Traits
      </label>
    </div>
  );
}

function SelectionFilteredAdjValue(props: {
  filters?: OperationSelectFiltersAdjValue;
  onChange: (filters: OperationSelectFiltersAdjValue) => void;
}) {
  const [group, setGroup] = useState<string>(props.filters?.group ?? 'SKILL');
  const [value, setValue] = useState<VariableValue | ExtendedProficiencyValue>(props.filters?.value ?? { value: 'U' });

  useEffect(() => {
    props.onChange({
      id: props.filters?.id ?? crypto.randomUUID(),
      type: 'ADJ_VALUE',
      group: (group ?? 'SKILL') as OperationSelectFiltersAdjValue['group'],
      value: value ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, value]);

  return (
    <div className='space-y-2.5'>
      <OpsSegmented
        value={group}
        onChange={setGroup}
        options={[
          { label: 'Skill', value: 'SKILL' },
          { label: 'Add Lore', value: 'ADD-LORE' },
          { label: 'Attribute', value: 'ATTRIBUTE' },
          { label: 'Weapon Group', value: 'WEAPON-GROUP' },
          { label: 'Weapon', value: 'WEAPON' },
          { label: 'Armor Group', value: 'ARMOR-GROUP' },
          { label: 'Armor', value: 'ARMOR' },
        ]}
      />
      {group && (
        <AdjustValueInput
          variableType={group === 'ATTRIBUTE' ? 'attr' : 'prof'}
          value={value ?? ''}
          onChange={setValue}
          options={{ profExtended: group === 'SKILL' || group === 'ADD-LORE' }}
        />
      )}
    </div>
  );
}

function SelectionPredefined(props: {
  optionType: OperationSelectOptionType | null;
  options?: OperationSelectOption[];
  onChange: (options: OperationSelectOption[]) => void;
}) {
  if (props.optionType === 'ABILITY_BLOCK') {
    return (
      <SelectionPredefinedAbilityBlock
        options={props.options as OperationSelectOptionAbilityBlock[]}
        onChange={props.onChange}
        type='feat'
      />
    );
  }
  if (props.optionType === 'SPELL') {
    return <SelectionPredefinedSpell options={props.options as OperationSelectOptionSpell[]} onChange={props.onChange} />;
  }
  if (props.optionType === 'LANGUAGE') {
    return <SelectionPredefinedLanguage options={props.options as OperationSelectOptionLanguage[]} onChange={props.onChange} />;
  }
  if (props.optionType === 'ADJ_VALUE') {
    return <SelectionPredefinedAdjValue options={props.options as OperationSelectOptionAdjValue[]} onChange={props.onChange} />;
  }
  if (props.optionType === 'CUSTOM') {
    return <SelectionPredefinedCustom options={props.options as OperationSelectOptionCustom[]} onChange={props.onChange} />;
  }
  return null;
}

function OptionRowActions({
  isLast,
  index,
  onAdd,
  onRemove,
}: {
  isLast: boolean;
  index: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      {isLast && index !== 0 && (
        <button type='button' title='Remove Option' className='icon-button' onClick={() => setConfirm(true)}>
          <MinusCircle size={14} />
        </button>
      )}
      {isLast && (
        <button type='button' title='Add Option' className='icon-button' onClick={onAdd}>
          <PlusCircle size={14} />
        </button>
      )}
      {confirm && (
        <OpsConfirm
          title='Remove Option'
          message='Are you sure you want to remove this option? This action cannot be undone.'
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            onRemove();
          }}
        />
      )}
    </>
  );
}

function SelectionPredefinedAbilityBlock(props: {
  options?: OperationSelectOptionAbilityBlock[];
  onChange: (options: OperationSelectOptionAbilityBlock[]) => void;
  type: AbilityBlockType;
}) {
  const [options, setOptions] = useState<OperationSelectOptionAbilityBlock[]>(props.options ?? []);
  useEffect(() => {
    props.onChange(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);
  const optionsForUI =
    options.length === 0
      ? ([
          {
            id: crypto.randomUUID(),
            type: 'ABILITY_BLOCK',
            operation: createDefaultOperation('giveAbilityBlock') as OperationGiveAbilityBlock,
          },
        ] satisfies OperationSelectOptionAbilityBlock[])
      : options;

  return (
    <div className='space-y-2.5'>
      {optionsForUI.map((option, index) => (
        <div key={option.id} className='flex items-center gap-2'>
          <Phase1ContentPickButton<AbilityBlock>
            type='ability-block'
            abilityBlockType={props.type}
            selectedId={option.operation.data.abilityBlockId}
            onSelect={(selected) => {
              setOptions((prev) => {
                const ops = [...prev].filter((op) => op.id !== option.id);
                ops.push({
                  id: option.id,
                  type: 'ABILITY_BLOCK',
                  operation: { ...option.operation, data: { ...option.operation.data, abilityBlockId: selected.id } },
                });
                return ops;
              });
            }}
          />
          <OptionRowActions
            isLast={optionsForUI[optionsForUI.length - 1].id === option.id}
            index={index}
            onAdd={() =>
              setOptions((prev) => [
                ...optionsForUI,
                {
                  id: crypto.randomUUID(),
                  type: 'ABILITY_BLOCK',
                  operation: createDefaultOperation('giveAbilityBlock') as OperationGiveAbilityBlock,
                },
              ])
            }
            onRemove={() => setOptions((prev) => prev.filter((op) => op.id !== option.id))}
          />
        </div>
      ))}
    </div>
  );
}

function SelectionPredefinedSpell(props: {
  options?: OperationSelectOptionSpell[];
  onChange: (options: OperationSelectOptionSpell[]) => void;
}) {
  const [options, setOptions] = useState<OperationSelectOptionSpell[]>(props.options ?? []);
  const firstOption = props.options && (props.options.length > 0 ? props.options[0] : undefined);
  const [type, setType] = useState(firstOption?.operation.data.type ?? 'NORMAL');
  const [castingSource, setCastingSource] = useState(firstOption?.operation.data.castingSource);
  const [rank, setRank] = useState(firstOption?.operation.data.rank);
  const [tradition, setTradition] = useState(firstOption?.operation.data.tradition);
  const [casts, setCasts] = useState(firstOption?.operation.data.casts);

  useEffect(() => {
    const ops = [...options];
    if (ops.length > 0) {
      ops[0] = {
        id: ops[0].id,
        type: 'SPELL',
        operation: {
          ...ops[0].operation,
          data: { ...ops[0].operation.data, type, castingSource, rank, tradition, casts },
        },
      };
    }
    props.onChange(ops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, castingSource, rank, tradition, casts]);

  useEffect(() => {
    props.onChange(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const optionsForUI =
    options.length === 0
      ? ([
          { id: crypto.randomUUID(), type: 'SPELL', operation: createDefaultOperation('giveSpell') as OperationGiveSpell },
        ] satisfies OperationSelectOptionSpell[])
      : options;

  return (
    <div className='space-y-2.5'>
      <p className='text-sm'>Spell Data</p>
      <OpsSegmented
        value={type}
        onChange={(v) => setType(v as 'NORMAL' | 'FOCUS' | 'INNATE')}
        options={[
          { label: 'Normal', value: 'NORMAL' },
          { label: 'Focus', value: 'FOCUS' },
          { label: 'Innate', value: 'INNATE' },
        ]}
      />
      {type === 'NORMAL' && (
        <div className='flex gap-2'>
          <Input className='w-[190px] font-mono' placeholder='Casting Source' value={castingSource ?? ''} onChange={(e) => setCastingSource(labelToVariable(e.target.value, false))} />
          <Input className='w-[70px]' type='number' placeholder='Rank' value={rank ?? ''} onChange={(e) => setRank(parseInt(e.target.value || '0', 10))} />
        </div>
      )}
      {type === 'FOCUS' && (
        <Input className='w-[190px] font-mono' placeholder='Casting Source' value={castingSource ?? ''} onChange={(e) => setCastingSource(labelToVariable(e.target.value, false))} />
      )}
      {type === 'INNATE' && (
        <div className='flex flex-wrap gap-2'>
          <OpsSegmented
            value={tradition}
            onChange={(v) => setTradition(v as 'ARCANE' | 'OCCULT' | 'PRIMAL' | 'DIVINE')}
            options={[
              { label: 'Arcane', value: 'ARCANE' },
              { label: 'Divine', value: 'DIVINE' },
              { label: 'Occult', value: 'OCCULT' },
              { label: 'Primal', value: 'PRIMAL' },
            ]}
          />
          <Input className='w-[70px]' type='number' placeholder='Rank' value={rank ?? ''} onChange={(e) => setRank(parseInt(e.target.value || '0', 10))} />
          <label className='flex items-center gap-1'>
            <Input className='w-[70px]' type='number' placeholder='Casts' value={casts ?? ''} onChange={(e) => setCasts(parseInt(e.target.value || '0', 10))} />
            <span className='text-xs'>/day</span>
          </label>
        </div>
      )}
      <p className='text-sm'>List Options</p>
      {optionsForUI.map((option, index) => (
        <div key={option.id} className='flex items-center gap-2'>
          <Phase1ContentPickButton<Spell>
            type='spell'
            selectedId={option.operation.data.spellId}
            onSelect={(selected) => {
              setOptions((prev) => {
                const ops = [...prev].filter((op) => op.id !== option.id);
                ops.push({
                  id: option.id,
                  type: 'SPELL',
                  operation: { ...option.operation, data: { ...option.operation.data, spellId: selected.id } },
                });
                return ops;
              });
            }}
          />
          <OptionRowActions
            isLast={optionsForUI[optionsForUI.length - 1].id === option.id}
            index={index}
            onAdd={() =>
              setOptions([
                ...optionsForUI,
                { id: crypto.randomUUID(), type: 'SPELL', operation: createDefaultOperation('giveSpell') as OperationGiveSpell },
              ])
            }
            onRemove={() => setOptions((prev) => prev.filter((op) => op.id !== option.id))}
          />
        </div>
      ))}
    </div>
  );
}

function SelectionPredefinedLanguage(props: {
  options?: OperationSelectOptionLanguage[];
  onChange: (options: OperationSelectOptionLanguage[]) => void;
}) {
  const [options, setOptions] = useState<OperationSelectOptionLanguage[]>(props.options ?? []);
  useEffect(() => {
    props.onChange(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);
  const optionsForUI =
    options.length === 0
      ? ([
          { id: crypto.randomUUID(), type: 'LANGUAGE', operation: createDefaultOperation('giveLanguage') as OperationGiveLanguage },
        ] satisfies OperationSelectOptionLanguage[])
      : options;

  return (
    <div className='space-y-2.5'>
      {optionsForUI.map((option, index) => (
        <div key={option.id} className='flex items-center gap-2'>
          <Phase1ContentPickButton<Language>
            type='language'
            selectedId={option.operation.data.languageId}
            onSelect={(selected) => {
              setOptions((prev) => {
                const ops = [...prev].filter((op) => op.id !== option.id);
                ops.push({
                  id: option.id,
                  type: 'LANGUAGE',
                  operation: { ...option.operation, data: { ...option.operation.data, languageId: selected.id } },
                });
                return ops;
              });
            }}
          />
          <OptionRowActions
            isLast={optionsForUI[optionsForUI.length - 1].id === option.id}
            index={index}
            onAdd={() =>
              setOptions([
                ...optionsForUI,
                { id: crypto.randomUUID(), type: 'LANGUAGE', operation: createDefaultOperation('giveLanguage') as OperationGiveLanguage },
              ])
            }
            onRemove={() => setOptions((prev) => prev.filter((op) => op.id !== option.id))}
          />
        </div>
      ))}
    </div>
  );
}

function SelectionPredefinedAdjValue(props: {
  options?: OperationSelectOptionAdjValue[];
  onChange: (options: OperationSelectOptionAdjValue[]) => void;
}) {
  const [variableType, setVariableType] = useState<VariableType>(
    (props.options ?? []).length > 0 ? (getVariable('CHARACTER', props.options![0].operation.data.variable)?.type ?? 'prof') : 'prof'
  );
  const [options, setOptions] = useState<OperationSelectOptionAdjValue[]>(props.options ?? []);
  const [adjustment, setAdjustment] = useState<ExtendedVariableValue | undefined>(
    (props.options ?? []).length > 0 ? props.options![0].operation.data.value : undefined
  );

  useEffect(() => {
    props.onChange(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);
  useEffect(() => {
    setOptions((prev) =>
      prev.map((op) => ({
        ...op,
        operation: { ...op.operation, data: { ...op.operation.data, value: adjustment === undefined ? 0 : adjustment } },
      }))
    );
  }, [adjustment]);

  const optionsForUI =
    options.length === 0
      ? ([
          { id: crypto.randomUUID(), type: 'ADJ_VALUE', operation: createDefaultOperation('adjValue') as OperationAdjValue },
        ] satisfies OperationSelectOptionAdjValue[])
      : options;

  return (
    <div className='space-y-2.5'>
      <div className='flex gap-2'>
        <OpsSelect
          placeholder='Value Type'
          value={variableType}
          onChange={(value) => {
            setVariableType((value as VariableType) || 'prof');
            setOptions([]);
            setAdjustment(undefined);
          }}
          options={[
            { label: 'String', value: 'str' },
            { label: 'Number', value: 'num' },
            { label: 'Boolean', value: 'bool' },
            { label: 'Proficiency', value: 'prof' },
            { label: 'Attribute', value: 'attr' },
            { label: 'List', value: 'list-str' },
          ]}
        />
        <AdjustValueInput variableType={variableType} value={adjustment ?? ''} onChange={setAdjustment} />
      </div>
      {optionsForUI.map((option, index) => (
        <div key={option.id} className='flex items-center gap-2'>
          <Phase1VariableSelect
            value={option.operation.data.variable}
            variableType={variableType}
            onChange={(variableName) => {
              setOptions((prev) => {
                const ops = [...prev].filter((op) => op.id !== option.id);
                ops.push({
                  id: option.id,
                  type: 'ADJ_VALUE',
                  operation: {
                    ...option.operation,
                    data: { ...option.operation.data, variable: variableName, value: adjustment === undefined ? 0 : adjustment },
                  },
                });
                return ops;
              });
            }}
          />
          <OptionRowActions
            isLast={optionsForUI[optionsForUI.length - 1].id === option.id}
            index={index}
            onAdd={() =>
              setOptions([
                ...optionsForUI,
                { id: crypto.randomUUID(), type: 'ADJ_VALUE', operation: createDefaultOperation('adjValue') as OperationAdjValue },
              ])
            }
            onRemove={() => setOptions((prev) => prev.filter((op) => op.id !== option.id))}
          />
        </div>
      ))}
    </div>
  );
}

function SelectionPredefinedCustom(props: {
  options?: OperationSelectOptionCustom[];
  onChange: (options: OperationSelectOptionCustom[]) => void;
}) {
  const [options, setOptions] = useState<OperationSelectOptionCustom[]>(
    props.options && props.options.length > 0
      ? props.options
      : [{ id: crypto.randomUUID(), type: 'CUSTOM', title: '', description: '', operations: [] }]
  );
  useEffect(() => {
    props.onChange(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);
  const optionsForUI =
    options.length === 0
      ? ([{ id: crypto.randomUUID(), type: 'CUSTOM', title: '', description: '', operations: [] }] satisfies OperationSelectOptionCustom[])
      : options;

  return (
    <div className='space-y-2.5'>
      {optionsForUI.map((option, index) => (
        <div key={option.id} className='flex items-start gap-2'>
          <SelectionPredefinedCustomOption
            option={option}
            onChange={(newOption) => setOptions((prev) => prev.map((op) => (op.id === newOption.id ? newOption : op)))}
          />
          <OptionRowActions
            isLast={optionsForUI[optionsForUI.length - 1].id === option.id}
            index={index}
            onAdd={() =>
              setOptions([...optionsForUI, { id: crypto.randomUUID(), type: 'CUSTOM', title: '', description: '', operations: [] }])
            }
            onRemove={() => setOptions((prev) => prev.filter((op) => op.id !== option.id))}
          />
        </div>
      ))}
    </div>
  );
}

export function SelectionPredefinedCustomOption(props: {
  option: OperationSelectOptionCustom;
  onChange: (option: OperationSelectOptionCustom) => void;
}) {
  const [name, setName] = useState(props.option.title);
  const [descriptionText, setDescriptionText] = useState(props.option.description);
  const [operations, setOperations] = useState<Operation[]>(props.option.operations ?? []);
  const [openedOperations, setOpenedOperations] = useState(false);

  useEffect(() => {
    props.onChange({ ...props.option, title: name, description: descriptionText, operations });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, descriptionText, operations]);

  return (
    <div className='min-w-0 flex-1 space-y-2'>
      <OpsField label='Name'>
        <Input required defaultValue={props.option.title} onChange={(event) => setName(event.target.value)} />
      </OpsField>
      <OpsField label='Description'>
        <Textarea required value={descriptionText} onChange={(event) => setDescriptionText(event.target.value)} />
      </OpsField>
      <button type='button' className='inline-flex items-center gap-2 text-sm' onClick={() => setOpenedOperations((v) => !v)}>
        <span className={`rounded-full px-2 py-0.5 ${openedOperations ? 'bg-p1-hover' : 'border border-p1-border'}`}>Operations</span>
        {operations.length > 0 && <span className='text-xs text-p1-accent'>{operations.length}</span>}
      </button>
      {openedOperations && (
        <OperationSection title={<HowToUseOperations />} operations={operations} onChange={setOperations} />
      )}
    </div>
  );
}

interface WrappedOperationSelect extends OperationSelect {
  _sourceName: string;
}

export function InjectSelectOp(props: { value: string; onSelect: (value: string) => void; onRemove: () => void }) {
  const [option, setOption] = useState<InjectedSelectOption | null>(props.value ? JSON.parse(props.value) : null);
  const { data } = useQuery({
    queryKey: ['phase1-get-all-selection-options', { sources: getDefaultSourcesKey('PAGE') }],
    queryFn: async () => {
      const operations: Operation[] = [];
      const abOpps = (await fetchContentAll<AbilityBlock>('ability-block', getDefaultSources('PAGE'))).map((ab) =>
        (ab.operations ?? []).map((op) => ({ ...op, _sourceName: ab.name }))
      );
      operations.push(...uniqWith(flatten(abOpps), isEqual));
      const csOpps = (await fetchContentAll<ContentSource>('content-source', getDefaultSources('PAGE'))).map((cs) =>
        (cs.operations ?? []).map((op) => ({ ...op, _sourceName: cs.name }))
      );
      operations.push(...uniqWith(flatten(csOpps), isEqual));
      const iOpps = (await fetchContentAll<Item>('item', getDefaultSources('PAGE'))).map((i) =>
        (i.operations ?? []).map((op) => ({ ...op, _sourceName: i.name }))
      );
      operations.push(...uniqWith(flatten(iOpps), isEqual));
      return uniqBy(
        operations.filter(
          (op) => op.type === 'select' && op.data.modeType === 'PREDEFINED' && op.data.optionType === 'CUSTOM'
        ) as WrappedOperationSelect[],
        'id'
      );
    },
  });

  useEffect(() => {
    props.onSelect(JSON.stringify(option));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Inject Select Option'>
      <div className='w-full space-y-2'>
        <OpsSelect
          className='w-[220px]'
          placeholder='Selection to Inject Into'
          value={option?.opId}
          onChange={(value) => {
            setOption({
              opId: value,
              option: {
                id: crypto.randomUUID(),
                type: 'CUSTOM',
                title: '',
                description: '',
                operations: [],
              } satisfies OperationSelectOptionCustom,
            });
          }}
          options={(data ?? []).map((op) => ({
            value: op.id,
            label: `${op._sourceName} - ${op.data.title ?? 'Select an Option'}`,
          }))}
        />
        {option?.opId && (
          <SelectionPredefinedCustomOption
            option={option.option}
            onChange={(newOption) => setOption((prev) => ({ ...prev!, option: newOption }))}
          />
        )}
      </div>
    </OperationWrapper>
  );
}

