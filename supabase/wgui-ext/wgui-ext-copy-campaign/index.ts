// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaignRead } from '../_wgui-ext/shared.ts';

type CopyBody = { campaign_id?: number; operation_id?: string; art_url?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  return await connect<CopyBody>(req, async (client, body, token) => {
    const campaignId = body?.campaign_id;
    const operationId = body?.operation_id;
    if (typeof campaignId !== 'number' || !Number.isSafeInteger(campaignId) || campaignId <= 0 ||
        typeof operationId !== 'string' || !UUID.test(operationId) ||
        (body?.art_url !== undefined && typeof body.art_url !== 'string')) {
      throw new HttpError(400, 'Invalid campaign copy request.', 'INVALID_COPY_REQUEST');
    }

    const admin = createServiceClient();
    // Use the existing full-copy read gate; #71 owns tightening copy authorization.
    const access = await authorizeCampaignRead(client, admin, token, campaignId);
    const { data, error } = await admin.rpc('wgui_copy_campaign_atomic', {
      p_user_id: access.userId,
      p_source_id: campaignId,
      p_operation_id: operationId,
      p_art_url: body?.art_url ?? null,
    });
    if (error || !data) {
      console.error('Campaign copy transaction failed', error?.code);
      throw new HttpError(500, 'Campaign copy could not be confirmed. Retry to recover the same operation.', 'CAMPAIGN_COPY_FAILED');
    }
    return { status: 'success', data };
  });
});
