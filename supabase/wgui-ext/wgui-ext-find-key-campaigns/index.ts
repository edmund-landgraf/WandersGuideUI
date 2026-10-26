// @ts-ignore
import { serve } from 'std/server';
import { HttpError } from '../_shared/http-errors.ts';
import { loadCharacterSummaries, serveKeyScoped } from '../_wgui-ext/key-auth.ts';

interface Body {
  campaign_id?: number | string | null;
}

/**
 * POST {}                 -> data: { campaigns: [{ id, name, character_ids: number[] }] }
 *   The campaigns the caller's visible characters belong to, with names.
 * POST { campaign_id: N } -> data: { campaign: { id, name }, characters: KeyCharacterSummary[] }
 *   That campaign's characters the caller may see. 403 if none are (or it doesn't exist),
 *   so campaign ids can't be probed.
 *
 * Visibility is the same as wgui-ext-list-key-characters (API key grants, or a user's own
 * PCs). Campaign rows are read with the service role; only id and name leave the server.
 */
serve((req: Request) =>
  serveKeyScoped<Body>(req, 'wgui-ext-find-key-campaigns', async (caller, body, admin) => {
    const visible = await loadCharacterSummaries(admin, caller.characterIds);
    const requested = body?.campaign_id;

    if (requested === undefined || requested === null || requested === '') {
      const byCampaign = new Map<number, number[]>();
      for (const c of visible) {
        if (c.campaign_id === null) continue;
        byCampaign.set(c.campaign_id, [...(byCampaign.get(c.campaign_id) ?? []), c.id]);
      }
      const ids = [...byCampaign.keys()];
      const names = new Map<number, string>();
      if (ids.length > 0) {
        const { data, error } = await admin.from('campaign').select('id, name').in('id', ids);
        if (error) throw new HttpError(500, 'Failed to load campaigns.', 'CAMPAIGN_LOOKUP_FAILED');
        for (const row of (data ?? []) as { id: number; name: string }[]) names.set(row.id, row.name);
      }
      return {
        campaigns: ids
          .sort((a, b) => a - b)
          .map((id) => ({ id, name: names.get(id) ?? null, character_ids: byCampaign.get(id)! })),
      };
    }

    const campaignId = Number(requested);
    if (!Number.isInteger(campaignId)) {
      throw new HttpError(400, 'campaign_id must be an integer.', 'CAMPAIGN_ID_INVALID');
    }
    const characters = visible.filter((c) => c.campaign_id === campaignId);
    if (characters.length === 0) {
      throw new HttpError(403, 'You do not have access to this campaign.', 'CAMPAIGN_FORBIDDEN');
    }
    const { data } = await admin.from('campaign').select('id, name').eq('id', campaignId).maybeSingle();
    return { campaign: { id: campaignId, name: (data as any)?.name ?? null }, characters };
  })
);