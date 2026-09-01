import { describe, expect, it } from 'vitest';
import type { AbilityBlock, OperationCharacterResultPackage } from '@schemas/content';
import type { OperationResult } from '@schemas/operations';
import { countAllBuilderChoices } from './phase1-builder-ops';

function selection(filled: boolean): OperationResult {
  return {
    selection: { id: 'test', options: [] },
    result: filled ? { source: { _select_uuid: '1', _content_type: 'ability-block', id: 1 }, results: [] } : undefined,
  };
}

function packageOf(partial: Partial<OperationCharacterResultPackage>): OperationCharacterResultPackage {
  return {
    characterResults: [],
    ancestryResults: [],
    backgroundResults: [],
    classResults: [],
    class2Results: [],
    classFeatureResults: [],
    itemResults: [],
    contentSourceResults: [],
    ancestrySectionResults: [],
    ...partial,
  } as OperationCharacterResultPackage;
}

function feature(id: number, level: number, name: string, filled: number, max: number) {
  return {
    baseSource: { id, level, name, type: 'feat' } as AbilityBlock,
    baseResults: Array.from({ length: max }, (_, index) => selection(index < filled)),
  };
}

describe('countAllBuilderChoices', () => {
  it('sums foundation and level rows', () => {
    const results = packageOf({
      ancestryResults: [selection(true), selection(true)],
      backgroundResults: [selection(true)],
      classResults: [selection(false)],
      classFeatureResults: [feature(10, 1, 'Class feat', 1, 2)],
    });
    const counts = countAllBuilderChoices({ level: 1 } as never, results);
    expect(counts).toEqual({ current: 4, max: 6 });
  });

  it('counts heritage with other level 1 ancestry sections', () => {
    const results = packageOf({
      ancestrySectionResults: [
        feature(1, 1, 'Heritage', 2, 2),
        feature(2, 1, 'Human Feat', 1, 1),
      ],
      classFeatureResults: [feature(10, 1, 'Rogue Feat', 1, 1)],
    });
    const counts = countAllBuilderChoices({ level: 1 } as never, results);
    expect(counts).toEqual({ current: 4, max: 4 });
  });
});
