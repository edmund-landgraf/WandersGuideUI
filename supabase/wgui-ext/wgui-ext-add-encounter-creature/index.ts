// @ts-ignore
import { serve } from 'std/server';
import type { Encounter } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { creatureForEncounter, placeCreature, type RosterCombatant } from '../_wgui-ext/creature-roster.ts';
import {
  type CombatantCommand,
  combatantsOf,
  loadAuthorizedEncounter,
  requireCampaignId,
  requireEncounterId,
  requireGm,
  requireId,
  requireRevision,
  saveCombatants,
} from '../_wgui-ext/encounter-command.ts';

type AddCreatureBody = {
  campaign_id?: unknown;
  encounter_id?: unknown;
  creature_id?: unknown;
  ally?: unknown;
  encounter_revision?: unknown;
};

serve(async (req: Request) => {
  return await connect<AddCreatureBody>(req, async (client, body, token) => {
    const campaignId = requireCampaignId(body ?? {});
    const encounterId = requireEncounterId(body ?? {});
    const creatureId = requireId(body?.creature_id, 'CREATURE_ID_REQUIRED', 'creature_id');
    const revision = requireRevision(body ?? {});
    if (body?.ally !== undefined && typeof body.ally !== 'boolean') {
      throw new HttpError(400, 'ally must be a boolean.', 'INVALID_ALLY');
    }
    const ally = body?.ally === true;

    const admin = createServiceClient();
    const { access, encounter } = await loadAuthorizedEncounter(client, admin, token, campaignId, encounterId);
    requireGm(access.isGm);

    const creatures = await fetchData<Record<string, unknown>>(admin, 'creature', [{ column: 'id', value: creatureId }]);
    const creature = creatures[0];
    if (!creature) throw new HttpError(404, 'Creature not found.', 'CREATURE_NOT_FOUND');
    if (creature.deprecated === true) throw new HttpError(400, 'That creature is deprecated.', 'CREATURE_NOT_AVAILABLE');
    if (creature.level === -100) throw new HttpError(400, 'That creature cannot be added to an encounter.', 'CREATURE_NOT_AVAILABLE');

    const incoming: RosterCombatant = {
      _id: crypto.randomUUID(),
      type: 'CREATURE',
      ally,
      creature: creatureForEncounter(creature),
    };
    const next = placeCreature(combatantsOf(encounter) as RosterCombatant[], incoming);
    const saved = await saveCombatants(admin, encounterId, encounter as Encounter, next as CombatantCommand[], revision);
    return { status: 'success', data: { combatant: saved.list[saved.list.length - 1], encounter_revision: saved.revision } };
  });
});
