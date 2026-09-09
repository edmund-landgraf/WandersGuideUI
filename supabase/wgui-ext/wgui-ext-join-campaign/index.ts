// @ts-ignore
import { serve } from 'std/server';
import type { Campaign, Character } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { requireCallerId } from '../_wgui-ext/shared.ts';

interface JoinCampaignBody {
  character_id?: number;
  join_key?: string;
}

function toId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function withoutJoinKey(campaign: Campaign): Campaign {
  const { join_key: _omitted, ...rest } = campaign;
  return rest as Campaign;
}

/**
 * Attach the caller's character to a campaign they proved they know the join key for.
 *
 * Stock join is find-campaign({ join_key }) then update-character({ campaign_id }). The
 * membership trigger only keeps that write when a campaign_join_grant row exists (or
 * the caller owns the campaign). The grant is best-effort in find-campaign, so a successful
 * key lookup can still leave campaign_id unchanged while the UI reports "added". This
 * endpoint checks the key and writes campaign_id with the service-role client after
 * verifying the character belongs to the caller.
 */
serve(async (req: Request) => {
  return await connect<JoinCampaignBody>(req, async (client, body, token) => {
    const characterId = toId(body?.character_id);
    const joinKey = typeof body?.join_key === 'string' ? body.join_key.trim() : '';
    if (characterId === null) {
      throw new HttpError(400, 'A character_id is required.', 'CHARACTER_ID_REQUIRED');
    }
    if (!joinKey) {
      throw new HttpError(400, 'Enter a join key.', 'JOIN_KEY_REQUIRED');
    }

    const userId = await requireCallerId(client, token);
    const admin = createServiceClient();

    const campaigns = await fetchData<Campaign>(admin, 'campaign', [
      { column: 'join_key', value: joinKey },
    ]);
    const campaign = campaigns[0];
    if (!campaign) {
      throw new HttpError(400, 'Invalid join key. Please ask your GM for a valid key.', 'JOIN_KEY_INVALID');
    }

    const characters = await fetchData<Character>(admin, 'character', [
      { column: 'id', value: characterId },
    ]);
    const character = characters[0];
    if (!character || character.user_id !== userId) {
      throw new HttpError(403, 'You do not have access to this character.', 'CHARACTER_FORBIDDEN');
    }

    const already = toId(character.campaign_id) === campaign.id;
    if (!already) {
      const { error } = await admin
        .from('character')
        .update({ campaign_id: campaign.id })
        .eq('id', characterId)
        .eq('user_id', userId);
      if (error) throw error;
    }

    const updated = await fetchData<Character>(admin, 'character', [
      { column: 'id', value: characterId },
    ]);
    const saved = updated[0];
    if (!saved || toId(saved.campaign_id) !== campaign.id) {
      throw new HttpError(500, 'Could not add that character to the campaign.', 'JOIN_NOT_SAVED');
    }

    return {
      status: 'success',
      data: { character: saved, campaign: withoutJoinKey(campaign), already },
    };
  });
});
