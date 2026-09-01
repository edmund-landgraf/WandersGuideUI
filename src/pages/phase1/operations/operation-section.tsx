import { createDefaultOperation } from '@operations/operation-utils';
import { AbilityBlockType } from '@schemas/content';
import {
  Operation,
  OperationAddBonusToValue,
  OperationAdjValue,
  OperationBindValue,
  OperationConditional,
  OperationCreateValue,
  OperationDefineCastingSource,
  OperationGiveAbilityBlock,
  OperationGiveItem,
  OperationGiveLanguage,
  OperationGiveSpell,
  OperationGiveSpellSlot,
  OperationGiveTrait,
  OperationInjectSelectOption,
  OperationInjectText,
  OperationSelect,
  OperationSendNotification,
  OperationSetValue,
  OperationType,
} from '@schemas/operations';
import { ProficiencyType } from '@schemas/variables';
import { DISCORD_URL } from '@constants/urls';
import { addVariable, getVariable } from '@variables/variable-manager';
import { cloneDeep } from 'lodash-es';
import { Copy, Upload, X } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { ConditionalOperation } from './conditional-op';
import { GiveAbilityOp, GiveItemOp, GiveLanguageOp, GiveTraitOp } from './give-ops';
import { InjectTextOp, SendNotificationOp } from './misc-ops';
import { InjectSelectOp, SelectionOperation } from './selection-op';
import { AddOpMenu, HoverHelp, IconBtn, OpsConfirm, OpsNotice } from './ops-ui';
import { DefineCastingSourceOp, GiveSpellOp, GiveSpellSlotOp } from './spell-ops';
import {
  AddBonusToValOp,
  AdjValOp,
  BindValOp,
  CreateValOp,
  SetValOp,
} from './value-ops';

const ADD_OPTIONS: { value: string; label: string }[] = [
  { value: 'select', label: 'Selection' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'adjValue', label: 'Adjust Value' },
  { value: 'addBonusToValue', label: 'Add Bonus to Value' },
  { value: 'giveAbilityBlock:::feat', label: 'Give Feat' },
  { value: 'giveLanguage', label: 'Give Language' },
  { value: 'giveSpell', label: 'Give Spell' },
  { value: 'giveSpellSlot', label: 'Give Spell Slots' },
  { value: 'defineCastingSource', label: 'Define Casting Source' },
  { value: 'giveAbilityBlock:::sense', label: 'Give Sense' },
  { value: 'giveAbilityBlock:::physical-feature', label: 'Give Physical Feature' },
  { value: 'giveItem', label: 'Give Item' },
  { value: 'giveTrait', label: 'Give Trait' },
  { value: 'giveAbilityBlock:::heritage', label: 'Give Heritage' },
  { value: 'giveAbilityBlock:::mode', label: 'Give Mode' },
  { value: 'giveAbilityBlock:::class-feature', label: 'Give Other Class Feature' },
  { value: 'createValue', label: 'Create Value' },
  { value: 'setValue', label: 'Override Value' },
  { value: 'bindValue', label: 'Bind Value' },
  { value: 'injectSelectOption', label: 'Inject Select Option' },
  { value: 'injectText', label: 'Inject Text' },
  { value: 'sendNotification', label: 'Send Notification' },
];

export function HowToUseOperations() {
  return (
    <HoverHelp label='How to Use Operations'>
      <p>
        Operations are used to make changes to a character. They can give feats, spells, and more, as well as change stats,
        skills, and other values.
      </p>
      <p className='mt-2'>
        Use conditionals to apply operations only when certain conditions are met and selections whenever a choice needs to
        be made.
      </p>
      <p className='mt-2 text-xs italic text-p1-muted'>
        For more help, see{' '}
        <a className='pointer-events-auto text-p1-accent hover:underline' href={DISCORD_URL} target='_blank' rel='noreferrer'>
          our Discord server
        </a>
        .
      </p>
    </HoverHelp>
  );
}

export function OperationWrapper(props: { children: React.ReactNode; title: string; onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className='relative w-full max-w-[700px] rounded-2xl border border-p1-border bg-p1-inset py-2 pl-2 pr-10'>
      <div className='flex items-start gap-2'>
        <span className='shrink-0 rounded-full bg-p1-hover px-2.5 py-0.5 text-sm'>{props.title}</span>
        <div className='min-w-0 flex-1'>{props.children}</div>
      </div>
      <button
        type='button'
        title='Remove Operation'
        className='icon-button absolute right-2 top-2'
        onClick={() => setConfirm(true)}
      >
        <X size={14} />
      </button>
      {confirm && (
        <OpsConfirm
          title='Remove Operation'
          message='Are you sure you want to remove this operation?'
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            props.onRemove();
          }}
        />
      )}
    </div>
  );
}

export function OperationSection(props: {
  title: ReactNode;
  blacklist?: string[];
  operations?: Operation[];
  onChange: (operations: Operation[]) => void;
  allowCopyPaste?: boolean;
}) {
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    for (const op of props.operations ?? []) {
      if (op.type === 'createValue') {
        addVariable('CHARACTER', op.data.type, op.data.variable, op.data.value as ProficiencyType);
      } else if (op.type === 'conditional') {
        for (const check of op.data.conditions ?? []) {
          if (check.operator && check.value && !getVariable('CHARACTER', check.name)) {
            addVariable('CHARACTER', 'prof', check.name);
          }
        }
      }
    }
  }, [props.operations]);

  const copyOps = () => {
    navigator.clipboard.writeText(JSON.stringify(props.operations ?? [])).then(() => {
      setNotice({ title: 'Copied Operations', message: `Copied ${props.operations?.length ?? 0} operations to clipboard.` });
    });
  };

  const pasteOps = async () => {
    try {
      const clipboardOperations = JSON.parse(await navigator.clipboard.readText()) as Operation[];
      props.onChange([
        ...(props.operations ?? []),
        ...clipboardOperations.map((op) => ({ ...op, id: crypto.randomUUID() })),
      ]);
      setNotice({ title: 'Pasted Operations', message: `Pasted ${clipboardOperations.length} operations from clipboard.` });
    } catch {
      setNotice({ title: 'Error Pasting Operations', message: 'Failed to paste operations from clipboard.' });
    }
  };

  const add = (value: string) => {
    let abilBlockType: string | null = null;
    let type = value;
    if (value.includes('giveAbilityBlock:::')) {
      abilBlockType = value.split(':::')[1];
      type = 'giveAbilityBlock';
    }
    const newOp = createDefaultOperation(type as OperationType);
    if (!newOp) return;
    if (abilBlockType) (newOp as OperationGiveAbilityBlock).data.type = abilBlockType as AbilityBlockType;
    props.onChange([...(props.operations ?? []), newOp]);
  };

  return (
    <div className='space-y-2.5'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>{props.title}</div>
        <div className='flex items-center gap-2'>
          {props.allowCopyPaste !== false && (
            <>
              <IconBtn label='Copy Operations' disabled={(props.operations?.length ?? 0) === 0} onClick={copyOps}>
                <Copy size={16} />
              </IconBtn>
              <IconBtn label='Paste Operations' onClick={() => void pasteOps()}>
                <Upload size={16} />
              </IconBtn>
            </>
          )}
          <AddOpMenu
            options={ADD_OPTIONS.filter((option) => !(props.blacklist ?? []).includes(option.value))}
            onPick={add}
          />
        </div>
      </div>
      <div className='space-y-2.5'>
        {(props.operations ?? []).map((op) => (
          <div key={op.id} className='border border-p1-border'>
            <OperationDisplay
              operation={op}
              onChange={(option) => {
                const next = cloneDeep(op);
                next.data = option.data;
                props.onChange((props.operations ?? []).map((item) => (item.id === op.id ? next : item)));
              }}
              onRemove={(id) => props.onChange((props.operations ?? []).filter((item) => item.id !== id))}
            />
          </div>
        ))}
        {(props.operations ?? []).length === 0 && (
          <p className='text-center text-sm italic text-p1-faint'>No operations</p>
        )}
      </div>
      {notice && <OpsNotice title={notice.title} message={notice.message} onClose={() => setNotice(null)} />}
    </div>
  );
}

export function OperationDisplay(props: {
  operation: Operation;
  onChange: (op: Operation) => void;
  onRemove: (id: string) => void;
}) {
  const remove = () => props.onRemove(props.operation.id);
  switch (props.operation.type) {
    case 'giveAbilityBlock': {
      const op = props.operation as OperationGiveAbilityBlock;
      const titles: Record<string, string> = {
        feat: 'Give Feat',
        action: 'Give Action',
        'class-feature': 'Give Class Feature',
        sense: 'Give Sense',
        mode: 'Give Mode',
        'physical-feature': 'Give Physical Feature',
        heritage: 'Give Heritage',
      };
      return (
        <GiveAbilityOp
          title={titles[op.data.type] ?? 'Give Ability'}
          type={op.data.type}
          selectedId={op.data.abilityBlockId}
          onSelect={(option) => {
            op.data.abilityBlockId = option.id;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'giveSpell': {
      const op = props.operation as OperationGiveSpell;
      return (
        <GiveSpellOp
          data={op.data}
          onSelect={(data) => {
            op.data = cloneDeep(data);
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'giveSpellSlot': {
      const op = props.operation as OperationGiveSpellSlot;
      return (
        <GiveSpellSlotOp
          castingSource={op.data.castingSource}
          slots={op.data.slots?.map((s) => ({ ...s, amt: s.amt ?? 0 }))}
          onSelect={(source, slots) => {
            op.data.castingSource = source;
            op.data.slots = slots;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'defineCastingSource': {
      const op = props.operation as OperationDefineCastingSource;
      return (
        <DefineCastingSourceOp
          value={op.data.value as string}
          onSelect={(value) => {
            op.data.value = value;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'injectSelectOption': {
      const op = props.operation as OperationInjectSelectOption;
      return (
        <InjectSelectOp
          value={op.data.value as string}
          onSelect={(value) => {
            op.data.value = value;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'injectText': {
      const op = props.operation as OperationInjectText;
      return (
        <InjectTextOp
          type={op.data.type}
          id={op.data.id}
          text={op.data.text}
          onChange={(type, id, text) => {
            op.data.type = type;
            op.data.id = id;
            op.data.text = text;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'sendNotification': {
      const op = props.operation as OperationSendNotification;
      return (
        <SendNotificationOp
          title={op.data.title}
          message={op.data.message}
          color={op.data.color}
          onChange={(title, message, color) => {
            op.data.title = title;
            op.data.message = message;
            op.data.color = color;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'giveLanguage': {
      const op = props.operation as OperationGiveLanguage;
      return (
        <GiveLanguageOp
          selectedId={op.data.languageId}
          onSelect={(option) => {
            op.data.languageId = option.id;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'giveItem': {
      const op = props.operation as OperationGiveItem;
      return (
        <GiveItemOp
          selectedId={op.data.itemId}
          onSelect={(option) => {
            op.data.itemId = option.id;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'giveTrait': {
      const op = props.operation as OperationGiveTrait;
      return (
        <GiveTraitOp
          selectedId={op.data.traitId}
          onSelect={(option) => {
            op.data.traitId = option.id;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'conditional': {
      const op = props.operation as OperationConditional;
      return (
        <ConditionalOperation
          conditions={op.data.conditions}
          trueOperations={op.data.trueOperations}
          falseOperations={op.data.falseOperations}
          onChange={(conditions, trueOperations, falseOperations) => {
            op.data.conditions = conditions;
            op.data.trueOperations = trueOperations;
            op.data.falseOperations = falseOperations;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'select': {
      const op = props.operation as OperationSelect;
      return (
        <SelectionOperation
          data={op.data}
          onChange={(data) => {
            op.data = cloneDeep(data);
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'adjValue': {
      const op = props.operation as OperationAdjValue;
      return (
        <AdjValOp
          variable={op.data.variable}
          value={op.data.value}
          onSelect={(variable) => {
            op.data.variable = variable;
            props.onChange(cloneDeep(op));
          }}
          onValueChange={(value) => {
            op.data.value = value;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'setValue': {
      const op = props.operation as OperationSetValue;
      return (
        <SetValOp
          variable={op.data.variable}
          value={op.data.value}
          onSelect={(variable) => {
            op.data.variable = variable;
            props.onChange(cloneDeep(op));
          }}
          onValueChange={(value) => {
            op.data.value = value;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'bindValue': {
      const op = props.operation as OperationBindValue;
      return (
        <BindValOp
          variable={op.data.variable}
          value={op.data.value}
          onSelect={(variable) => {
            op.data.variable = variable;
            props.onChange(cloneDeep(op));
          }}
          onValueChange={(value) => {
            op.data.value = value;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'createValue': {
      const op = props.operation as OperationCreateValue;
      return (
        <CreateValOp
          variable={op.data.variable}
          onNameChange={(variable) => {
            op.data.variable = variable;
            props.onChange(cloneDeep(op));
          }}
          variableType={op.data.type}
          onTypeChange={(variableType) => {
            op.data.type = variableType;
            props.onChange(cloneDeep(op));
          }}
          value={op.data.value as ProficiencyType}
          onValueChange={(value) => {
            op.data.value = value;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    case 'addBonusToValue': {
      const op = props.operation as OperationAddBonusToValue;
      return (
        <AddBonusToValOp
          variable={op.data.variable}
          bonusValue={op.data.value ?? undefined}
          bonusType={op.data.type}
          text={op.data.text}
          onSelect={(variable) => {
            op.data.variable = variable;
            props.onChange(cloneDeep(op));
          }}
          onValueChange={(data) => {
            op.data.value = data.bonusValue;
            op.data.type = data.bonusType;
            op.data.text = data.text;
            props.onChange(cloneDeep(op));
          }}
          onRemove={remove}
        />
      );
    }
    default:
      return null;
  }
}
