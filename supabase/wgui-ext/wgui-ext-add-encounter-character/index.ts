// @ts-ignore
import { serve } from 'std/server';
import type { Character, Encounter } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import {
  combatantsOf,
  characterIdOf,
  loadAuthorizedEncounter,
  requireCampaignId,
  requireEncounterId,
  requireGm,
  requireRevision,
  requireId,
  saveCombatants,
} from '../_wgui-ext/encounter-command.ts';

type AddBody = {
  campaign_id?: unknown;
  encounter_id?: unknown;
  character_id?: unknown;
  encounter_revision?: unknown;
};

serve(async (req: Request) => {
  return await connect<AddBody>(req, async (client, body, token) => {
    const campaignId = requireCampaignId(body ?? {});
    const encounterId = requireEncounterId(body ?? {});
    const characterId = requireId(body?.character_id, 'CHARACTER_ID_REQUIRED', 'character_id');
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

    const characters = await fetchData<Character>(admin, 'character', [
      { column: 'id', value: characterId },
      { column: 'campaign_id', value: campaignId },
    ]);
    const character = characters[0];
    if (!character) {
      throw new HttpError(
        403,
        'That character is not joined to this campaign.',
        'CHARACTER_NOT_IN_CAMPAIGN'
      );
    }

    const list = combatantsOf(encounter);
    if (list.some((combatant) => characterIdOf(combatant) === characterId)) {
      throw new HttpError(409, 'That character is already in the encounter.', 'CHARACTER_ALREADY_IN_ENCOUNTER');
    }

    const next = [
      ...list,
      {
        _id: crypto.randomUUID(),
        type: 'CHARACTER',
        ally: true,
        initiative: undefined,
        character: characterId,
        data: undefined,
      },
    ];
    const saved = await saveCombatants(admin, encounterId, encounter, next, revision);
    return { status: 'success', data: { combatant: saved.list[saved.list.length - 1], encounter_revision: saved.revision } };
  });
});
