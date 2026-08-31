import { Title } from '@mantine/core';
import { openContextModal } from '@mantine/modals';
import type { FiltersParams } from '@modals/AdvancedSearchModal';
import type { AbilityBlockType, ContentType } from '@schemas/content';
import type { ExtendedProficiencyType } from '@schemas/variables';
import { toLabel } from '@utils/strings';
import type { ReactNode } from 'react';

export function selectContent<T = Record<string, any>>(
  type: ContentType,
  onClick?: (option: T) => void,
  options?: {
    overrideOptions?: Record<string, any>[];
    overrideLabel?: string;
    abilityBlockType?: AbilityBlockType;
    skillAdjustment?: ExtendedProficiencyType;
    selectedId?: number;
    filterFn?: (option: Record<string, any>) => boolean;
    advancedPresetFilters?: Partial<FiltersParams>;
    showButton?: boolean;
    includeOptions?: boolean;
    zIndex?: number;
    description?: ReactNode;
  }
) {
  let label = `Select ${toLabel(options?.abilityBlockType || type)}`;
  if (options?.overrideLabel) label = options.overrideLabel;

  openContextModal({
    modal: 'selectContent',
    title: <Title order={3}>{label}</Title>,
    zIndex: options?.zIndex ?? 499,
    innerProps: {
      type,
      onClick: onClick ? (option: any) => onClick(option as T) : undefined,
      options,
    },
  });
}
