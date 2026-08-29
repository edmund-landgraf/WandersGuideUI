import { removeParentSelections } from '@operations/selection-tree';
import { convertKeyToBasePrefix, hasOperationSelection } from '@operations/operation-utils';
import type { Ancestry, Background, Character, Class, OperationCharacterResultPackage } from '@schemas/content';
import type { OperationResult } from '@schemas/operations';
import type { SetterOrUpdater } from '@utils/type-fixing';

export type ChoiceCounts = { current: number; max: number };

export function countChoices(results: OperationResult[] | undefined | null): ChoiceCounts {
  let current = 0;
  let max = 0;
  for (const result of results ?? []) {
    if (!result) continue;
    if (result.selection) {
      max += 1;
      if (result.result?.source) current += 1;
    }
    const nested = countChoices(result.result?.results);
    current += nested.current;
    max += nested.max;
  }
  return { current, max };
}

export function addChoiceCounts(...counts: ChoiceCounts[]): ChoiceCounts {
  return counts.reduce((sum, item) => ({ current: sum.current + item.current, max: sum.max + item.max }), { current: 0, max: 0 });
}

export function saveSelectionChange(setCharacter: SetterOrUpdater<Character | null>, path: string, value: string) {
  setCharacter((prev) => {
    if (!prev) return prev;
    const selections = { ...prev.operation_data?.selections };
    if (!value) delete selections[path];
    else selections[path] = `${value}`;
    return {
      ...prev,
      operation_data: {
        ...prev.operation_data,
        selections,
      },
    };
  });
}

export function resultPrefix(key: Parameters<typeof convertKeyToBasePrefix>[0], id?: number) {
  return convertKeyToBasePrefix(key, id);
}

export function setAncestry(setCharacter: SetterOrUpdater<Character | null>, option: Ancestry) {
  setCharacter((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      details: { ...prev.details, ancestry: option },
      operation_data: {
        ...prev.operation_data,
        selections: removeParentSelections('ancestry', prev.operation_data?.selections),
      },
    };
  });
}

export function clearAncestry(setCharacter: SetterOrUpdater<Character | null>) {
  setCharacter((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      details: { ...prev.details, ancestry: undefined },
      operation_data: {
        ...prev.operation_data,
        selections: removeParentSelections('ancestry', prev.operation_data?.selections),
      },
    };
  });
}

export function setBackground(setCharacter: SetterOrUpdater<Character | null>, option: Background) {
  setCharacter((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      details: { ...prev.details, background: option },
      operation_data: {
        ...prev.operation_data,
        selections: removeParentSelections('background', prev.operation_data?.selections),
      },
    };
  });
}

export function clearBackground(setCharacter: SetterOrUpdater<Character | null>) {
  setCharacter((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      details: { ...prev.details, background: undefined },
      operation_data: {
        ...prev.operation_data,
        selections: removeParentSelections('background', prev.operation_data?.selections),
      },
    };
  });
}

export function setClass(setCharacter: SetterOrUpdater<Character | null>, option: Class, dualClass: boolean) {
  setCharacter((prev) => {
    if (!prev) return prev;
    let selections = removeParentSelections('class_', prev.operation_data?.selections);
    if (!dualClass) selections = removeParentSelections('class-feature', selections);
    return {
      ...prev,
      details: { ...prev.details, class: option, class_archetype: undefined },
      operation_data: { ...prev.operation_data, selections },
    };
  });
}

export function clearClass(setCharacter: SetterOrUpdater<Character | null>, dualClass: boolean) {
  setCharacter((prev) => {
    if (!prev) return prev;
    let selections = removeParentSelections('class_', prev.operation_data?.selections);
    if (!dualClass) selections = removeParentSelections('class-feature', selections);
    return {
      ...prev,
      details: { ...prev.details, class: undefined, class_archetype: undefined },
      operation_data: { ...prev.operation_data, selections },
    };
  });
}

export function setClass2(setCharacter: SetterOrUpdater<Character | null>, option: Class) {
  setCharacter((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      details: { ...prev.details, class_2: option, class_archetype_2: undefined },
      operation_data: {
        ...prev.operation_data,
        selections: removeParentSelections('class-2_', prev.operation_data?.selections),
      },
    };
  });
}

export function clearClass2(setCharacter: SetterOrUpdater<Character | null>) {
  setCharacter((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      details: { ...prev.details, class_2: undefined, class_archetype_2: undefined },
      operation_data: {
        ...prev.operation_data,
        selections: removeParentSelections('class-2_', prev.operation_data?.selections),
      },
    };
  });
}

export function heritageSection(results: OperationCharacterResultPackage | null) {
  return results?.ancestrySectionResults.find((section) => section.baseSource.type === 'heritage' || section.baseSource.name === 'Heritage') ?? null;
}

export function foundationChoiceCounts(results: OperationCharacterResultPackage) {
  return addChoiceCounts(
    countChoices(results.ancestryResults),
    countChoices(results.backgroundResults),
    countChoices(results.classResults),
    countChoices(results.class2Results),
    ...results.contentSourceResults.map((item) => countChoices(item.baseResults)),
    ...results.itemResults.map((item) => countChoices(item.baseResults)),
    countChoices(results.characterResults)
  );
}

export function countAllBuilderChoices(character: Character, results: OperationCharacterResultPackage): ChoiceCounts {
  const heritage = heritageSection(results);
  const levels = Array.from({ length: (character.level ?? 0) + 1 }, (_, index) => index);
  return addChoiceCounts(
    countChoices(heritage?.baseResults),
    ...levels.map((level) => {
      if (level === 0) return foundationChoiceCounts(results);
      const ancestrySections = results.ancestrySectionResults.filter(
        (section) => section.baseSource.level === level && section !== heritage
      );
      const classFeatures = results.classFeatureResults.filter((section) => section.baseSource.level === level);
      return addChoiceCounts(
        ...ancestrySections.map((section) => countChoices(section.baseResults)),
        ...classFeatures.map((section) => countChoices(section.baseResults))
      );
    })
  );
}

export function hasAnySelection(results: OperationResult[] | undefined) {
  return (results ?? []).some((result) => hasOperationSelection(result));
}
