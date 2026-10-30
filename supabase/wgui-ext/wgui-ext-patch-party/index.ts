// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaign, sameNumericId } from '../_wgui-ext/shared.ts';

interface PatchPartyBody {
  campaign_id?: number;
  party_ids?: number[];
}

function playersMayManageParty(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return true;
  const settings = (meta as { settings?: { players_manage_party?: unknown } }).settings;
  return settings?.players_manage_party !== false;
}

/**
 * Replace campaign.meta_data.party_ids and nothing else.
 *
 * Adding or removing a PC from the party bench does not delete a character or
 * change the encounter roster. The game master can always do it. A player can
 * do it when settings.players_manage_party is omitted or true.
 */
serve(async (req: Request) => {
  return await connect<PatchPartyBody>(req, async (client, body, token) => {
    const { campaign_id, party_ids } = body ?? {};
    if (campaign_id === undefined || campaign_id === null) {
      throw new HttpError(400, 'A campaign_id is required.', 'CAMPAIGN_ID_REQUIRED');
    }
    if (!Array.isArray(party_ids) || party_ids.some((id) => !Number.isInteger(id))) {
      throw new HttpError(400, 'party_ids must be an array of character ids.', 'PARTY_IDS_REQUIRED');
    }

    const admin = createServiceClient();
    const access = await authorizeCampaign(client, admin, token, campaign_id);
    const meta = (access.campaign as { meta_data?: unknown }).meta_data;
    if (!access.isGm && !playersMayManageParty(meta)) {
      throw new HttpError(403, 'Only the game master can change the party.', 'PARTY_FORBIDDEN');
    }

    const members = await fetchData<{ id: number; campaign_id?: number | null }>(admin, 'character', [
      { column: 'campaign_id', value: campaign_id },
    ]);
    const memberIds = new Set(
      members
        .filter((character) => sameNumericId(character.campaign_id, campaign_id))
        .map((character) => character.id)
        .filter((id) => Number.isInteger(id)),
    );
    const nextIds = [...new Set(party_ids)];
    if (nextIds.some((id) => !memberIds.has(id))) {
      throw new HttpError(400, 'Every party id must be a character in this campaign.', 'PARTY_ID_UNKNOWN');
    }

    const previous = meta && typeof meta === 'object' ? meta as Record<string, unknown> : {};
    const meta_data = { ...previous, party_ids: nextIds };
    const { error } = await admin.from('campaign').update({ meta_data }).eq('id', campaign_id);
    if (error) throw error;

    return {
      status: 'success',
      data: { campaign_id, party_ids: nextIds },
    };
  });
});
