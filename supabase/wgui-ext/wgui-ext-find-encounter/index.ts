// @ts-ignore
import { serve } from 'std/server';
import type { Encounter } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaign, encounterIncludesCharacter } from '../_wgui-ext/shared.ts';

interface FindCampaignEncountersBody {
  campaign_id?: number;
  id?: number | number[];
}

/**
 * Campaign encounters, for the GM *or* for a player whose PC is in the fight.
 *
 * Stock find-encounter runs on the caller's JWT against an owner-only policy, so it
 * returns [] for every player. This endpoint authorizes campaign membership explicitly
 * and then reads with the service role. Encounter rows are returned unredacted: the
 * product requirement is that a player opens the identical view the GM has, so there is
 * one payload and one component tree rather than a reduced player variant.
 *
 * Standalone (non-campaign) encounters are out of scope — they stay on find-encounter
 * and its owner policy.
 *
 * Lives in the WandersGuideUI repo and is bind-mounted into the edge runtime; the
 * `../_shared/*` imports resolve to the wanderers-guide modules inside the container.
 */
serve(async (req: Request) => {
  return await connect<FindCampaignEncountersBody>(req, async (client, body, token) => {
    const { campaign_id, id } = body ?? {};

    const ids = id === undefined || id === null ? [] : Array.isArray(id) ? id : [id];
    if (campaign_id === undefined || campaign_id === null) {
      // Never resolve by encounter id alone: the campaign is what the caller is
      // authorized against, and taking it from the row would let any member of any
      // campaign fetch a row and have it self-authorize.
      throw new HttpError(400, 'A campaign_id is required.', 'CAMPAIGN_ID_REQUIRED');
    }

    const admin = createServiceClient();
    const access = await authorizeCampaign(client, admin, token, campaign_id);

    const results = await fetchData<Encounter>(admin, 'encounter', [
      { column: 'campaign_id', value: campaign_id },
      { column: 'id', value: ids.length > 0 ? ids : undefined },
    ]);

    // Belt and braces: fetchData drops an undefined filter, so re-assert the scope the
    // caller was actually authorized for.
    const scoped = results.filter((encounter) => encounter.campaign_id === campaign_id);

    const visible = access.isGm
      ? scoped
      : scoped.filter((encounter) => encounterIncludesCharacter(encounter, access.characterIds));

    return {
      status: 'success',
      data: visible.sort((a, b) => a.id - b.id),
    };
  });
});
