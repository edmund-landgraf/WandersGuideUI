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
