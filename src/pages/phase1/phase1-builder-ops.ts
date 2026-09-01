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
    // #region agent log
    fetch('http://127.0.0.1:7421/ingest/5bcbb1e6-5cc6-4f07-9ef3-8c7101fed88e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2c7b0'},body:JSON.stringify({sessionId:'b2c7b0',runId:'pre-fix',hypothesisId:'B',location:'phase1-builder-ops.ts:saveSelectionChange',message:'saved selection',data:{path,value,heritageKeys:Object.keys(selections).filter((k)=>k.includes('ancestry-section')||k.includes('heritage'))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    const before = Object.keys(prev.operation_data?.selections ?? {});
    const selections = removeParentSelections('ancestry', prev.operation_data?.selections);
    // #region agent log
    fetch('http://127.0.0.1:7421/ingest/5bcbb1e6-5cc6-4f07-9ef3-8c7101fed88e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2c7b0'},body:JSON.stringify({sessionId:'b2c7b0',runId:'pre-fix',hypothesisId:'A',location:'phase1-builder-ops.ts:setAncestry',message:'ancestry change cleared selections',data:{ancestryId:option.id,removed:before.filter((k)=>!Object.keys(selections??{}).includes(k)),keptHeritage:Object.keys(selections??{}).filter((k)=>k.includes('ancestry-section'))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return {
      ...prev,
      details: { ...prev.details, ancestry: option },
      operation_data: {
        ...prev.operation_data,
        selections,
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
  const levels = Array.from({ length: (character.level ?? 0) + 1 }, (_, index) => index);
  return addChoiceCounts(
    ...levels.map((level) => {
      if (level === 0) return foundationChoiceCounts(results);
      const ancestrySections = results.ancestrySectionResults.filter((section) => section.baseSource.level === level);
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
