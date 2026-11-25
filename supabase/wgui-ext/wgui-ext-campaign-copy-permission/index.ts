// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaign, authorizeCampaignRead, campaignCopyEnabled } from '../_wgui-ext/shared.ts';

type Body = { campaign_id?: number; enabled?: boolean };

serve(async (req: Request) => {
  return await connect<Body>(req, async (client, body, token) => {
    const id = body?.campaign_id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        (body?.enabled !== undefined && typeof body.enabled !== 'boolean')) {
      throw new HttpError(400, 'Invalid campaign copy permission request.', 'INVALID_COPY_PERMISSION');
    }
    const admin = createServiceClient();
    // No permission writes through ordinary campaign metadata, even for members.
    if (body?.enabled !== undefined) {
      const access = await authorizeCampaign(client, admin, token, id);
      if (!access.isGm) throw new HttpError(403, 'Only the campaign owner can change copy permission.', 'COPY_PERMISSION_FORBIDDEN');
      const { error } = await admin.rpc('wgui_set_campaign_copy_permission', {
        p_user_id: access.userId, p_campaign_id: id, p_enabled: body.enabled,
      });
      if (error?.code === '42501') throw new HttpError(403, 'Only the campaign owner can change copy permission.', 'COPY_PERMISSION_FORBIDDEN');
      if (error) throw new HttpError(503, 'Could not save campaign copy permission.', 'COPY_PERMISSION_UNAVAILABLE');
      return { status: 'success', data: { enabled: body.enabled, canCopy: true } };
    }
    const access = await authorizeCampaignRead(client, admin, token, id);
    const enabled = await campaignCopyEnabled(admin, access);
    return { status: 'success', data: { enabled, canCopy: access.isGm || enabled } };
  });
});
