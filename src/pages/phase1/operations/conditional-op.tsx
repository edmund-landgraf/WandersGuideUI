import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import { ConditionCheckData, ConditionOperator, Operation } from '@schemas/operations';
import { Variable, VariableType } from '@schemas/variables';
import { cloneDeep } from 'lodash-es';
import { ChevronRight, MinusCircle, PlusCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OperationSection, OperationWrapper } from './operation-section';
import { OpsSegmented, OpsSelect } from './ops-ui';
import { Phase1VariableSelect } from './variable-select';

export function ConditionalOperation(props: {
  conditions?: ConditionCheckData[];
  trueOperations?: Operation[];
  falseOperations?: Operation[];
  onChange: (conditions: ConditionCheckData[], trueOperations: Operation[], falseOperations: Operation[]) => void;
  onRemove: () => void;
}) {
  const getDefaultCondition = (): ConditionCheckData => ({
    id: crypto.randomUUID(),
    name: '',
    data: undefined,
    operator: '',
    value: '',
  });

  const checks = props.conditions && props.conditions.length > 0 ? props.conditions : [getDefaultCondition()];

  const routeChange = (data: {
    checks?: ConditionCheckData[];
    trueOperations?: Operation[];
    falseOperations?: Operation[];
  }) => {
    props.onChange(data.checks ?? [], data.trueOperations ?? [], data.falseOperations ?? []);
  };

  return (
    <OperationWrapper onRemove={props.onRemove} title='Conditional'>
      <div className='w-full space-y-3'>
        {checks.map((check, index) => (
          <ConditionalCheck
            key={check.id}
            id={check.id}
            defaultName={check.name}
            defaultData={check.data}
            defaultType={check.type}
            defaultOperator={check.operator}
            defaultValue={String(check.value ?? '')}
            onChange={(data) => {
              const next = cloneDeep(checks);
              next[index] = data;
              routeChange({
                checks: next,
                trueOperations: props.trueOperations,
                falseOperations: props.falseOperations,
              });
            }}
            includeAnd={index !== 0}
            includeAdd={index === checks.length - 1}
            onAdd={() =>
              routeChange({
                checks: [...checks, getDefaultCondition()],
                trueOperations: props.trueOperations,
                falseOperations: props.falseOperations,
              })
            }
            onRemove={(id) =>
              routeChange({
                checks: checks.filter((item) => item.id !== id),
                trueOperations: props.trueOperations,
                falseOperations: props.falseOperations,
              })
            }
          />
        ))}
        <div className='border-t border-p1-border pt-3 space-y-4'>
          <OperationSection
            title={
              <span className='inline-flex items-center gap-2 text-sm'>
                <ChevronRight size={14} />
                If
                <span className='rounded-full bg-p1-hover px-2 py-0.5 text-xs'>True</span>
              </span>
            }
            operations={props.trueOperations ?? []}
            onChange={(operations) =>
              routeChange({
                checks: props.conditions,
                trueOperations: operations,
                falseOperations: props.falseOperations,
              })
            }
            blacklist={['conditional', 'createValue']}
          />
          <OperationSection
            title={
              <span className='inline-flex items-center gap-2 text-sm'>
                <ChevronRight size={14} />
                If
                <span className='rounded-full bg-p1-hover px-2 py-0.5 text-xs'>False</span>
              </span>
            }
            operations={props.falseOperations ?? []}
            onChange={(operations) =>
              routeChange({
                checks: props.conditions,
                trueOperations: props.trueOperations,
                falseOperations: operations,
              })
            }
            blacklist={['conditional', 'createValue']}
          />
        </div>
      </div>
    </OperationWrapper>
  );
}

function ConditionalCheck(props: {
  id: string;
  defaultName: string;
  defaultData?: Variable;
  defaultType?: VariableType;
  defaultOperator: ConditionOperator;
  defaultValue: string;
  onChange: (data: ConditionCheckData) => void;
  includeAnd?: boolean;
  includeAdd?: boolean;
  onAdd?: () => void;
  onRemove?: (id: string) => void;
}) {
  const [variableName, setVariableName] = useState(props.defaultName);
  const [variableData, setVariableData] = useState<Variable | undefined>(props.defaultData);
  const [variableType, setVariableType] = useState<VariableType | undefined>(props.defaultType);
  const [operator, setOperator] = useState(props.defaultOperator);
  const [value, setValue] = useState(props.defaultValue);

  useEffect(() => {
    props.onChange({
      id: props.id,
      name: variableName,
      data: variableData,
      type: variableType,
      operator,
      value,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variableName, variableData, variableType, operator, value]);

  const varType = variableData?.type || variableType;
  let operatorOptions: { value: ConditionOperator; label: string }[] = [];
  if (varType === 'attr' || varType === 'num' || varType === 'prof') {
    operatorOptions = [
      { value: 'LESS_THAN', label: '<' },
      { value: 'LESS_THAN_OR_EQUALS', label: '≤' },
      { value: 'GREATER_THAN', label: '>' },
      { value: 'GREATER_THAN_OR_EQUALS', label: '≥' },
      { value: 'EQUALS', label: '=' },
      { value: 'NOT_EQUALS', label: '≠' },
    ];
  }
  if (varType === 'bool') {
    operatorOptions = [
      { value: 'EQUALS', label: '=' },
      { value: 'NOT_EQUALS', label: '≠' },
    ];
  }
  if (varType === 'str' || varType === 'list-str') {
    operatorOptions = [
      { value: 'INCLUDES', label: 'includes' },
      { value: 'NOT_INCLUDES', label: 'not includes' },
      { value: 'EQUALS', label: '=' },
      { value: 'NOT_EQUALS', label: '≠' },
    ];
  }
  if (!varType) {
    operatorOptions = [
      { value: 'INCLUDES', label: 'includes' },
      { value: 'NOT_INCLUDES', label: 'not includes' },
      { value: 'LESS_THAN', label: '<' },
      { value: 'LESS_THAN_OR_EQUALS', label: '≤' },
      { value: 'GREATER_THAN', label: '>' },
      { value: 'GREATER_THAN_OR_EQUALS', label: '≥' },
      { value: 'EQUALS', label: '=' },
      { value: 'NOT_EQUALS', label: '≠' },
    ];
  }

  return (
    <div className='relative flex flex-wrap items-start gap-2 pl-6'>
      {props.includeAnd && <span className='absolute left-0 top-1.5 text-sm italic text-p1-muted'>&&</span>}
      {props.includeAdd && (
        <div className='absolute -right-7 top-0 flex flex-col'>
          {props.includeAnd && (
            <button type='button' title='Remove Condition' className='icon-button' onClick={() => props.onRemove?.(props.id)}>
              <MinusCircle size={14} />
            </button>
          )}
          <button type='button' title='Add Condition' className='icon-button' onClick={props.onAdd}>
            <PlusCircle size={14} />
          </button>
        </div>
      )}
      <Phase1VariableSelect
        value={variableName}
        onChange={(next, variable) => {
          setVariableName(next);
          setVariableData(variable);
          setVariableType(variable?.type);
          setOperator('');
          setValue('');
        }}
      />
      {!variableData && (
        <OpsSelect
          className='w-[100px]'
          placeholder='Value Type'
          value={varType}
          onChange={(next) => setVariableType(next as VariableType)}
          options={[
            { value: 'attr', label: 'Attr' },
            { value: 'num', label: 'Number' },
            { value: 'bool', label: 'Bool' },
            { value: 'str', label: 'Text' },
            { value: 'list-str', label: 'Text Array' },
            { value: 'prof', label: 'Prof' },
          ]}
        />
      )}
      {variableName && (
        <OpsSelect
          className='w-[100px]'
          placeholder='Operator'
          value={operator}
          onChange={(next) => setOperator(next as ConditionOperator)}
          options={operatorOptions}
        />
      )}
      {variableName && operator && varType && (
        <ConditionalValueSelect variableType={varType} operationType={operator} value={value} onChange={setValue} />
      )}
    </div>
  );
}

function ConditionalValueSelect(props: {
  variableType: VariableType;
  operationType: string;
  value: any;
  onChange: (value: any) => void;
}) {
  if (props.variableType === 'attr' || props.variableType === 'num') {
    return (
      <Input
        type='number'
        placeholder='Number'
        value={props.value}
        onChange={(event) => props.onChange(parseInt(event.target.value || '0', 10))}
      />
    );
  }
  if (props.variableType === 'bool') {
    return (
      <OpsSegmented
        value={props.value === 'TRUE' ? 'TRUE' : props.value === 'FALSE' ? 'FALSE' : undefined}
        onChange={props.onChange}
        options={[
          { label: 'True', value: 'TRUE' },
          { label: 'False', value: 'FALSE' },
        ]}
      />
    );
  }
  if (
    props.variableType === 'str' ||
    (props.variableType === 'list-str' && (props.operationType === 'INCLUDES' || props.operationType === 'NOT_INCLUDES'))
  ) {
    return (
      <Input
        placeholder='Text (case insensitive)'
        value={props.value}
        onChange={(event) => props.onChange(event.target.value.toLowerCase())}
      />
    );
  }
  if (props.variableType === 'prof') {
    return (
      <OpsSegmented
        value={props.value || undefined}
        onChange={props.onChange}
        options={[
          { label: 'U', value: 'U' },
          { label: 'T', value: 'T' },
          { label: 'E', value: 'E' },
          { label: 'M', value: 'M' },
          { label: 'L', value: 'L' },
        ]}
      />
    );
  }
  if (props.variableType === 'list-str' && props.operationType === 'EQUALS') {
    return (
      <Textarea placeholder='Array contents as JSON' value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    );
  }
  return null;
}
