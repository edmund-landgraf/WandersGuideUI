import { fetchContentAll, fetchContentById, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import type { AbilityBlock, AbilityBlockType, ContentType, Item, Language, Spell, Trait } from '@schemas/content';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Phase1PickerModal } from '../phase1-picker-modal';

type Pickable = { id: number; name: string };

export function Phase1ContentPickButton<T extends Pickable>(props: {
  type: ContentType;
  selectedId: number;
  onSelect: (option: T) => void;
  abilityBlockType?: AbilityBlockType;
  overrideLabel?: string;
  filterFn?: (item: T) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useQuery({
    queryKey: ['phase1-op-selected', props.type, props.selectedId],
    queryFn: () => fetchContentById<T>(props.type, props.selectedId),
    enabled: props.selectedId > 0,
  });
  const catalog = useQuery({
    queryKey: ['phase1-op-catalog', props.type, getDefaultSourcesKey('PAGE'), props.abilityBlockType],
    queryFn: async () => {
      const all = await fetchContentAll<T>(props.type, getDefaultSources('PAGE'));
      return all.filter((item) => {
        if (props.abilityBlockType && (item as T & { type?: AbilityBlockType }).type !== props.abilityBlockType) return false;
        if (props.filterFn && !props.filterFn(item)) return false;
        return true;
      });
    },
    enabled: open,
  });

  const label = selected.data?.name ?? props.overrideLabel ?? `Select ${props.type}`;

  return (
    <>
      <button type='button' className='toolbar-button max-w-xs truncate text-left' onClick={() => setOpen(true)}>
        {props.selectedId > 0 ? label : props.overrideLabel ?? `Select ${props.type}`}
      </button>
      {open && (
        <Phase1PickerModal<T>
          title={props.overrideLabel ?? `Select ${props.type}`}
          titleId={`op-pick-${props.type}`}
          overlayClass='z-[160]'
          items={[...(catalog.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}
          getName={(item) => item.name}
          getKey={(item) => String(item.id)}
          loading={catalog.isLoading}
          error={catalog.isError ? 'Could not load content.' : null}
          empty='No matching content.'
          onClose={() => setOpen(false)}
          renderItem={(item) => (
            <button
              type='button'
              className='block w-full border-b border-p1-border px-3 py-2 text-left text-sm hover:bg-p1-hover'
              onClick={() => {
                props.onSelect(item);
                setOpen(false);
              }}
            >
              {item.name}
            </button>
          )}
        />
      )}
    </>
  );
}

export function isGiveableTrait(trait: Trait) {
  return !!(
    trait.meta_data?.creature_trait ||
    trait.meta_data?.ancestry_trait ||
    trait.meta_data?.class_trait ||
    trait.meta_data?.archetype_trait ||
    trait.meta_data?.versatile_heritage_trait ||
    trait.meta_data?.companion_type_trait
  );
}

export type { AbilityBlock, Item, Language, Spell, Trait };
