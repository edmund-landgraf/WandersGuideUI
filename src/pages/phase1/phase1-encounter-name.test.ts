import { describe, expect, it } from 'vitest';
import { nextEncounterName } from './phase1-encounter-name';

describe('nextEncounterName', () => {
  it('starts at Random Encounter', () => {
    expect(nextEncounterName([])).toBe('Random Encounter');
  });

  it('then uses Random Encounter (1)', () => {
    expect(nextEncounterName(['Random Encounter'])).toBe('Random Encounter (1)');
  });

  it('fills the next unused number', () => {
    expect(nextEncounterName(['Random Encounter', 'Random Encounter (1)', 'Boss fight'])).toBe('Random Encounter (2)');
  });

  it('reuses Random Encounter if it was deleted', () => {
    expect(nextEncounterName(['Random Encounter (1)'])).toBe('Random Encounter');
  });
});
