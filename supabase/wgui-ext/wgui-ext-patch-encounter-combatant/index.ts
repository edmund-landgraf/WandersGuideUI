// @ts-ignore
import { serve } from 'std/server';
import type { Encounter } from '../_shared/content';
import { connect, createServiceClient } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import {
  combatantsOf,
  loadAuthorizedEncounter,
  requireCampaignId,
  requireCombatantId,
  requireEncounterId,
  requireGm,
  saveCombatants,
} from '../_wgui-ext/encounter-command.ts';

type PatchBody = {
  campaign_id?: unknown;
  encounter_id?: unknown;
  combatant_id?: unknown;
  initiative?: unknown;
  hp_current?: unknown;
  hp_temp?: unknown;
  conditions?: unknown;
};

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, field + ' must be a finite number or null.', 'INVALID_' + field.toUpperCase());
  }
  return value;
}

function optionalConditions(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'conditions must be an array or null.', 'INVALID_CONDITIONS');
  }
  return value;
}

function patchEntity(
  entity: Record<string, unknown>,
  body: PatchBody,
  fields: { initiative: boolean }
): Record<string, unknown> {
  const next = { ...entity };
  if (body.hp_current !== undefined) next.hp_current = optionalNumber(body.hp_current, 'hp_current');
  if (body.hp_temp !== undefined) next.hp_temp = optionalNumber(body.hp_temp, 'hp_temp');
  if (body.conditions !== undefined) {
    const conditions = body.conditions === null ? null : optionalConditions(body.conditions);
    next.details = { ...((next.details as Record<string, unknown> | undefined) ?? {}), conditions };
  }
  if (fields.initiative && body.initiative !== undefined) {
    next.initiative = optionalNumber(body.initiative, 'initiative');
  }
  return next;
}

serve(async (req: Request) => {
  return await connect<PatchBody>(req, async (client, body, token) => {
    const campaignId = requireCampaignId(body ?? {});
    const encounterId = requireEncounterId(body ?? {});
    const combatantId = requireCombatantId(body?.combatant_id);

    const hasPatch =
      body?.initiative !== undefined ||
      body?.hp_current !== undefined ||
      body?.hp_temp !== undefined ||
      body?.conditions !== undefined;
    if (!hasPatch) {
      throw new HttpError(400, 'Send at least one combatant field.', 'COMBATANT_PATCH_REQUIRED');
    }

    const admin = createServiceClient();
    const { access, encounter } = await loadAuthorizedEncounter(
      client,
      admin,
      token,
      campaignId,
      encounterId
    );
    requireGm(access.isGm);

    const list = combatantsOf(encounter);
    const index = list.findIndex((combatant) => combatant._id === combatantId);
    if (index === -1) {
      throw new HttpError(404, 'Combatant not found.', 'COMBATANT_NOT_FOUND');
    }

    const current = list[index];
    const next = { ...current };
    if (body.initiative !== undefined) {
      next.initiative = optionalNumber(body.initiative, 'initiative');
    }

    const entity = current.type === 'CREATURE' ? current.creature : current.data;
    const entityPatchRequested =
      body.hp_current !== undefined ||
      body.hp_temp !== undefined ||
      body.conditions !== undefined;
    if (entityPatchRequested) {
      if (!entity || typeof entity !== 'object') {
        throw new HttpError(
          400,
          'This combatant has no encounter-row state to patch.',
          'COMBATANT_STATE_UNAVAILABLE'
        );
      }
      const patched = patchEntity(entity, body, { initiative: false });
      if (current.type === 'CREATURE') next.creature = patched;
      else next.data = patched;
    }

    const saved = await saveCombatants(admin, encounterId, encounter, [
      ...list.slice(0, index),
      next,
      ...list.slice(index + 1),
    ]);
    return { status: 'success', data: { combatant: saved[index] } };
  });
});
