// @ts-ignore
import { serve } from 'std/server';
import type { Campaign, Character } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { requireCallerId, sameUserId } from '../_wgui-ext/shared.ts';

interface OwnerEmailBody {
  user_ids?: string[];
}

/**
 * Email and display name for campaign owners the caller already plays with.
 *
 * `public_user` has a display name and no email. Auth holds the address, so this
 * reads it with the service role only when the caller owns that user's campaign
 * or has a character in one of them.
 */
serve(async (req: Request) => {
  return await connect<OwnerEmailBody>(req, async (client, body, token) => {
    const callerId = await requireCallerId(client, token);
    const requested = [...new Set((body?.user_ids ?? []).map((id) => id.trim()).filter(Boolean))].slice(0, 24);
    if (requested.length === 0) {
      return { status: 'success', data: [] };
    }

    const admin = createServiceClient();
    const [ownedCampaigns, myCharacters] = await Promise.all([
      fetchData<Campaign>(admin, 'campaign', [{ column: 'user_id', value: callerId }]),
      fetchData<Character>(admin, 'character', [{ column: 'user_id', value: callerId }]),
    ]);
    const joinedCampaignIds = new Set(
      myCharacters.map((character) => character.campaign_id).filter((id): id is number => typeof id === 'number')
    );

    const rows: { user_id: string; email: string; display_name: string }[] = [];
    for (const userId of requested) {
      const allowed = sameUserId(userId, callerId) || (await callerKnowsOwner(admin, userId, ownedCampaigns, joinedCampaignIds));
      if (!allowed) continue;
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data?.user) continue;
      const meta = data.user.user_metadata ?? {};
      const named = [meta.display_name, meta.name, meta.full_name].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
      rows.push({
        user_id: userId,
        email: data.user.email ?? '',
        display_name: named?.trim() || '',
      });
    }

    return { status: 'success', data: rows };
  });
});

async function callerKnowsOwner(
  admin: ReturnType<typeof createServiceClient>,
  ownerId: string,
  ownedCampaigns: Campaign[],
  joinedCampaignIds: Set<number>
): Promise<boolean> {
  const campaigns = await fetchData<Campaign>(admin, 'campaign', [{ column: 'user_id', value: ownerId }]);
  if (campaigns.some((campaign) => ownedCampaigns.some((owned) => owned.id === campaign.id))) return true;
  return campaigns.some((campaign) => joinedCampaignIds.has(campaign.id));
}
