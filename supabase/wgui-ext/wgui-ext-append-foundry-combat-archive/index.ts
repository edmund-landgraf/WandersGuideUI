// @ts-ignore
import { serve } from 'std/server';
import { serveKeyScoped } from '../_wgui-ext/key-auth.ts';
import { requireCampaignId, requireEncounterId } from '../_wgui-ext/encounter-command.ts';
import { FoundryArchiveValidationError, validateFoundryArchive } from '../_wgui-ext/foundry-combat-archive.ts';
import { HttpError } from '../_shared/http-errors.ts';

type ArchiveBody = { campaign_id?: unknown; encounter_id?: unknown; archive?: unknown };
serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'OPTIONS') return new Response(null, { status: 405 });
  return serveKeyScoped<ArchiveBody>(req, 'wgui-ext-append-foundry-combat-archive', async (caller, body, admin) => {
    const campaignId = requireCampaignId(body ?? {});
    const encounterId = requireEncounterId(body ?? {});
    let archive: ReturnType<typeof validateFoundryArchive>;
    try { archive = validateFoundryArchive(body?.archive); }
    catch (error) {
      if (error instanceof FoundryArchiveValidationError) throw new HttpError(400, error.message, 'INVALID_COMBAT_ARCHIVE');
      throw error;
    }
    // The service-role-only RPC independently verifies current GM ownership and
    // encounter membership under row locks, not merely an edge-side precheck.
    const { data, error } = await admin.rpc('wgui_append_foundry_combat_archive', {
      p_user_id: caller.userId, p_campaign_id: campaignId, p_encounter_id: encounterId, p_archive: archive,
    });
    if (error) {
      if (error.code === '42501') throw new HttpError(403, 'Campaign GM authorization required.', 'GM_REQUIRED');
      if (error.code === '23505') throw new HttpError(409, 'This export ID was already used with different content.', 'ARCHIVE_CONFLICT');
      if (error.code === '22023') throw new HttpError(400, 'Invalid archive.', 'INVALID_COMBAT_ARCHIVE');
      if (error.code === '54000') throw new HttpError(409, 'Encounter archive capacity reached.', 'ARCHIVE_LIMIT');
      throw new HttpError(503, 'Archive could not be saved. Retry the same export.', 'ARCHIVE_UNAVAILABLE');
    }
    return data;
  });
});
