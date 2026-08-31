import { drawerState } from '@atoms/navAtoms';
import { selectContent } from '@common/select/open-select-content';
import { fetchContentById } from '@content/content-store';
import { Button } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import type { FiltersParams } from '@modals/AdvancedSearchModal';
import type { DrawerType } from '@schemas/index';
import type { AbilityBlockType, ContentType } from '@schemas/content';
import type { ExtendedProficiencyType } from '@schemas/variables';
import { IconTransform, IconX } from '@tabler/icons-react';
import { toLabel } from '@utils/strings';
import { useAtom } from 'jotai';
import { isEqual, isNumber } from 'lodash-es';
import { ReactNode, useEffect, useState } from 'react';

export function SelectContentButton<T extends Record<string, any> = Record<string, any>>(props: {
  type: ContentType;
  onClick: (option: T) => void;
  onClear?: () => void;
  selectedId?: number;
  options?: {
    overrideOptions?: T[];
    overrideLabel?: string;
    abilityBlockType?: AbilityBlockType;
    skillAdjustment?: ExtendedProficiencyType;
    filterFn?: (option: T) => boolean;
    advancedPresetFilters?: Partial<FiltersParams>;
    showButton?: boolean;
    includeOptions?: boolean;
    description?: ReactNode;
  };
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [selected, setSelected] = useState<T | undefined>();
  const [debouncedSelected] = useDebouncedValue(selected, 3000);

  useEffect(() => {
    (async () => {
      if (props.selectedId === selected?.id) {
        return;
      }
      if (!isEqual(debouncedSelected, selected)) {
        return;
      }

      if (!props.selectedId) {
        setSelected(undefined);
        return;
      }

      if (isNumber(props.selectedId)) {
        const content = await fetchContentById<T>(props.type, props.selectedId);
        if (content) {
          setSelected(content);
          return;
        }
      }

      if (props.options?.overrideOptions) {
        const option = props.options.overrideOptions.find(
          // @ts-ignore
          (option) => option.id === props.selectedId
        );
        if (option) {
          setSelected(option);
          return;
        }
      }
    })();
  }, [debouncedSelected, props.selectedId, props.type, props.options?.overrideOptions]);

  const typeName = toLabel(props.options?.abilityBlockType || props.type);

  const label = selected ? selected.name : (props.options?.overrideLabel ?? `Select ${typeName}`);

  const onSelect = () => {
    selectContent<T>(
      props.type,
      (option) => {
        setSelected(option);
        props.onClick(option);
      },
      {
        overrideOptions: props.options?.overrideOptions as Record<string, any>[],
        overrideLabel: props.options?.overrideLabel,
        abilityBlockType: props.options?.abilityBlockType,
        skillAdjustment: props.options?.skillAdjustment,
        // @ts-ignore
        selectedId: selected?.id,
        // @ts-ignore
        filterFn: props.options?.filterFn,
        showButton: props.options?.showButton,
        includeOptions: props.options?.includeOptions,
        advancedPresetFilters: props.options?.advancedPresetFilters,
        description: props.options?.description,
      }
    );
  };

  const drawerType: DrawerType = props.options?.abilityBlockType ?? props.type;
  const customSelect =
    props.options?.overrideOptions &&
    props.options.overrideOptions.length > 0 &&
    props.options.overrideOptions[0]._custom_select;
  const hideSwitch = drawerType === 'ability-block' && !customSelect;
  const showLongName = drawerType === 'ability-block';

  const onView = () => {
    if (customSelect) {
      openDrawer({
        type: 'generic',
        data: selected,
        extra: { addToHistory: true },
      });
    } else {
      openDrawer({
        type: drawerType,
        data: { id: selected?.id },
        extra: { addToHistory: true },
      });
    }
  };

  return (
    <Button.Group className='selection-choice-base'>
      <Button
        className={selected ? 'selection-choice-selected' : 'selection-choice-unselected'}
        variant={selected ? 'light' : 'filled'}
        size='compact-sm'
        radius='xl'
        w={showLongName ? undefined : 160}
        miw={showLongName ? 140 : undefined}
        onClick={() => {
          if (selected && !hideSwitch) {
            onView();
          } else {
            onSelect();
          }
        }}
      >
        {label}
      </Button>
      {selected && (
        <>
          {!hideSwitch && (
            <Button
              variant='light'
              size='compact-sm'
              radius='xl'
              onClick={() => {
                onSelect();
              }}
              style={{
                borderLeft: '1px solid',
              }}
            >
              <IconTransform size='0.9rem' />
            </Button>
          )}
          <Button
            variant='light'
            size='compact-sm'
            radius='xl'
            onClick={() => {
              setSelected(undefined);
              props.onClear && props.onClear();
            }}
            style={{
              borderLeft: '1px solid',
            }}
          >
            <IconX size='1rem' />
          </Button>
        </>
      )}
    </Button.Group>
  );
}
