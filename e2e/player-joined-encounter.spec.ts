import { expect, test } from '@playwright/test';
import { ensureUser, invokeEdge, pageAccessToken, signInPhase1, uniqueUser } from './auth';

type EncounterRow = { id: number; combatants?: { list: unknown[] } };

test('joined player can see the encounter their PC is on', async ({ browser, request }) => {
  test.setTimeout(360_000);

  const gm = process.env.E2E_GM_EMAIL
    ? { email: process.env.E2E_GM_EMAIL, password: process.env.E2E_GM_PASSWORD || 'E2ePass123!' }
    : uniqueUser('gm');
  const player = process.env.E2E_PLAYER_EMAIL
    ? { email: process.env.E2E_PLAYER_EMAIL, password: process.env.E2E_PLAYER_PASSWORD || 'E2ePass123!' }
    : uniqueUser('player');

  if (!process.env.E2E_GM_EMAIL) await ensureUser(request, gm);
  if (!process.env.E2E_PLAYER_EMAIL) await ensureUser(request, player);

  const gmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const gmPage = await gmContext.newPage();
  const playerPage = await playerContext.newPage();

  try {
    await signInPhase1(gmPage, gm);
    const gmToken = await pageAccessToken(gmPage);
    await gmPage.getByRole('button', { name: 'Create campaign' }).click();
    await expect(gmPage.locator('aside').getByText('Game master')).toBeVisible();

    await gmPage.locator('aside').getByRole('button', { name: /Encounters/i }).click({ button: 'right' });
    await gmPage.getByRole('menuitem', { name: 'New' }).click();
    await gmPage.getByRole('dialog', { name: 'New encounter' }).getByLabel('Encounter name').fill('E2E Fight');
    await gmPage.getByRole('dialog', { name: 'New encounter' }).getByRole('button', { name: 'Create' }).click();
    await expect(gmPage).toHaveURL(/\/phase1\/campaign\/\d+\/encounters\/\d+/);
    const ids = gmPage.url().match(/campaign\/(\d+)\/encounters\/(\d+)/);
    if (!ids) throw new Error(`Could not parse campaign/encounter ids from ${gmPage.url()}`);
    const campaignId = Number(ids[1]);
    const encounterId = Number(ids[2]);

    await gmPage.getByRole('banner').getByRole('link', { name: 'Campaigns' }).click();
    await gmPage.getByRole('heading', { name: 'Campaign workspace' }).waitFor();
    const copyBtn = gmPage.getByTitle('Reveal and copy join key');
    await copyBtn.click();
    await expect(copyBtn).not.toHaveText('Copy key');
    const joinKey = ((await copyBtn.innerText()) || '').trim();
    expect(joinKey.length).toBeGreaterThan(4);

    await signInPhase1(playerPage, player);
    const playerToken = await pageAccessToken(playerPage);
    const character = await invokeEdge<{ id: number }>(request, 'create-character', {
      name: 'E2E Player',
      level: 1,
      meta_data: { reset_hp: true },
      details: {},
    }, playerToken);
    const campaigns = await invokeEdge<{ id: number }[] | { id: number }>(
      request,
      'find-campaign',
      { join_key: joinKey },
      playerToken
    );
    const joined = Array.isArray(campaigns) ? campaigns[0] : campaigns;
    if (!joined?.id) throw new Error(`Join key did not resolve a campaign: ${JSON.stringify(campaigns)}`);
    await invokeEdge(request, 'update-character', { id: character.id, campaign_id: joined.id }, playerToken);

    const encounterRows = await invokeEdge<EncounterRow[] | EncounterRow>(request, 'find-encounter', { id: encounterId }, gmToken);
    const encounter = Array.isArray(encounterRows) ? encounterRows[0] : encounterRows;
    if (!encounter?.id) throw new Error(`GM could not reload encounter ${encounterId}`);
    await invokeEdge(request, 'create-encounter', {
      ...encounter,
      combatants: {
        list: [
          ...(encounter.combatants?.list ?? []),
          { _id: crypto.randomUUID(), type: 'CHARACTER', ally: true, character: character.id },
        ],
      },
    }, gmToken);

    await playerPage.goto(`/phase1/campaign/${campaignId}`);
    await expect(playerPage.locator('aside').getByText('Player')).toBeVisible({ timeout: 30_000 });
    await expect(playerPage.getByRole('heading', { name: 'No encounter selected' })).toHaveCount(0);
    await expect(playerPage.locator('aside').getByText('E2E Fight')).toBeVisible();
    await expect(playerPage.getByText('No encounters are visible for this campaign.')).toHaveCount(0);
    await expect(playerPage.getByText('No combatants in this encounter.')).toHaveCount(0);
  } finally {
    await gmContext.close();
    await playerContext.close();
  }
});
