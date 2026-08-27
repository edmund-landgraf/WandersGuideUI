import type { AmbaChallengeTable, DiceRollOutcome, Encounter } from '@schemas/content';
import { AmbaChallengeTableSchema } from '@schemas/content';

const SAVE_LABELS: Record<string, string> = {
  fortitude: 'SAVE_FORT',
  fort: 'SAVE_FORT',
  reflex: 'SAVE_REFLEX',
  will: 'SAVE_WILL',
};

const DEGREE_KEYS: Record<DiceRollOutcome, keyof AmbaChallengeTable['degrees']> = {
  'critical-success': 'criticalSuccess',
  success: 'success',
  failure: 'failure',
  'critical-failure': 'criticalFailure',
};

export function readAmbaChallenges(meta: Encounter['meta_data'] | undefined): AmbaChallengeTable[] {
  const raw = meta?.amba?.challenges;
  if (!raw?.length) return [];
  return raw.flatMap((item) => {
    const parsed = AmbaChallengeTableSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function findAmbaChallenge(challenges: AmbaChallengeTable[], id: string | undefined) {
  if (!id) return undefined;
  return challenges.find((challenge) => challenge.id === id);
}

export function mapAmbaCheckLabel(label: string | undefined, knownCheckValues: ReadonlySet<string>): string | undefined {
  if (!label?.trim()) return undefined;
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'perception') return knownCheckValues.has('PERCEPTION') ? 'PERCEPTION' : undefined;
  const save = SAVE_LABELS[lower];
  if (save) return knownCheckValues.has(save) ? save : undefined;
  const skill = `SKILL_${trimmed.replace(/\s+/g, '_').toUpperCase()}`;
  return knownCheckValues.has(skill) ? skill : undefined;
}

export function mapAmbaChallengeStat(challenge: AmbaChallengeTable, knownCheckValues: ReadonlySet<string>): string | undefined {
  const skill = challenge.check.skills?.find((entry) => entry.trim());
  if (skill) return mapAmbaCheckLabel(skill, knownCheckValues);
  return mapAmbaCheckLabel(challenge.effect?.save, knownCheckValues);
}

export function challengeCheckEntries(challenge: AmbaChallengeTable, knownCheckValues: ReadonlySet<string>) {
  const skills = (challenge.check.skills ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (skills.length) {
    return skills.map((skill) => ({ skill, stat: mapAmbaCheckLabel(skill, knownCheckValues) }));
  }
  const save = challenge.effect?.save;
  if (save) return [{ skill: save, stat: mapAmbaCheckLabel(save, knownCheckValues) }];
  return [{ skill: '', stat: mapAmbaChallengeStat(challenge, knownCheckValues) }];
}

export function noteForAmbaOutcome(challenge: AmbaChallengeTable | undefined, outcome: DiceRollOutcome | undefined) {
  if (!challenge || !outcome) return undefined;
  const text = challenge.degrees[DEGREE_KEYS[outcome]]?.trim();
  return text || undefined;
}

export function hasAmbaNamespace(meta: Encounter['meta_data'] | undefined) {
  return meta?.amba != null;
}

export function mergeEncounterMeta(
  current: Encounter['meta_data'],
  patch: Partial<Encounter['meta_data']> | undefined,
  computedParty: { party_size: number; party_level: number },
): Encounter['meta_data'] {
  const preserveAmbaParty = hasAmbaNamespace(current) || hasAmbaNamespace(patch);
  return {
    ...current,
    ...patch,
    ...(preserveAmbaParty
      ? {}
      : {
          party_size: computedParty.party_size,
          party_level: computedParty.party_level,
        }),
  };
}
