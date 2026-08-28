import { describe, expect, it } from 'vitest';
import { encounterDisplayName, encounterNamesMatch } from './phase1-encounter-title';

describe('encounterDisplayName', () => {
  it('strips Random Encounter prefixes', () => {
    expect(encounterDisplayName("Random Encounter · Lost Wizard's Vault")).toBe("Lost Wizard's Vault");
    expect(encounterDisplayName("Random Encounter - Lost Wizard's Vault")).toBe("Lost Wizard's Vault");
  });

  it('leaves a plain location name alone', () => {
    expect(encounterDisplayName("Lost Wizard's Vault")).toBe("Lost Wizard's Vault");
  });
});

describe('encounterNamesMatch', () => {
  it('matches a prefixed encounter to a location note', () => {
    expect(encounterNamesMatch("Random Encounter · Lost Wizard's Vault", "Lost Wizard's Vault")).toBe(true);
  });

  it('does not match unrelated titles', () => {
    expect(encounterNamesMatch("Random Encounter · Lost Wizard's Vault", 'The Standoff')).toBe(false);
  });
});
