// @ts-ignore
import { serve } from 'std/server';
import type { Encounter } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import {
  authorizeCampaign,
  encounterIncludesCharacter,
  mergePlayerDiceRollLog,
  mergePlayerDiceRollState,
  sameNumericId,
} from '../_wgui-ext/shared.ts';

interface PatchEncounterDiceBody {
  campaign_id?: number;
  encounter_id?: number;
  dice_roll_state?: Record<string, unknown> | null;
  dice_roll_log?: unknown[];
}

function validateDiceRollLog(value: unknown): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'dice_roll_log must be an array.', 'INVALID_DICE_LOG');
  }
  const allowed = new Set(['id', 'title', 'dc', 'defaultStat', 'initiated_by_user_id', 'entries']);
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new HttpError(400, 'Each dice log row must be an object.', 'INVALID_DICE_LOG_ROW');
    }
    const item = row as Record<string, unknown>;
    if (Object.keys(item).some((key) => !allowed.has(key))) {
      throw new HttpError(400, 'Dice log rows contain unsupported fields.', 'INVALID_DICE_LOG_ROW');
    }
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      throw new HttpError(400, 'Each dice log row needs a title.', 'INVALID_DICE_LOG_ROW');
    }
    if (!Array.isArray(item.entries) || item.entries.length === 0) {
      throw new HttpError(400, 'Each dice log row needs at least one entry.', 'INVALID_DICE_LOG_ROW');
    }
    for (const entry of item.entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new HttpError(400, 'Each dice log entry must be an object.', 'INVALID_DICE_LOG_ENTRY');
      }
      const roll = entry as Record<string, unknown>;
      if (
        typeof roll.name !== 'string' ||
        typeof roll.ally !== 'boolean' ||
        typeof roll.calculation !== 'string' ||
        typeof roll.total !== 'number' ||
        !Number.isFinite(roll.total)
      ) {
        throw new HttpError(400, 'Each dice log entry needs name, ally, calculation, and total.', 'INVALID_DICE_LOG_ENTRY');
      }
    }
  }
}

/**
 * Campaign members write only dice_roll_state / dice_roll_log. Roster, initiative, and
 * other meta stay off this path. Players can only add or drop log rows they initiated.
 */
serve(async (req: Request) => {
  return await connect<PatchEncounterDiceBody>(req, async (client, body, token) => {
    const { campaign_id, encounter_id } = body ?? {};
    const hasState = body != null && 'dice_roll_state' in body;
    const hasLog = body != null && 'dice_roll_log' in body;
    if (campaign_id === undefined || campaign_id === null) {
      throw new HttpError(400, 'A campaign_id is required.', 'CAMPAIGN_ID_REQUIRED');
    }
    if (encounter_id === undefined || encounter_id === null) {
      throw new HttpError(400, 'An encounter_id is required.', 'ENCOUNTER_ID_REQUIRED');
    }
    if (!hasState && !hasLog) {
      throw new HttpError(400, 'dice_roll_state or dice_roll_log is required.', 'DICE_PATCH_REQUIRED');
    }
    if (hasLog) validateDiceRollLog(body!.dice_roll_log);

    const admin = createServiceClient();
    const access = await authorizeCampaign(client, admin, token, campaign_id);

    const rows = await fetchData<Encounter>(admin, 'encounter', [
      { column: 'id', value: encounter_id },
    ]);
    const encounter = rows[0];
    if (!encounter || !sameNumericId(encounter.campaign_id, campaign_id)) {
      throw new HttpError(403, 'You do not have access to this encounter.', 'ENCOUNTER_FORBIDDEN');
    }
    if (!access.isGm && !encounterIncludesCharacter(encounter, access.characterIds)) {
      throw new HttpError(403, 'You do not have access to this encounter.', 'ENCOUNTER_FORBIDDEN');
    }

    const currentMeta = (encounter.meta_data ?? {}) as Record<string, unknown>;
    const nextMeta = { ...currentMeta };
    if (hasState) {
      const incoming = body!.dice_roll_state == null ? {} : (body!.dice_roll_state as Record<string, unknown>);
      nextMeta.dice_roll_state = access.isGm
        ? incoming
        : mergePlayerDiceRollState(currentMeta.dice_roll_state as Record<string, unknown> | undefined, incoming);
    }
    if (hasLog) {
      const incoming = Array.isArray(body!.dice_roll_log) ? body!.dice_roll_log : [];
      nextMeta.dice_roll_log = access.isGm
        ? incoming
        : mergePlayerDiceRollLog(
            currentMeta.dice_roll_log as Array<Record<string, unknown>> | undefined,
            incoming as Array<Record<string, unknown>>,
            access.userId
          );
    }

    const { error } = await admin.from('encounter').update({ meta_data: nextMeta }).eq('id', encounter_id);
    if (error) throw error;

    return {
      status: 'success',
      data: {
        dice_roll_state: nextMeta.dice_roll_state,
        dice_roll_log: nextMeta.dice_roll_log ?? [],
      },
    };
  });
});
