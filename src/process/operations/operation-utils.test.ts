import { describe, expect, it } from 'vitest';
import { findSelectedOption } from './operation-utils';

describe('findSelectedOption', () => {
  it('accepts the persisted adjusted-variable identifier for ADJ_VALUE', () => {
    const option = { _select_uuid: 'boost-operation', _content_type: 'ability-block' as const, id: 'boost-operation', variable: 'ATTRIBUTE_CON', value: { value: 1 } };
    expect(findSelectedOption([option], 'ATTRIBUTE_CON', 'ADJ_VALUE')).toBe(option);
  });

  it('keeps strict UUID matching for non-ADJ_VALUE selections', () => {
    const option = { _select_uuid: 'option-a', _content_type: 'ability-block' as const, id: 'option-a', variable: 'ATTRIBUTE_CON' };
    expect(findSelectedOption([option], 'ATTRIBUTE_CON', 'ABILITY_BLOCK')).toBeUndefined();
  });

  it('prefers the operation UUID when both identifiers are present', () => {
    const direct = { _select_uuid: 'ATTRIBUTE_CON', _content_type: 'ability-block' as const, variable: 'ATTRIBUTE_STR' };
    const fallback = { _select_uuid: 'boost-operation', _content_type: 'ability-block' as const, variable: 'ATTRIBUTE_CON' };
    expect(findSelectedOption([direct, fallback], 'ATTRIBUTE_CON', 'ADJ_VALUE')).toBe(direct);
  });
});
