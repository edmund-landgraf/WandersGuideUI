/**
 * Dry-run a Phase 1 campaign copy: loads the source campaign, counts encounters and
 * notes, and reports whether campaign art would be re-hosted. No rows are written.
 *
 *   CAMPAIGN_COPY_TOKEN=<jwt> npm run dry-run:campaign-copy -- 41
 */

import { executeCampaignCopy, loadCampaignById } from '../src/pages/phase1/phase1-campaign-copy';
import { loadPhase1CampaignPlayers } from '../src/pages/phase1/phase1-api';

const campaignId = Number(process.argv[2]);
const token = process.env.CAMPAIGN_COPY_TOKEN?.trim();
const userId = process.env.CAMPAIGN_COPY_USER_ID?.trim();

if (!Number.isFinite(campaignId) || campaignId <= 0) {
  console.error('Usage: CAMPAIGN_COPY_TOKEN=<jwt> npm run dry-run:campaign-copy -- <campaignId>');
  process.exit(2);
}
if (!token) {
  console.error('Set CAMPAIGN_COPY_TOKEN to a signed-in user JWT.');
  process.exit(2);
}
if (!userId) {
  console.error('Set CAMPAIGN_COPY_USER_ID to the same user id as the JWT (sub claim).');
  process.exit(2);
}

const source = await loadCampaignById(campaignId, token);
if (!source) {
  console.error(`Campaign ${campaignId} was not found or is not visible to this token.`);
  process.exit(1);
}

const players = await loadPhase1CampaignPlayers(campaignId, userId, token);
const { plan } = await executeCampaignCopy({
  source,
  campaignId,
  accessToken: token,
  userId,
  players,
  dryRun: true,
});

console.log(JSON.stringify({ campaign: source.name, ...plan }, null, 2));