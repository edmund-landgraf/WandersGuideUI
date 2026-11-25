// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaignCopy } from '../_wgui-ext/shared.ts';

type CopyBody = { campaign_id?: number; operation_id?: string; art_map?: Record<string, string>; prepare?: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  return await connect<CopyBody>(req, async (client, body, token) => {
    const campaignId = body?.campaign_id;
    const operationId = body?.operation_id;
    if (typeof campaignId !== 'number' || !Number.isSafeInteger(campaignId) || campaignId <= 0 ||
        typeof operationId !== 'string' || !UUID.test(operationId) ||
        (body?.prepare !== undefined && typeof body.prepare !== 'boolean') ||
        (body?.art_map !== undefined && (!body.art_map || typeof body.art_map !== 'object' || Array.isArray(body.art_map) ||
          Object.values(body.art_map).some((url) => typeof url !== 'string' || !url.trim())))) {
      throw new HttpError(400, 'Invalid campaign copy request.', 'INVALID_COPY_REQUEST');
    }

    const admin = createServiceClient();
    // Both preparation and commit require explicit copy authorization.
    const access = await authorizeCampaignCopy(client, admin, token, campaignId);
    const { data, error } = await admin.rpc('wgui_copy_campaign_atomic', {
      p_user_id: access.userId,
      p_source_id: campaignId,
      p_operation_id: operationId,
      p_art_map: body?.art_map ?? {},
      p_prepare: body?.prepare === true,
    });
    if (error?.code === '42501') {
      throw new HttpError(403, 'The game master has not enabled campaign copying.', 'CAMPAIGN_COPY_FORBIDDEN');
    }
    if (error || !data) {
      console.error('Campaign copy transaction failed', error?.code);
      throw new HttpError(500, 'Campaign copy could not be confirmed. Retry to refresh the artwork manifest and recover the same operation.', 'CAMPAIGN_COPY_FAILED');
    }
    return { status: 'success', data };
  });
});
