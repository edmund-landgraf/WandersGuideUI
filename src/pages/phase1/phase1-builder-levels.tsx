import type { Character, OperationCharacterResultPackage } from '@schemas/content';
import type { OperationResult } from '@schemas/operations';
import type { SetterOrUpdater } from '@utils/type-fixing';
import { addChoiceCounts, countChoices, foundationChoiceCounts, hasAnySelection, resultPrefix, saveSelectionChange } from './phase1-builder-ops';
import { Phase1OperationResults } from './phase1-builder-select';
import { useState } from 'react';

export function Phase1BuilderLevels({
  character,
  setCharacter,
  results,
}: {
  character: Character;
  setCharacter: SetterOrUpdater<Character | null>;
  results: OperationCharacterResultPackage | null;
}) {
  const levels = Array.from({ length: (character.level ?? 0) + 1 }, (_, index) => index);
  if (!results) {
    return <p className='text-sm text-p1-muted'>Calculating choices…</p>;
  }

  const emptyCore = results.ancestrySectionResults.length === 0 && results.classFeatureResults.length === 0;
  if (emptyCore && !character.details?.ancestry && !character.details?.background && !character.details?.class) {
    return <p className='text-sm italic text-p1-muted'>Select an ancestry, background, and class to get started.</p>;
  }

  return (
    <div className='space-y-3'>
      {levels.map((level) => (
        <LevelBlock
          key={level}
          level={level}
          character={character}
          setCharacter={setCharacter}
          results={results}
        />
      ))}
    </div>
  );
}

function LevelBlock({
  level,
  character,
  setCharacter,
  results,
}: {
  level: number;
  character: Character;
  setCharacter: SetterOrUpdater<Character | null>;
  results: OperationCharacterResultPackage;
}) {
  const [open, setOpen] = useState(level === 0);
  const ancestrySections = results.ancestrySectionResults.filter((section) => section.baseSource.level === level);
  const classFeatures = results.classFeatureResults.filter((section) => section.baseSource.level === level);

  const counts =
    level === 0
      ? foundationChoiceCounts(results)
      : addChoiceCounts(...ancestrySections.map((section) => countChoices(section.baseResults)), ...classFeatures.map((section) => countChoices(section.baseResults)));

  if (level > 0 && ancestrySections.length === 0 && classFeatures.length === 0) return null;

  const incomplete = counts.max > 0 && counts.current < counts.max;

  return (
    <section className={`border ${incomplete ? 'border-p1-accent/40' : 'border-p1-border'} bg-p1-surface`}>
      <button type='button' className='flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-p1-hover' onClick={() => setOpen((value) => !value)}>
        <span className='text-sm font-semibold'>
          {level === 0 ? (
            <>
              Foundation <span className='font-normal italic text-p1-muted'>(Level 1)</span>
            </>
          ) : (
            `Level ${level}`
          )}
        </span>
        {counts.max > 0 && (
          <span className={`text-xs ${incomplete ? 'font-semibold text-p1-accent' : 'text-p1-faint'}`}>
            {counts.current}/{counts.max}
          </span>
        )}
      </button>
      {open && (
        <div className='space-y-4 border-t border-p1-border px-4 py-4'>
          {level === 0 ? (
            <FoundationPane character={character} setCharacter={setCharacter} results={results} />
          ) : (
            <>
              {ancestrySections.map((section) => (
                <FeatureBlock
                  key={`ancestry-${section.baseSource.id}`}
                  title={section.baseSource.name}
                  results={section.baseResults}
                  onChange={(path, value) =>
                    saveSelectionChange(setCharacter, `${resultPrefix('ancestrySectionResults', section.baseSource.id)}_${path}`, value)
                  }
                />
              ))}
              {classFeatures.map((section) => (
                <FeatureBlock
                  key={`feature-${section.baseSource.id}`}
                  title={section.baseSource.name}
                  results={section.baseResults}
                  onChange={(path, value) =>
                    saveSelectionChange(setCharacter, `${resultPrefix('classFeatureResults', section.baseSource.id)}_${path}`, value)
                  }
                />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FoundationPane({
  character,
  setCharacter,
  results,
}: {
  character: Character;
  setCharacter: SetterOrUpdater<Character | null>;
  results: OperationCharacterResultPackage;
}) {
  return (
    <div className='space-y-5'>
      <FeatureBlock
        title='Ancestry'
        empty={!character.details?.ancestry}
        results={results.ancestryResults}
        onChange={(path, value) => saveSelectionChange(setCharacter, `${resultPrefix('ancestryResults')}_${path}`, value)}
      />
      <FeatureBlock
        title='Background'
        empty={!character.details?.background}
        results={results.backgroundResults}
        onChange={(path, value) => saveSelectionChange(setCharacter, `${resultPrefix('backgroundResults')}_${path}`, value)}
      />
      <FeatureBlock
        title='Class'
        empty={!character.details?.class}
        results={results.classResults}
        onChange={(path, value) => saveSelectionChange(setCharacter, `${resultPrefix('classResults')}_${path}`, value)}
      />
      {character.details?.class_2 && (
        <FeatureBlock
          title='Class 2'
          results={results.class2Results}
          onChange={(path, value) => saveSelectionChange(setCharacter, `${resultPrefix('class2Results')}_${path}`, value)}
        />
      )}
      {results.contentSourceResults.some((item) => hasAnySelection(item.baseResults)) &&
        results.contentSourceResults.map((item) => (
          <FeatureBlock
            key={item.baseSource.id}
            title={item.baseSource.name}
            results={item.baseResults}
            onChange={(path, value) =>
              saveSelectionChange(setCharacter, `${resultPrefix('contentSourceResults', item.baseSource.id)}_${path}`, value)
            }
          />
        ))}
      {results.itemResults.some((item) => hasAnySelection(item.baseResults)) &&
        results.itemResults.map((item) => (
          <FeatureBlock
            key={item.baseSource.id}
            title={item.baseSource.name}
            results={item.baseResults}
            onChange={(path, value) => saveSelectionChange(setCharacter, `${resultPrefix('itemResults', item.baseSource.id)}_${path}`, value)}
          />
        ))}
      {results.characterResults.length > 0 && (
        <FeatureBlock
          title='Custom'
          results={results.characterResults}
          onChange={(path, value) => saveSelectionChange(setCharacter, `${resultPrefix('characterResults')}_${path}`, value)}
        />
      )}
    </div>
  );
}

function FeatureBlock({
  title,
  results,
  onChange,
  empty,
}: {
  title: string;
  results: OperationResult[];
  onChange: (path: string, value: string) => void;
  empty?: boolean;
}) {
  const counts = countChoices(results);
  if (empty && counts.max === 0) {
    return <p className='text-sm italic text-p1-muted'>Choose a {title.toLowerCase()} on the left to see its choices.</p>;
  }
  if (counts.max === 0) return null;
  return (
    <div>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold'>{title}</h3>
        <span className={`text-xs ${counts.current < counts.max ? 'text-p1-accent' : 'text-p1-faint'}`}>
          {counts.current}/{counts.max}
        </span>
      </div>
      <Phase1OperationResults results={results} onChange={onChange} />
    </div>
  );
}
