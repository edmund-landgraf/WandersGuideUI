import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import {
  AttributeValue,
  ExtendedProficiencyValue,
  ExtendedVariableValue,
  ProficiencyValue,
  StoreID,
  Variable,
  VariableType,
  VariableValue,
} from '@schemas/variables';
import { getVariable } from '@variables/variable-manager';
import { labelToVariable } from '@variables/variable-utils';
import { isBoolean, isNumber, isString } from 'lodash-es';
import { useEffect, useState } from 'react';
import { OperationWrapper } from './operation-section';
import { OpsField, OpsSegmented, OpsSelect } from './ops-ui';
import { Phase1VariableSelect } from './variable-select';

export function AdjValOp(props: {
  variable: string;
  value: ExtendedVariableValue;
  onSelect: (variable: string) => void;
  onValueChange: (value: ExtendedVariableValue) => void;
  onRemove: () => void;
}) {
  const [variableName, setVariableName] = useState(props.variable);
  const [variableData, setVariableData] = useState<Variable | undefined>(getVariable('CHARACTER', props.variable) ?? undefined);
  const [value, setValue] = useState<ExtendedVariableValue>(props.value);

  useEffect(() => {
    setVariableName(props.variable);
    setVariableData(getVariable('CHARACTER', props.variable) ?? undefined);
    setValue(props.value);
  }, [props.value, props.variable]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Adjust Value'>
      <div className='flex flex-wrap gap-2'>
        <Phase1VariableSelect
          value={variableName}
          onChange={(next, variable) => {
            setVariableName(next);
            setVariableData(variable);
            props.onSelect(next);
            setValue('');
          }}
        />
        {variableData && (
          <AdjustValueInput
            variableType={variableData.type}
            value={value}
            onChange={(next) => {
              setValue(next);
              props.onValueChange(next);
            }}
            options={{ profExtended: variableData.type === 'prof' }}
          />
        )}
      </div>
    </OperationWrapper>
  );
}

export function AdjustValueInput(props: {
  variableType: VariableType;
  value: VariableValue | ExtendedProficiencyValue;
  onChange: (value: VariableValue) => void;
  options?: { profExtended?: boolean };
}) {
  useEffect(() => {
    if (props.value !== '') return;
    if (props.variableType === 'attr') props.onChange({ value: 0 });
    else if (props.variableType === 'num') props.onChange(0);
    else if (props.variableType === 'bool') props.onChange(false);
    else if (props.variableType === 'str' || props.variableType === 'list-str') props.onChange('');
    else if (props.variableType === 'prof') props.onChange({ value: 'U', increases: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (props.variableType === 'attr') {
    const value = props.value as AttributeValue;
    return (
      <Input
        type='number'
        placeholder='Number to Add'
        value={Number.isFinite(value.value) ? value.value : ''}
        onChange={(event) => props.onChange({ value: parseInt(event.target.value || '0', 10), partial: value.partial })}
      />
    );
  }
  if (props.variableType === 'num') {
    const value = props.value as number;
    return (
      <Input
        type='number'
        placeholder='Number to Add'
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => props.onChange(parseInt(event.target.value || '0', 10))}
      />
    );
  }
  if (props.variableType === 'bool') {
    return (
      <OpsSegmented
        value={(props.value as boolean) ? 'TRUE' : 'FALSE'}
        onChange={(val) => props.onChange(val === 'TRUE')}
        options={[
          { label: 'True', value: 'TRUE' },
          { label: 'False', value: 'FALSE' },
        ]}
      />
    );
  }
  if (props.variableType === 'str' || props.variableType === 'list-str') {
    return (
      <Input
        placeholder='Text to Append'
        value={props.value as string}
        onChange={(event) => props.onChange(event.target.value.toLowerCase())}
      />
    );
  }
  if (props.variableType === 'prof') {
    const value = props.value as ProficiencyValue;
    const data = props.options?.profExtended
      ? [
          { label: 'U', value: 'U' },
          { label: 'T', value: 'T' },
          { label: 'E', value: 'E' },
          { label: 'M', value: 'M' },
          { label: 'L', value: 'L' },
          { label: '+1', value: '1' },
          { label: '-1', value: '-1' },
        ]
      : [
          { label: 'U', value: 'U' },
          { label: 'T', value: 'T' },
          { label: 'E', value: 'E' },
          { label: 'M', value: 'M' },
          { label: 'L', value: 'L' },
        ];
    return (
      <OpsSegmented
        value={value.value}
        onChange={(val) => props.onChange({ value: val, attribute: value.attribute } as ProficiencyValue)}
        options={data}
      />
    );
  }
  return null;
}

export function SetValOp(props: {
  variable: string;
  value: VariableValue;
  onSelect: (variable: string) => void;
  onValueChange: (value: VariableValue) => void;
  onRemove: () => void;
  overrideTitle?: string;
}) {
  const [variableName, setVariableName] = useState(props.variable);
  const [variableData, setVariableData] = useState<Variable | undefined>(getVariable('CHARACTER', props.variable) ?? undefined);
  const [value, setValue] = useState<VariableValue>(props.value);

  useEffect(() => {
    setVariableName(props.variable);
    setVariableData(getVariable('CHARACTER', props.variable) ?? undefined);
    setValue(props.value);
  }, [props.value, props.variable]);

  return (
    <OperationWrapper onRemove={props.onRemove} title={props.overrideTitle ?? 'Override Value'}>
      <div className='flex flex-wrap gap-2'>
        <Phase1VariableSelect
          value={variableName}
          onChange={(next, variable) => {
            setVariableName(next);
            setVariableData(variable);
            props.onSelect(next);
            setValue('');
          }}
        />
        {variableData && (
          <SetValueInput
            variableType={variableData.type}
            value={value}
            onChange={(next) => {
              setValue(next);
              props.onValueChange(next);
            }}
          />
        )}
      </div>
    </OperationWrapper>
  );
}

export function SetValueInput(props: { variableType: VariableType; value: VariableValue; onChange: (value: VariableValue) => void }) {
  if (props.variableType === 'attr') {
    const value = props.value as AttributeValue;
    return (
      <div className='flex flex-wrap items-end gap-2'>
        <Input
          type='number'
          placeholder='Number'
          value={value.value}
          onChange={(event) => props.onChange({ value: parseInt(event.target.value || '0', 10), partial: value.partial })}
        />
        <OpsField label='Is Partial'>
          <OpsSegmented
            value={value.partial ? 'TRUE' : 'FALSE'}
            onChange={(val) => props.onChange({ value: value.value, partial: val === 'TRUE' })}
            options={[
              { label: 'True', value: 'TRUE' },
              { label: 'False', value: 'FALSE' },
            ]}
          />
        </OpsField>
      </div>
    );
  }
  if (props.variableType === 'num') {
    const value = isNumber(props.value) ? props.value : undefined;
    return (
      <Input
        type='number'
        placeholder='Number'
        value={value ?? ''}
        onChange={(event) => props.onChange(parseInt(event.target.value || '0', 10))}
      />
    );
  }
  if (props.variableType === 'bool') {
    const value = isBoolean(props.value) ? props.value : false;
    return (
      <OpsSegmented
        value={value ? 'TRUE' : 'FALSE'}
        onChange={(val) => props.onChange(val === 'TRUE')}
        options={[
          { label: 'True', value: 'TRUE' },
          { label: 'False', value: 'FALSE' },
        ]}
      />
    );
  }
  if (props.variableType === 'str') {
    const value = isString(props.value) ? props.value : '';
    return <Input placeholder='Text' value={value} onChange={(event) => props.onChange(event.target.value.toLowerCase())} />;
  }
  if (props.variableType === 'prof') {
    const value = (props.value || { value: 'U' }) as ProficiencyValue;
    if (!value.value) value.value = 'U';
    return (
      <div className='flex flex-wrap gap-2'>
        <OpsSegmented
          value={value.value}
          onChange={(val) => props.onChange({ value: val, attribute: value.attribute } as ProficiencyValue)}
          options={[
            { label: 'U', value: 'U' },
            { label: 'T', value: 'T' },
            { label: 'E', value: 'E' },
            { label: 'M', value: 'M' },
            { label: 'L', value: 'L' },
          ]}
        />
        <Phase1VariableSelect
          value={value.attribute ?? ''}
          variableType='attr'
          onChange={(_val, variable) => props.onChange({ value: value.value, attribute: variable?.name } as ProficiencyValue)}
        />
      </div>
    );
  }
  if (props.variableType === 'list-str') {
    const value = isString(props.value) ? props.value : '';
    return <Textarea placeholder='Array contents as JSON' value={value} onChange={(event) => props.onChange(event.target.value)} />;
  }
  return null;
}

export function CreateValOp(props: {
  variable: string;
  onNameChange: (variable: string) => void;
  variableType: VariableType;
  onTypeChange: (variable: VariableType) => void;
  value: VariableValue;
  onValueChange: (value: VariableValue) => void;
  onRemove: () => void;
}) {
  return (
    <OperationWrapper onRemove={props.onRemove} title='Create Value'>
      <div className='flex flex-wrap items-start gap-2'>
        <OpsSelect
          className='w-[110px]'
          placeholder='Value Type'
          value={props.variableType}
          onChange={(value) => props.onTypeChange(value as VariableType)}
          options={[
            { label: 'Number', value: 'num' },
            { label: 'Text', value: 'str' },
            { label: 'Boolean', value: 'bool' },
            { label: 'Proficiency', value: 'prof' },
            { label: 'Attribute', value: 'attr' },
            { label: 'List of Text', value: 'list-str' },
          ]}
        />
        <Input
          className='w-[190px] font-mono'
          placeholder='Value Name'
          value={props.variable}
          onChange={(event) => props.onNameChange(labelToVariable(event.target.value, false))}
        />
        <SetValueInput variableType={props.variableType} value={props.value} onChange={props.onValueChange} />
      </div>
    </OperationWrapper>
  );
}

export function BindValOp(props: {
  variable: string;
  value: { storeId: StoreID; variable: string };
  onSelect: (variable: string) => void;
  onValueChange: (value: { storeId: StoreID; variable: string }) => void;
  onRemove: () => void;
}) {
  const [variableName, setVariableName] = useState(props.variable);
  const [variableData, setVariableData] = useState<Variable | undefined>(getVariable('CHARACTER', props.variable) ?? undefined);
  const [value, setValue] = useState(props.value);

  useEffect(() => {
    setVariableName(props.variable);
    setVariableData(getVariable('CHARACTER', props.variable) ?? undefined);
    setValue(props.value);
  }, [props.value, props.variable]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Bind Value'>
      <div className='flex flex-wrap gap-2'>
        <Phase1VariableSelect
          value={variableName}
          onChange={(next, variable) => {
            setVariableName(next);
            setVariableData(variable);
            props.onSelect(next);
            setValue({ storeId: '', variable: '' });
          }}
        />
        {variableData && (
          <>
            <Input
              placeholder='→ Store ID'
              value={value.storeId}
              onChange={(event) => {
                const next = { ...value, storeId: event.target.value };
                setValue(next);
                props.onValueChange(next);
              }}
            />
            <Phase1VariableSelect
              value={value.variable}
              variableType={variableData.type}
              onChange={(val) => {
                const next = { ...value, variable: val };
                setValue(next);
                props.onValueChange(next);
              }}
            />
          </>
        )}
      </div>
    </OperationWrapper>
  );
}

export function AddBonusToValOp(props: {
  variable: string;
  bonusValue: number | string | undefined;
  bonusType: string | undefined;
  text: string;
  onValueChange: (data: { bonusValue?: number | string; bonusType?: string; text: string }) => void;
  onSelect: (variable: string) => void;
  onRemove: () => void;
}) {
  const [variableName, setVariableName] = useState(props.variable);
  const [variableData, setVariableData] = useState<Variable | undefined>(getVariable('CHARACTER', props.variable) ?? undefined);
  const [value, setValue] = useState(props.bonusValue);
  const [type, setType] = useState(props.bonusType);
  const [text, setText] = useState(props.text);

  useEffect(() => {
    setVariableName(props.variable);
    setVariableData(getVariable('CHARACTER', props.variable) ?? undefined);
    setValue(props.bonusValue);
    setType(props.bonusType);
    setText(props.text);
  }, [props.variable, props.bonusValue, props.bonusType, props.text]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Add Bonus to Value'>
      <div className='space-y-2'>
        <Phase1VariableSelect
          value={variableName}
          onChange={(next, variable) => {
            setVariableName(next);
            setVariableData(variable);
            props.onSelect(next);
            setValue(undefined);
            setType(undefined);
            setText('');
          }}
        />
        {variableData && (
          <div className='space-y-2'>
            <div className='flex gap-2'>
              <Input
                placeholder='Bonus Amount'
                value={value ?? ''}
                onChange={(event) => {
                  const raw = event.target.value;
                  const parsed = Number.parseInt(raw, 10);
                  const bonusValue = raw !== '' && !Number.isNaN(parsed) && String(parsed) === raw ? parsed : raw;
                  setValue(bonusValue);
                  props.onValueChange({ bonusValue, bonusType: type, text });
                }}
              />
              <Input
                placeholder='Bonus Type'
                value={type ?? ''}
                onChange={(event) => {
                  setType(event.target.value);
                  props.onValueChange({ bonusValue: value, bonusType: event.target.value, text });
                }}
              />
            </div>
            <Textarea
              placeholder='Conditional Text'
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                props.onValueChange({ bonusValue: value, bonusType: type, text: event.target.value });
              }}
            />
          </div>
        )}
      </div>
    </OperationWrapper>
  );
}
