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

/**
 * Campaign art as the WG UI stores it: campaign.meta_data.image_url (banner shown on the campaign
 * page/card) and meta_data.image_focus_y (vertical focus, 0-100). Older WG saves sometimes hold the
 * same URL pasted twice end to end; keep the first absolute http(s) URL. Anything else -> null.
 */
function campaignArt(meta: any): { image_url: string | null; image_focus_y: number | null } {
  const raw = typeof meta?.image_url === 'string' ? meta.image_url.trim() : '';
  let url: string | null = null;
  if (/^https?:\/\//i.test(raw)) {
    const second = raw.slice(1).search(/https?:\/\//i);
    url = second >= 0 ? raw.slice(0, second + 1) : raw;
  }
  const y = Number(meta?.image_focus_y);
  return { image_url: url, image_focus_y: Number.isFinite(y) ? y : null };
}

async function campaignRows(admin: any, ids: number[]): Promise<Map<number, { name: string | null; image_url: string | null; image_focus_y: number | null }>> {
  const out = new Map();
  if (ids.length === 0) return out;
  const { data, error } = await admin.from('campaign').select('id, name, meta_data').in('id', ids);
  if (error) throw new HttpError(500, 'Failed to load campaigns.', 'CAMPAIGN_LOOKUP_FAILED');
  for (const r of (data ?? []) as any[]) out.set(r.id, { name: r.name ?? null, ...campaignArt(r.meta_data) });
  return out;
}

interface Body {
  campaign_id?: number | string | null;
}

/**
 * POST {}                 -> data: { campaigns: [{ id, name, image_url, image_focus_y, character_ids: number[], owned }] }
 *   Campaigns the caller's own visible characters belong to, plus every campaign the caller
 *   OWNS (GM). For an owned campaign character_ids is every PC that joined it.
 * POST { campaign_id: N } -> data: { campaign: { id, name, image_url, image_focus_y, owned }, characters: KeyCharacterSummary[] }
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
      const rows = await campaignRows(admin, ids);
      return {
        campaigns: ids.sort((a, b) => a - b).map((id) => {
          const r = rows.get(id);
          return { id, name: r?.name ?? null, image_url: r?.image_url ?? null, image_focus_y: r?.image_focus_y ?? null, character_ids: byCampaign.get(id)!, owned: ownedIds.has(id) };
        }),
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
      const r = (await campaignRows(admin, [campaignId])).get(campaignId);
      return { campaign: { id: campaignId, name: r?.name ?? null, image_url: r?.image_url ?? null, image_focus_y: r?.image_focus_y ?? null, owned: true }, characters };
    }
    const visible = await loadCharacterSummaries(admin, caller.characterIds);
    const characters = visible.filter((c) => c.campaign_id === campaignId);
    if (characters.length === 0) {
      throw new HttpError(403, 'You do not have access to this campaign.', 'CAMPAIGN_FORBIDDEN');
    }
    const r = (await campaignRows(admin, [campaignId])).get(campaignId);
    return { campaign: { id: campaignId, name: r?.name ?? null, image_url: r?.image_url ?? null, image_focus_y: r?.image_focus_y ?? null, owned: false }, characters };
  })
);
