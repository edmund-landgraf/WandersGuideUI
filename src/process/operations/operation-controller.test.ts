import { describe, expect, it } from 'vitest';
import { recordInPackage } from './operation-controller';

describe('recordInPackage', () => {
  it('uses the enabled-book row when the saved identity is in the package', () => {
    const packaged = { id: 3, name: 'Elf', operations: [{ id: 'package' }] };
    const stored = { id: 3, name: 'Elf', operations: [{ id: 'stored' }] };
    expect(recordInPackage([packaged], stored)).toBe(packaged);
  });

  it('keeps a saved background whose book is not in the package', () => {
    const stored = { id: 1152, name: 'Feybound', operations: [{ id: 'boost' }] };
    expect(recordInPackage([{ id: 1, name: 'Acolyte', operations: [] }], stored)).toBe(stored);
  });

  it('returns nothing when no identity is saved', () => {
    expect(recordInPackage([{ id: 1 }], null)).toBeUndefined();
  });
});
