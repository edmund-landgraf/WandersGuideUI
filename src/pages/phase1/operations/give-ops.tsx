import type { AbilityBlock, AbilityBlockType, Item, Language, Trait } from '@schemas/content';
import { Phase1ContentPickButton, isGiveableTrait } from './content-picker';
import { OperationWrapper } from './operation-section';

export function GiveAbilityOp(props: {
  title: string;
  type: AbilityBlockType;
  selectedId: number;
  onSelect: (option: AbilityBlock) => void;
  onRemove: () => void;
}) {
  return (
    <OperationWrapper onRemove={props.onRemove} title={props.title}>
      <Phase1ContentPickButton<AbilityBlock>
        type='ability-block'
        abilityBlockType={props.type}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
      />
    </OperationWrapper>
  );
}

export function GiveLanguageOp(props: {
  selectedId: number;
  onSelect: (option: Language) => void;
  onRemove: () => void;
}) {
  return (
    <OperationWrapper onRemove={props.onRemove} title='Give Language'>
      <Phase1ContentPickButton<Language> type='language' selectedId={props.selectedId} onSelect={props.onSelect} />
    </OperationWrapper>
  );
}

export function GiveItemOp(props: { selectedId: number; onSelect: (option: Item) => void; onRemove: () => void }) {
  return (
    <OperationWrapper onRemove={props.onRemove} title='Give Item'>
      <Phase1ContentPickButton<Item> type='item' selectedId={props.selectedId} onSelect={props.onSelect} />
    </OperationWrapper>
  );
}

export function GiveTraitOp(props: { selectedId: number; onSelect: (option: Trait) => void; onRemove: () => void }) {
  return (
    <OperationWrapper onRemove={props.onRemove} title='Give Trait'>
      <Phase1ContentPickButton<Trait>
        type='trait'
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        overrideLabel='Select a Trait'
        filterFn={isGiveableTrait}
      />
    </OperationWrapper>
  );
}
