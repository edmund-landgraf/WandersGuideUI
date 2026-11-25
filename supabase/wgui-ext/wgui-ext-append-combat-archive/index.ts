// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { encounterRevision, loadAuthorizedEncounter, requireCampaignId, requireEncounterId, requireGm, saveEncounterFields } from '../_wgui-ext/encounter-command.ts';
import { appendCombatArchive, ArchiveContractError, validateCombatArchive } from '../_wgui-ext/combat-archive.ts';

type Body = { campaign_id?: unknown; encounter_id?: unknown; archive?: unknown };
serve(async (req: Request) => connect<Body>(req, async (client, body, token) => {
  const campaignId = requireCampaignId(body ?? {});
  const encounterId = requireEncounterId(body ?? {});
  const admin = createServiceClient();
  // Retry only the read/merge/CAS operation, never a stale snapshot replacement.
  const receiptId = crypto.randomUUID();
  const archivedAt = new Date().toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { access, encounter } = await loadAuthorizedEncounter(client, admin, token, campaignId, encounterId);
    requireGm(access.isGm);
    try {
      const archive = validateCombatArchive(body?.archive, campaignId, encounterId);
      const result = appendCombatArchive((encounter.meta_data ?? {}) as Record<string, unknown>, archive, receiptId, archivedAt);
      if (result.appended) await saveEncounterFields(admin, encounterId, encounter, {}, result.meta, encounterRevision(encounter));
      return { status: 'success', data: { ...result.receipt, campaign_id: campaignId, encounter_id: encounterId, worldId: archive.worldId, exportId: archive.exportId, appended: result.appended } };
    } catch (error) {
      if (error instanceof ArchiveContractError) throw new HttpError(error.status,error.message,error.code);
      // A revision race is safe to retry with a new authorized read. Other errors surface.
      if (error instanceof HttpError && (error as unknown as { code?: string }).code === 'ENCOUNTER_REVISION_CONFLICT' && attempt < 2) continue;
      throw error;
    }
  }
  throw new HttpError(409,'Encounter changed; retry the same export id.','ENCOUNTER_REVISION_CONFLICT');
}));
