import { fetchContent, getDefaultSources } from '@content/content-store';
import { COMMON_CORE_ID } from '@constants/data';
import type { Character, Class, ClassArchetype, ContentPackage } from '@schemas/content';
import type { SetterOrUpdater } from '@utils/type-fixing';
import { uniq } from 'lodash-es';
import { useMemo, useState } from 'react';
import { useContentLinks } from './phase1-content-links';
import { Phase1PickerModal } from './phase1-picker-modal';
import { heritageSection, resultPrefix, saveSelectionChange, setAncestry, setBackground, setClass, setClass2 } from './phase1-builder-ops';
import { Phase1OperationResults } from './phase1-builder-select';
import type { OperationCharacterResultPackage } from '@schemas/content';

type Picker = 'ancestry' | 'background' | 'class' | 'class2' | 'archetype' | 'archetype2' | null;

export function Phase1BuilderPicks({
  character,
  setCharacter,
  flushSave,
  content,
  results,
  showIdentity = true,
  showPicks = true,
}: {
  character: Character;
  setCharacter: SetterOrUpdater<Character | null>;
  flushSave?: (row?: Character | null) => void;
  content: ContentPackage;
  results: OperationCharacterResultPackage | null;
  showIdentity?: boolean;
  showPicks?: boolean;
}) {
  const { open } = useContentLinks();
  const [picker, setPicker] = useState<Picker>(null);
  const [archetypes, setArchetypes] = useState<ClassArchetype[]>([]);
  const dual = Boolean(character.variants?.dual_class);
  const heritage = heritageSection(results);
  const allowedSources = useMemo(
    () => new Set(uniq([COMMON_CORE_ID, ...(character.content_sources?.enabled ?? [])])),
    [character.content_sources?.enabled]
  );
  const ancestries = useMemo(
    () => content.ancestries.filter((item) => allowedSources.has(item.content_source_id)),
    [content.ancestries, allowedSources]
  );
  const backgrounds = useMemo(
    () => content.backgrounds.filter((item) => allowedSources.has(item.content_source_id)),
    [content.backgrounds, allowedSources]
  );
  const classes = useMemo(
    () => content.classes.filter((item) => allowedSources.has(item.content_source_id)),
    [content.classes, allowedSources]
  );

  function sourceName(id: number) {
    return content.sources?.find((source) => source.id === id)?.name;
  }

  async function afterClassPick(option: Class, slot: '1' | '2') {
    if (slot === '1') setClass(setCharacter, option, dual);
    else setClass2(setCharacter, option);
    const options = await fetchContent<ClassArchetype>('class-archetype', {
      class_id: option.id,
      content_sources: getDefaultSources('PAGE'),
    });
    if (options.length > 0) {
      setArchetypes(options);
      setPicker(slot === '1' ? 'archetype' : 'archetype2');
    } else {
      setPicker(null);
    }
  }

  return (
    <div className='space-y-3'>
      {showIdentity && (
        <>
      <label className='block text-xs text-p1-muted'>
        Name
        <input
          className='settings-input mt-1 w-full'
          value={character.name}
          onChange={(event) =>
            setCharacter((prev) => (prev ? { ...prev, name: event.target.value } : prev))
          }
          onBlur={(event) => {
            const name = event.currentTarget.value;
            const next = { ...character, name };
            setCharacter((prev) => (prev ? { ...prev, name } : prev));
            flushSave?.(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <label className='block text-xs text-p1-muted'>
        Level
        <input
          className='settings-input mt-1 w-full'
          type='number'
          min={1}
          max={20}
          value={character.level}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (!Number.isFinite(parsed)) return;
            setCharacter((prev) =>
              prev
                ? {
                    ...prev,
                    level: Math.min(20, Math.max(1, parsed)),
                    meta_data: { ...prev.meta_data, reset_hp: true },
                  }
                : prev
            );
          }}
          onBlur={(event) => {
            const level = Math.min(20, Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1));
            const next = { ...character, level, meta_data: { ...character.meta_data, reset_hp: true } };
            setCharacter((prev) => (prev ? { ...prev, level, meta_data: { ...prev.meta_data, reset_hp: true } } : prev));
            flushSave?.(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
      </label>
        </>
      )}
      {showPicks && (
        <>
      <PickRow
        label='Ancestry'
        value={character.details?.ancestry?.name}
        onChoose={() => setPicker('ancestry')}
        onPreview={character.details?.ancestry ? () => open(`link_ancestry_${character.details!.ancestry!.id}`) : undefined}
      />
      {heritage && (
        <div>
          <div className='mb-1 text-xs text-p1-muted'>Heritage</div>
          <Phase1OperationResults
            results={heritage.baseResults}
            onChange={(path, value) =>
              saveSelectionChange(setCharacter, `${resultPrefix('ancestrySectionResults', heritage.baseSource.id)}_${path}`, value)
            }
          />
        </div>
      )}
      <PickRow
        label='Background'
        value={character.details?.background?.name}
        onChoose={() => setPicker('background')}
        onPreview={character.details?.background ? () => open(`link_background_${character.details!.background!.id}`) : undefined}
      />
      <PickRow
        label='Class'
        value={character.details?.class?.name}
        extra={character.details?.class_archetype?.name}
        onChoose={() => setPicker('class')}
        onPreview={character.details?.class ? () => open(`link_class_${character.details!.class!.id}`) : undefined}
      />
      {dual && (
        <PickRow
          label='Class 2'
          value={character.details?.class_2?.name}
          extra={character.details?.class_archetype_2?.name}
          onChoose={() => setPicker('class2')}
          onPreview={character.details?.class_2 ? () => open(`link_class_${character.details!.class_2!.id}`) : undefined}
        />
      )}

      {picker === 'ancestry' && (
        <Phase1PickerModal
          title='Select ancestry'
          titleId='builder-ancestry'
          items={ancestries}
          getName={(item) => item.name}
          getKey={(item) => String(item.id)}
          empty='No ancestries loaded.'
          onClose={() => setPicker(null)}
          renderItem={(item) => (
            <ContentPickRow
              name={item.name}
              detail={sourceName(item.content_source_id)}
              selected={character.details?.ancestry?.id === item.id}
              onPick={() => {
                setAncestry(setCharacter, item);
                setPicker(null);
              }}
              onPreview={() => open(`link_ancestry_${item.id}`)}
            />
          )}
        />
      )}
      {picker === 'background' && (
        <Phase1PickerModal
          title='Select background'
          titleId='builder-background'
          items={backgrounds}
          getName={(item) => item.name}
          getKey={(item) => String(item.id)}
          empty='No backgrounds loaded.'
          onClose={() => setPicker(null)}
          renderItem={(item) => (
            <ContentPickRow
              name={item.name}
              detail={sourceName(item.content_source_id)}
              selected={character.details?.background?.id === item.id}
              onPick={() => {
                setBackground(setCharacter, item);
                setPicker(null);
              }}
              onPreview={() => open(`link_background_${item.id}`)}
            />
          )}
        />
      )}
      {picker === 'class' && (
        <Phase1PickerModal
          title='Select class'
          titleId='builder-class'
          items={classes.filter((item) => item.id !== character.details?.class_2?.id)}
          getName={(item) => item.name}
          getKey={(item) => String(item.id)}
          empty='No classes loaded.'
          onClose={() => setPicker(null)}
          renderItem={(item) => (
            <ContentPickRow
              name={item.name}
              detail={sourceName(item.content_source_id)}
              selected={character.details?.class?.id === item.id}
              onPick={() => void afterClassPick(item, '1')}
              onPreview={() => open(`link_class_${item.id}`)}
            />
          )}
        />
      )}
      {picker === 'class2' && (
        <Phase1PickerModal
          title='Select second class'
          titleId='builder-class-2'
          items={classes.filter((item) => item.id !== character.details?.class?.id)}
          getName={(item) => item.name}
          getKey={(item) => String(item.id)}
          empty='No classes loaded.'
          onClose={() => setPicker(null)}
          renderItem={(item) => (
            <ContentPickRow
              name={item.name}
              detail={sourceName(item.content_source_id)}
              selected={character.details?.class_2?.id === item.id}
              onPick={() => void afterClassPick(item, '2')}
              onPreview={() => open(`link_class_${item.id}`)}
            />
          )}
        />
      )}
      {(picker === 'archetype' || picker === 'archetype2') && (
        <Phase1PickerModal
          title='Optional class archetype'
          titleId='builder-class-archetype'
          items={[{ id: -999, name: 'Base class (no archetype)' } as ClassArchetype, ...archetypes]}
          getName={(item) => item.name}
          getKey={(item) => String(item.id)}
          empty='No archetypes.'
          onClose={() => setPicker(null)}
          renderItem={(item) => (
            <ContentPickRow
              name={item.name}
              selected={false}
              onPick={() => {
                setCharacter((prev) => {
                  if (!prev) return prev;
                  if (item.id === -999) return prev;
                  return {
                    ...prev,
                    details: {
                      ...prev.details,
                      class_archetype: picker === 'archetype' ? item : prev.details?.class_archetype,
                      class_archetype_2: picker === 'archetype2' ? item : prev.details?.class_archetype_2,
                    },
                  };
                });
                setPicker(null);
              }}
            />
          )}
        />
      )}
        </>
      )}
    </div>
  );
}

function PickRow({
  label,
  value,
  extra,
  onChoose,
  onPreview,
}: {
  label: string;
  value?: string;
  extra?: string;
  onChoose: () => void;
  onPreview?: () => void;
}) {
  return (
    <div className='flex items-center justify-between gap-2 border border-p1-border bg-p1-inset px-3 py-2'>
      <div className='min-w-0'>
        <div className='text-[11px] uppercase text-p1-faint'>{label}</div>
        {value ? (
          <button type='button' className='truncate text-left text-sm text-p1-accent hover:underline' onClick={onPreview}>
            {value}
            {extra ? ` · ${extra}` : ''}
          </button>
        ) : (
          <div className='text-sm text-p1-faint'>Not selected</div>
        )}
      </div>
      <button type='button' className='toolbar-button shrink-0' onClick={onChoose}>
        {value ? 'Change' : 'Choose'}
      </button>
    </div>
  );
}

function ContentPickRow({
  name,
  detail,
  selected,
  onPick,
  onPreview,
}: {
  name: string;
  detail?: string;
  selected: boolean;
  onPick: () => void;
  onPreview?: () => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 border-b border-p1-border px-3 py-2 ${selected ? 'bg-p1-accent/10' : 'hover:bg-p1-hover'}`}>
      <button type='button' className='min-w-0 flex-1 text-left' onClick={onPick}>
        <span className='block text-sm font-medium'>{name}</span>
        {detail && <span className='block text-[11px] text-p1-faint'>{detail}</span>}
      </button>
      {onPreview && (
        <button type='button' className='text-xs text-p1-muted hover:text-p1-accent' onClick={onPreview}>
          Info
        </button>
      )}
    </div>
  );
}
