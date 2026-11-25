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

/** All participating encounter writers use the same revision counter. Never
 * replace a whole database row or accept a revision supplied as part of metadata. */
export async function saveEncounterFields(
  admin: SupabaseClient<any, 'public', any>,
  encounterId: number,
  encounter: Encounter,
  fields: Record<string, unknown>,
  nextMeta: Record<string, unknown>,
  revision: number
): Promise<number> {
  const conflict = () => new HttpError(409,
    'The encounter changed in another browser. Reload it and retry.',
    'ENCOUNTER_REVISION_CONFLICT');
  if (revision !== encounterRevision(encounter) || revision >= Number.MAX_SAFE_INTEGER) throw conflict();
  const meta_data = { ...nextMeta, encounter_revision: revision + 1 };
  // Scope the atomic update to the authorized row. No owner/campaign reassignment.
  let update = admin.from('encounter').update({ ...fields, meta_data }).eq('id', encounterId);
  if (encounter.campaign_id == null) update = update.is('campaign_id', null).eq('user_id', encounter.user_id);
  else update = update.eq('campaign_id', encounter.campaign_id);
  if (Object.prototype.hasOwnProperty.call(encounter.meta_data ?? {}, 'encounter_revision')) {
    update = update.eq('meta_data->>encounter_revision', String(revision));
  } else {
    update = update.is('meta_data->>encounter_revision', null);
  }
  const { data, error } = await update.select('id');
  if (error) throw error;
  if (!data || data.length !== 1) throw conflict();
  return revision + 1;
}

export async function saveCombatants(
  admin: SupabaseClient<any, 'public', any>,
  encounterId: number,
  encounter: Encounter,
  list: CombatantCommand[],
  revision: number,
  extraMeta?: Record<string, unknown>
): Promise<{ list: CombatantCommand[]; revision: number }> {
  const combatants = { ...(encounter.combatants ?? {}), list };
  const nextMeta = { ...((encounter.meta_data ?? {}) as Record<string, unknown>), ...(extraMeta ?? {}) };
  const nextRevision = await saveEncounterFields(admin, encounterId, encounter, { combatants }, nextMeta, revision);
  return { list, revision: nextRevision };
}

export function characterIdOf(combatant: CombatantCommand): number | null {
  if (combatant.type && combatant.type !== 'CHARACTER') return null;
  return numericId(combatant.character) ?? numericId(combatant.data?.id);
}
