// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { requireCallerId } from '../_wgui-ext/shared.ts';
import { requireEncounterId, requireRevision } from '../_wgui-ext/encounter-command.ts';

type SaveBody = { encounter_id?: unknown; encounter_revision?: unknown; patch?: unknown };
serve(async (req: Request) => {
  return await connect<SaveBody>(req, async (client, body, token) => {
    const caller = await requireCallerId(client,token);
    const encounterId = requireEncounterId(body ?? {});
    const revision = requireRevision(body ?? {});
    if (!body?.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      throw new HttpError(400,'An encounter patch is required.','INVALID_ENCOUNTER_PATCH');
    }
    const admin = createServiceClient();
    const { data,error } = await admin.rpc('wgui_save_encounter_revision',{
      p_user_id:caller,p_encounter_id:encounterId,p_revision:revision,p_patch:body.patch,
    });
    if (error?.code === '40001') throw new HttpError(409,'Encounter changed in another browser. Reload it and retry.','ENCOUNTER_REVISION_CONFLICT');
    if (error?.code === '42501') throw new HttpError(403,'You do not have access to update this encounter.','ENCOUNTER_FORBIDDEN');
    if (error?.code === '22023' || error?.code === '22003') throw new HttpError(400,'Invalid encounter update.','INVALID_ENCOUNTER_PATCH');
    if (error || !data) throw new HttpError(503,'Encounter save could not be confirmed. Reload before retrying.','ENCOUNTER_SAVE_UNAVAILABLE');
    return {status:'success',data};
  });
});
