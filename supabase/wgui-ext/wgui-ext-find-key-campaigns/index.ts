// @ts-ignore
import { serve } from 'std/server';
import { HttpError } from '../_shared/http-errors.ts';
import {
  campaignCharacterIds,
  loadCharacterSummaries,
  ownedCampaigns,
  playerNames,
  serveKeyScoped,
} from '../_wgui-ext/key-auth.ts';

interface Body {
  campaign_id?: number | string | null;
}

/**
 * POST {}                 -> data: { campaigns: [{ id, name, character_ids: number[], owned }] }
 *   Campaigns the caller's own visible characters belong to, plus every campaign the caller
 *   OWNS (GM). For an owned campaign character_ids is every PC that joined it.
 * POST { campaign_id: N } -> data: { campaign: { id, name, owned }, characters: KeyCharacterSummary[] }
 *   GM (caller's user owns campaign N): every PC whose campaign_id is N, from any player,
 *   each with a `player` display name. Those players' other PCs are never included.
 *   Otherwise: only the caller's own visible PCs in N. 403 if there are none (or N doesn't
 *   exist), so campaign ids can't be probed.
 *
 * Non-GM visibility is the same as wgui-ext-list-key-characters (API key grants, or a user's
 * own PCs). Campaign rows are read with the service role; only id and name leave the server.
 */
serve((req: Request) =>
  serveKeyScoped<Body>(req, 'wgui-ext-find-key-campaigns', async (caller, body, admin) => {
    const owned = await ownedCampaigns(admin, caller.userId);
    const ownedIds = new Set(owned.map((c) => c.id));
    const requested = body?.campaign_id;

    if (requested === undefined || requested === null || requested === '') {
      const visible = await loadCharacterSummaries(admin, caller.characterIds);
      const byCampaign = new Map<number, number[]>();
      for (const c of visible) {
        if (c.campaign_id === null) continue;
        byCampaign.set(c.campaign_id, [...(byCampaign.get(c.campaign_id) ?? []), c.id]);
      }
      for (const [id, ids] of await campaignCharacterIds(admin, [...ownedIds])) byCampaign.set(id, ids);
      const ids = [...byCampaign.keys()];
      const names = new Map<number, string>(owned.map((c) => [c.id, c.name]));
      const missing = ids.filter((id) => !names.has(id));
      if (missing.length > 0) {
        const { data, error } = await admin.from('campaign').select('id, name').in('id', missing);
        if (error) throw new HttpError(500, 'Failed to load campaigns.', 'CAMPAIGN_LOOKUP_FAILED');
        for (const row of (data ?? []) as { id: number; name: string }[]) names.set(row.id, row.name);
      }
      return {
        campaigns: ids
          .sort((a, b) => a - b)
          .map((id) => ({ id, name: names.get(id) ?? null, character_ids: byCampaign.get(id)!, owned: ownedIds.has(id) })),
      };
    }

    const campaignId = Number(requested);
    if (!Number.isInteger(campaignId)) {
      throw new HttpError(400, 'campaign_id must be an integer.', 'CAMPAIGN_ID_INVALID');
    }
    if (ownedIds.has(campaignId)) {
      const ids = (await campaignCharacterIds(admin, [campaignId])).get(campaignId) ?? [];
      const players = await playerNames(admin, ids);
      const characters = (await loadCharacterSummaries(admin, ids))
        .filter((c) => c.campaign_id === campaignId)
        .map((c) => ({ ...c, player: players.get(c.id) ?? null }));
      const name = owned.find((c) => c.id === campaignId)?.name ?? null;
      return { campaign: { id: campaignId, name, owned: true }, characters };
    }
    const visible = await loadCharacterSummaries(admin, caller.characterIds);
    const characters = visible.filter((c) => c.campaign_id === campaignId);
    if (characters.length === 0) {
      throw new HttpError(403, 'You do not have access to this campaign.', 'CAMPAIGN_FORBIDDEN');
    }
    const { data } = await admin.from('campaign').select('id, name').eq('id', campaignId).maybeSingle();
    return { campaign: { id: campaignId, name: (data as any)?.name ?? null, owned: false }, characters };
  })
);
