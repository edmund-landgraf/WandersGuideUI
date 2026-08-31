import { describe, expect, it } from 'vitest';
import type { AmbaChallengeTable, Encounter } from '@schemas/content';
import {
  findAmbaChallenge,
  challengeCheckEntries,
  mapAmbaChallengeStat,
  mapAmbaCheckLabel,
  mergeEncounterMeta,
  noteForAmbaOutcome,
  readAmbaChallenges,
} from './phase1-amba-challenges';
import { DICE_CHECK_VALUES } from './phase1-dice-check';

const challenge: AmbaChallengeTable = {
  id: 'chal-reading-the-room',
  title: 'Reading the Room',
  source: { containerId: 'enc-greymark', containerTitle: 'Audience with Greymark', flavor: 'social' },
  check: { skills: ['Perception', 'Society'], dc: 22, dcLabel: '22 (Moderate)' },
  effect: { kind: 'story' },
  degrees: {
    criticalSuccess: 'He also admits the key was recently handled.',
    success: 'You notice he fears public panic more than personal danger.',
    failure: 'You get the job but no leverage.',
    criticalFailure: 'He takes offense and the audience ends cold.',
  },
};

function known() {
  return DICE_CHECK_VALUES;
}

describe('AMBA challenges', () => {
  it('treats missing or empty challenges as ad hoc', () => {
    expect(readAmbaChallenges({})).toEqual([]);
    expect(readAmbaChallenges({ amba: { challenges: [] } })).toEqual([]);
    expect(readAmbaChallenges({ amba: { challenges: null } })).toEqual([]);
  });

  it('maps skills and saves onto DICE_CHECK_OPTIONS', () => {
    expect(mapAmbaCheckLabel('Perception', known())).toBe('PERCEPTION');
    expect(mapAmbaCheckLabel('Fortitude', known())).toBe('SAVE_FORT');
    expect(mapAmbaCheckLabel('Fort', known())).toBe('SAVE_FORT');
    expect(mapAmbaCheckLabel('Reflex', known())).toBe('SAVE_REFLEX');
    expect(mapAmbaCheckLabel('Will', known())).toBe('SAVE_WILL');
    expect(mapAmbaCheckLabel('Diplomacy', known())).toBe('SKILL_DIPLOMACY');
    expect(mapAmbaCheckLabel('Society', known())).toBe('SKILL_SOCIETY');
    expect(mapAmbaCheckLabel('Not A Skill', known())).toBeUndefined();
    expect(mapAmbaChallengeStat(challenge, known())).toBe('PERCEPTION');
    expect(mapAmbaChallengeStat({
      ...challenge,
      check: { dc: 18 },
      effect: { kind: 'story', save: 'will' },
    }, known())).toBe('SAVE_WILL');
  });

  it('maps degree text onto WGUI outcomes', () => {
    expect(noteForAmbaOutcome(challenge, 'critical-success')).toBe(challenge.degrees.criticalSuccess);
    expect(noteForAmbaOutcome(challenge, 'success')).toBe(challenge.degrees.success);
    expect(noteForAmbaOutcome(challenge, 'failure')).toBe(challenge.degrees.failure);
    expect(noteForAmbaOutcome(challenge, 'critical-failure')).toBe(challenge.degrees.criticalFailure);
    expect(noteForAmbaOutcome(undefined, 'success')).toBeUndefined();
  });

  it('preserves amba.challenges and AMBA party stats on WGUI dice writes', () => {
    const current: Encounter['meta_data'] = {
      description: 'See campaign note “Audience with Greymark”.',
      party_level: 5,
      party_size: 4,
      dice_roll_log: [],
      amba: { challenges: [challenge] },
    };
    const next = mergeEncounterMeta(
      current,
      { dice_roll_state: { title: 'Reading the Room', dc: 22, stat: 'PERCEPTION' } },
      { party_size: 0, party_level: 0 },
    );
    expect(next.amba?.challenges).toEqual([challenge]);
    expect(next.party_level).toBe(5);
    expect(next.party_size).toBe(4);
    expect(next.description).toBe(current.description);
    expect(next.dice_roll_state?.title).toBe('Reading the Room');
  });

  it('still computes party size when there is no amba namespace', () => {
    const next = mergeEncounterMeta(
      { dice_roll_log: [] },
      { dice_roll_state: { dc: 15 } },
      { party_size: 3, party_level: 4 },
    );
    expect(next.party_size).toBe(3);
    expect(next.party_level).toBe(4);
    expect(next.amba).toBeUndefined();
  });

  it('finds a challenge by id', () => {
    expect(findAmbaChallenge([challenge], 'chal-reading-the-room')?.title).toBe('Reading the Room');
    expect(findAmbaChallenge([challenge], '')).toBeUndefined();
  });

  it('lists each challenge skill as a check entry', () => {
    expect(challengeCheckEntries(challenge, known())).toEqual([
      { skill: 'Perception', stat: 'PERCEPTION' },
      { skill: 'Society', stat: 'SKILL_SOCIETY' },
    ]);
  });
});
