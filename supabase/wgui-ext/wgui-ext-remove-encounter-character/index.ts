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
  requireRevision,
  saveCombatants,
} from '../_wgui-ext/encounter-command.ts';

type RemoveBody = {
  campaign_id?: unknown;
  encounter_id?: unknown;
  combatant_id?: unknown;
  encounter_revision?: unknown;
};

serve(async (req: Request) => {
  return await connect<RemoveBody>(req, async (client, body, token) => {
    const campaignId = requireCampaignId(body ?? {});
    const encounterId = requireEncounterId(body ?? {});
    const combatantId = requireCombatantId(body?.combatant_id);
    const revision = requireRevision(body ?? {});

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
    if (list[index].type !== 'CHARACTER') {
      throw new HttpError(400, 'Only encounter characters can be removed here.', 'CHARACTER_COMBATANT_REQUIRED');
    }

    const next = [...list.slice(0, index), ...list.slice(index + 1)];
    const saved = await saveCombatants(admin, encounterId, encounter, next, revision);
    return { status: 'success', data: { removed_combatant_id: combatantId, encounter_revision: saved.revision } };
  });
});
