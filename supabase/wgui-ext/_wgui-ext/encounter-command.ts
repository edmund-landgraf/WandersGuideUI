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
  list: CombatantCommand[]
): Promise<CombatantCommand[]> {
  const combatants = {
    ...(encounter.combatants ?? {}),
    list,
  };
  const { error } = await admin
    .from('encounter')
    .update({ combatants })
    .eq('id', encounterId);
  if (error) throw error;
  return list;
}

export function characterIdOf(combatant: CombatantCommand): number | null {
  if (combatant.type && combatant.type !== 'CHARACTER') return null;
  return numericId(combatant.character) ?? numericId(combatant.data?.id);
}
