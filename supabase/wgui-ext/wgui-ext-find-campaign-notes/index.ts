// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaign } from '../_wgui-ext/shared.ts';
import { notesFromCampaign, toPageDto } from '../_wgui-ext/campaign-notes.ts';

interface FindCampaignNotesBody {
  campaign_id?: number;
}

/**
 * Return campaign notes without exposing the rest of the campaign row.
 * GMs receive every page; members receive only pages explicitly marked shared.
 */
serve(async (req: Request) => {
  return await connect<FindCampaignNotesBody>(req, async (client, body, token) => {
    const { campaign_id } = body ?? {};
    if (campaign_id === undefined || campaign_id === null) {
      throw new HttpError(400, 'A campaign_id is required.', 'CAMPAIGN_ID_REQUIRED');
    }

    const admin = createServiceClient();
    const access = await authorizeCampaign(client, admin, token, campaign_id);
    const campaigns = await fetchData<Record<string, unknown>>(admin, 'campaign', [
      { column: 'id', value: campaign_id },
    ]);
    const campaign = campaigns[0];
    if (!campaign) {
      throw new HttpError(404, 'Campaign not found.', 'CAMPAIGN_NOT_FOUND');
    }

    const notes = notesFromCampaign(campaign);
    const pages = notes.pages
      .map((page, index) => toPageDto(page, index))
      .filter((page) => access.isGm || page.shared === true);

    return {
      status: 'success',
      data: { campaign_id, pages },
    };
  });
});
