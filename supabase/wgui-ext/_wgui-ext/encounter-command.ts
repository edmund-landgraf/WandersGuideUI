// Shared command helpers for narrow encounter combatant writes.

import type { Encounter } from '../_shared/content';
import { authorizeCampaign, encounterIncludesCharacter, sameNumericId } from './shared.ts';
import { fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CombatantCommand = {
  _id?: string;
  type?: string;
  ally?: boolean;
  initiative?: number | null;
  character?: number | string | null;
  creature?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type EncounterCommandBody = {
  campaign_id?: unknown;
  encounter_id?: unknown;
};

export function requireRevision(body: EncounterCommandBody & { encounter_revision?: unknown }): number {
  const value = body.encounter_revision;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(
      400,
      'An encounter_revision is required and must be a non-negative integer.',
      'ENCOUNTER_REVISION_REQUIRED'
    );
  }
  return value;
}

export function encounterRevision(encounter: Encounter): number {
  const value = (encounter.meta_data as Record<string, unknown> | null | undefined)?.encounter_revision;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function numericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function requireId(value: unknown, code: string, label: string): number {
  const id = numericId(value);
  if (id === null) throw new HttpError(400, `A ${label} is required.`, code);
  return id;
}

export function requireEncounterId(body: EncounterCommandBody): number {
  return requireId(body.encounter_id, 'ENCOUNTER_ID_REQUIRED', 'encounter_id');
}

export function requireCampaignId(body: EncounterCommandBody): number {
  return requireId(body.campaign_id, 'CAMPAIGN_ID_REQUIRED', 'campaign_id');
}

export function combatantsOf(encounter: Encounter): CombatantCommand[] {
  const list = encounter.combatants?.list;
  return Array.isArray(list) ? (list as CombatantCommand[]) : [];
}

export function requireCombatantId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'A combatant_id is required.', 'COMBATANT_ID_REQUIRED');
  }
  return value.trim();
}

export async function loadAuthorizedEncounter(
  client: SupabaseClient<any, 'public', any>,
  admin: SupabaseClient<any, 'public', any>,
  token: string,
  campaignId: number,
  encounterId: number
): Promise<{ access: Awaited<ReturnType<typeof authorizeCampaign>>; encounter: Encounter }> {
  const access = await authorizeCampaign(client, admin, token, campaignId);
  const rows = await fetchData<Encounter>(admin, 'encounter', [
    { column: 'id', value: encounterId },
  ]);
  const encounter = rows[0];
  if (!encounter || !sameNumericId(encounter.campaign_id, campaignId)) {
    throw new HttpError(403, 'You do not have access to this encounter.', 'ENCOUNTER_FORBIDDEN');
  }
  if (!access.isGm && !encounterIncludesCharacter(encounter, access.characterIds)) {
    throw new HttpError(403, 'You do not have access to this encounter.', 'ENCOUNTER_FORBIDDEN');
  }
  return { access, encounter };
}

export function requireGm(isGm: boolean): void {
  if (!isGm) {
    throw new HttpError(403, 'Only the campaign GM can change encounter combatants.', 'GM_REQUIRED');
  }
}

export async function saveCombatants(
  admin: SupabaseClient<any, 'public', any>,
  encounterId: number,
  encounter: Encounter,
  list: CombatantCommand[],
  revision: number,
  extraMeta?: Record<string, unknown>
): Promise<{ list: CombatantCommand[]; revision: number }> {
  const currentRevision = encounterRevision(encounter);
  if (revision !== currentRevision) {
    throw new HttpError(
      409,
      'The encounter changed in another browser. Reload it and retry.',
      'ENCOUNTER_REVISION_CONFLICT'
    );
  }

  const combatants = {
    ...(encounter.combatants ?? {}),
    list,
  };
  const metaData = {
    ...((encounter.meta_data ?? {}) as Record<string, unknown>),
    ...(extraMeta ?? {}),
    encounter_revision: revision + 1,
  };
  let update = admin
    .from('encounter')
    .update({ combatants, meta_data: metaData })
    .eq('id', encounterId);

  if (Object.prototype.hasOwnProperty.call(encounter.meta_data ?? {}, 'encounter_revision')) {
    update = update.eq('meta_data->>encounter_revision', String(revision));
  } else {
    update = update.is('meta_data->>encounter_revision', null);
  }

  const { data, error } = await update.select('id');
  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new HttpError(
      409,
      'The encounter changed in another browser. Reload it and retry.',
      'ENCOUNTER_REVISION_CONFLICT'
    );
  }
  return { list, revision: revision + 1 };
}

export function characterIdOf(combatant: CombatantCommand): number | null {
  if (combatant.type && combatant.type !== 'CHARACTER') return null;
  return numericId(combatant.character) ?? numericId(combatant.data?.id);
}
