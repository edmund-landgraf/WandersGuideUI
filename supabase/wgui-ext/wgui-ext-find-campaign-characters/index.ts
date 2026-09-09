// @ts-ignore
import { serve } from 'std/server';
import type { Character } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaign } from '../_wgui-ext/shared.ts';

interface FindCampaignCharactersBody {
  campaign_id?: number;
}

/**
 * Every character in a campaign, for any member of it.
 *
 * The character SELECT policy covers self, public, admin and the campaign owner — not
 * fellow players. So a player calling find-character({ campaign_id }) gets only their own
 * PCs, and the encounter grid would fall back to the stale `combatant.data` snapshot for
 * allies. This endpoint serves the same rows the GM already receives so both roles render
 * from one payload.
 *
 * That is a deliberate privacy expansion over the original app: party members see each
 * other's full sheets. If it ever needs narrowing, strip the same fields for the GM too,
 * so the view stays a single shape.
 *
 * Lives in the WandersGuideUI repo and is bind-mounted into the edge runtime; the
 * `../_shared/*` imports resolve to the wanderers-guide modules inside the container.
 */
serve(async (req: Request) => {
  return await connect<FindCampaignCharactersBody>(req, async (client, body, token) => {
    const { campaign_id } = body ?? {};
    if (campaign_id === undefined || campaign_id === null) {
      throw new HttpError(400, 'A campaign_id is required.', 'CAMPAIGN_ID_REQUIRED');
    }

    const admin = createServiceClient();
    await authorizeCampaign(client, admin, token, campaign_id);

    const results = await fetchData<Character>(admin, 'character', [
      { column: 'campaign_id', value: campaign_id },
    ]);

    return {
      status: 'success',
      data: results.sort((a, b) => a.id - b.id),
    };
  });
});
