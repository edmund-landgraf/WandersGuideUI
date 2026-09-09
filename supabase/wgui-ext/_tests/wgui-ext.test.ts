// Guards the wgui-ext carve-out: campaign members read campaign encounters and the
// campaign roster through a service-role path, while the underlying owner-only
// `encounter` policy and the campaign-scoped `character` policy stay exactly as they
// were. Properties:
//   1. The GM sees every encounter in their campaign.
//   2. A player sees an encounter their PC is a combatant on, with the full payload.
//   3. A player does NOT see a campaign encounter their PC is not on.
//   4. A user with no character in the campaign is refused.
//   5. An unauthenticated caller is refused (the gateway policy is not load-bearing).
//   6. Stock find-encounter({ campaign_id }) as that same player still returns [] —
//      the extension did not weaken RLS.
//   7. The roster endpoint gives a player the other party members' rows, which stock
//      find-character({ campaign_id }) does not.
//
// Run with `npm run test:wgui-ext`, which starts a Deno container on the stack's docker
// network. The seed helpers below are deliberately inlined rather than imported from the
// wanderers-guide `_tests/seed.ts`, so this repo owns the extension end to end.

import { assert, assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const SUPABASE_URL =
  Deno.env.get('PUBLIC_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY =
  Deno.env.get('PUBLIC_ANON_KEY') ??
  Deno.env.get('ANON_KEY') ??
  Deno.env.get('SUPABASE_ANON_KEY') ??
  '';
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const TEST_EMAIL = Deno.env.get('TEST_EMAIL') ?? 'test@wanderersguide.app';
const TEST_PASSWORD = Deno.env.get('TEST_PASSWORD') ?? 'test1234';

// Session persistence and token auto-refresh start an interval the Deno test sanitizer
// flags as a resource leak.
const NO_BG_REFRESH = { auth: { persistSession: false, autoRefreshToken: false } };

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, NO_BG_REFRESH);

/** Skip rather than fail when the local stack env keys are not set. */
const skip = !SERVICE_ROLE_KEY || !ANON_KEY;

/** Sign in (or create then sign in) the canonical test user. */
async function ensureTestUser(): Promise<{ userId: string; jwt: string }> {
  const anon = createClient(SUPABASE_URL, ANON_KEY, NO_BG_REFRESH);
  let { data, error } = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (error || !data?.session) {
    const { error: createError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createError && !/already|exists|registered/i.test(createError.message)) throw createError;
    ({ data, error } = await anon.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }));
    if (error || !data?.session) throw error ?? new Error('Test user sign-in failed');
  }
  return { userId: data.user!.id, jwt: data.session!.access_token };
}

/**
 * POST an edge function. Each function gets its own worker, cold-started on first call,
 * and a loaded machine can 5xx or drop the connection on that first hit even though the
 * stack is healthy — retry those, since the real assertions run on the reply.
 */
async function callFunction(
  name: string,
  body: unknown,
  opts?: { token?: string }
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const MAX_TRIES = 3;
  let res: Response = undefined as unknown as Response;
  let text = '';
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      res = await fetch(`${FUNCTIONS_URL}/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
      });
      text = await res.text();
    } catch (err) {
      if (attempt === MAX_TRIES) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    if (res.status < 500 || attempt === MAX_TRIES) break;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function createSignedInUser(): Promise<{ userId: string; jwt: string }> {
  const email = `wgui-ext-${crypto.randomUUID().slice(0, 8)}@wanderersguide.test`;
  const password = 'test1234';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data?.user) throw error ?? new Error('failed to create user');

  // Sign in on a throwaway anon client: signing in on `admin` would replace its
  // service-role Authorization header with this user's token and quietly subject every
  // later fixture write in the file to RLS.
  const anon = createClient(SUPABASE_URL, ANON_KEY, NO_BG_REFRESH);
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session?.session) throw signInError ?? new Error('failed to sign in user');

  return { userId: data.user.id, jwt: session.session.access_token };
}

async function seedCampaign(ownerId: string) {
  const { data, error } = await admin
    .from('campaign')
    .insert({
      user_id: ownerId,
      name: `wgui-ext-camp-${crypto.randomUUID().slice(0, 8)}`,
      join_key: `key-${crypto.randomUUID().slice(0, 8)}`,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('failed to seed campaign');
  return data;
}

async function seedCharacter(ownerId: string, campaignId: number | null) {
  const { data, error } = await admin
    .from('character')
    .insert({
      user_id: ownerId,
      name: `wgui-ext-char-${crypto.randomUUID().slice(0, 8)}`,
      level: 1,
      campaign_id: campaignId,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('failed to seed character');
  return data;
}

async function seedEncounter(ownerId: string, campaignId: number, characterIds: number[]) {
  const { data, error } = await admin
    .from('encounter')
    .insert({
      user_id: ownerId,
      campaign_id: campaignId,
      name: `wgui-ext-enc-${crypto.randomUUID().slice(0, 8)}`,
      icon: 'sword',
      color: '#ff0000',
      meta_data: { party_level: 1, party_size: characterIds.length },
      combatants: {
        list: [
          ...characterIds.map((id) => ({
            _id: crypto.randomUUID(),
            type: 'CHARACTER',
            ally: true,
            character: id,
            initiative: 10,
          })),
          { _id: crypto.randomUUID(), type: 'CREATURE', ally: false, initiative: 5 },
        ],
      },
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('failed to seed encounter');
  return data;
}

Deno.test({
  name: 'wgui-ext: the GM sees every campaign encounter; a player sees only fights their PC is on',
  ignore: skip,
  async fn() {
    const gm = await createSignedInUser();
    const { userId: playerId, jwt: playerJwt } = await ensureTestUser();
    const campaign = await seedCampaign(gm.userId);
    const playerCharacter = await seedCharacter(playerId, campaign.id);
    const onFight = await seedEncounter(gm.userId, campaign.id, [playerCharacter.id]);
    const prepFight = await seedEncounter(gm.userId, campaign.id, []);

    try {
      const gmResult = await callFunction(
        'wgui-ext-find-encounter',
        { campaign_id: campaign.id },
        { token: gm.jwt }
      );
      assertEquals(gmResult.body?.status, 'success');
      assertEquals(
        (gmResult.body.data as { id: number }[]).map((e) => e.id).sort((a, b) => a - b),
        [onFight.id, prepFight.id].sort((a, b) => a - b),
        'the GM must see every encounter in their campaign'
      );

      const playerResult = await callFunction(
        'wgui-ext-find-encounter',
        { campaign_id: campaign.id },
        { token: playerJwt }
      );
      assertEquals(playerResult.body?.status, 'success');
      const visible = playerResult.body.data as {
        id: number;
        combatants: { list: unknown[] };
        meta_data: unknown;
      }[];
      assertEquals(
        visible.map((e) => e.id),
        [onFight.id],
        'a player sees the fight their PC is on and not the prep fight'
      );
      // "No dual view": the player's row is the GM's row, combatants and all.
      assertEquals(
        visible[0].combatants.list.length,
        2,
        'the player must receive the full combatant list, including the creature'
      );
      assert(visible[0].meta_data, 'the player must receive encounter meta_data');

      // The carve-out is the endpoint, not the policy: stock find-encounter is unchanged.
      const stock = await callFunction(
        'find-encounter',
        { campaign_id: campaign.id },
        { token: playerJwt }
      );
      assertEquals(stock.body?.status, 'success');
      assertEquals(
        stock.body.data,
        [],
        'stock find-encounter must still return nothing for a player — RLS was not weakened'
      );
    } finally {
      await admin.from('encounter').delete().in('id', [onFight.id, prepFight.id]);
      await admin.from('character').delete().eq('id', playerCharacter.id);
      await admin.from('campaign').delete().eq('id', campaign.id);
      await admin.auth.admin.deleteUser(gm.userId);
    }
  },
});

Deno.test({
  name: 'wgui-ext: non-members and unauthenticated callers are refused',
  ignore: skip,
  async fn() {
    const gm = await createSignedInUser();
    const outsider = await createSignedInUser();
    const campaign = await seedCampaign(gm.userId);
    // The outsider owns a character, just not one in this campaign.
    const strayCharacter = await seedCharacter(outsider.userId, null);
    const encounter = await seedEncounter(gm.userId, campaign.id, []);

    try {
      const refused = await callFunction(
        'wgui-ext-find-encounter',
        { campaign_id: campaign.id },
        { token: outsider.jwt }
      );
      assertEquals(refused.status, 403, 'knowing a campaign id must not grant access');
      assertEquals(refused.body?.status, 'fail');

      const refusedRoster = await callFunction(
        'wgui-ext-find-campaign-characters',
        { campaign_id: campaign.id },
        { token: outsider.jwt }
      );
      assertEquals(refusedRoster.status, 403, 'the roster endpoint uses the same gate');

      // verify_jwt is not enforced on the self-hosted gateway, so the handler must
      // reject an anonymous caller itself rather than assume the platform did.
      const anonymous = await callFunction('wgui-ext-find-encounter', {
        campaign_id: campaign.id,
      });
      assertEquals(anonymous.status, 401, 'an unauthenticated caller must be rejected');

      // A campaign that does not exist looks the same as one you are not in.
      const missing = await callFunction(
        'wgui-ext-find-encounter',
        { campaign_id: 0 },
        { token: outsider.jwt }
      );
      assertEquals(missing.status, 403, 'a missing campaign must not be distinguishable');

      const noCampaign = await callFunction(
        'wgui-ext-find-encounter',
        { id: encounter.id },
        { token: outsider.jwt }
      );
      assertEquals(noCampaign.status, 400, 'an encounter id alone must not self-authorize');
    } finally {
      await admin.from('encounter').delete().eq('id', encounter.id);
      await admin.from('character').delete().eq('id', strayCharacter.id);
      await admin.from('campaign').delete().eq('id', campaign.id);
      await admin.auth.admin.deleteUser(gm.userId);
      await admin.auth.admin.deleteUser(outsider.userId);
    }
  },
});

Deno.test({
  name: 'wgui-ext: ensure-public-user recreates a missing profile so create-campaign can find the caller',
  ignore: skip,
  async fn() {
    const user = await createSignedInUser();
    try {
      await admin.from('public_user').delete().eq('user_id', user.userId);

      const anonymous = await callFunction('wgui-ext-ensure-public-user', {});
      assertEquals(anonymous.status, 401, 'an unauthenticated caller must be rejected');

      const missing = await callFunction('create-campaign', { name: 'should-fail' }, { token: user.jwt });
      assertEquals(missing.body?.status, 'error');
      assertEquals(missing.body?.message, 'User not found');

      const ensured = await callFunction('wgui-ext-ensure-public-user', {}, { token: user.jwt });
      assertEquals(ensured.body?.status, 'success');
      assertEquals(ensured.body?.data?.user_id, user.userId);

      const again = await callFunction('wgui-ext-ensure-public-user', {}, { token: user.jwt });
      assertEquals(again.body?.status, 'success');
      assertEquals(again.body?.data?.user_id, user.userId);

      const created = await callFunction(
        'create-campaign',
        { name: 'wgui-ext-ensured', description: 'profile backfill' },
        { token: user.jwt }
      );
      assertEquals(created.body?.status, 'success');
      const campaignId = created.body?.data?.id;
      assert(typeof campaignId === 'number');
      await admin.from('campaign').delete().eq('id', campaignId);
    } finally {
      await admin.from('campaign').delete().eq('user_id', user.userId);
      await admin.from('public_user').delete().eq('user_id', user.userId);
      await admin.auth.admin.deleteUser(user.userId);
    }
  },
});

Deno.test({
  name: 'wgui-ext: a player gets the whole campaign roster, which find-character does not give them',
  ignore: skip,
  async fn() {
    const gm = await createSignedInUser();
    const ally = await createSignedInUser();
    const { userId: playerId, jwt: playerJwt } = await ensureTestUser();
    const campaign = await seedCampaign(gm.userId);
    const playerCharacter = await seedCharacter(playerId, campaign.id);
    const allyCharacter = await seedCharacter(ally.userId, campaign.id);

    try {
      const roster = await callFunction(
        'wgui-ext-find-campaign-characters',
        { campaign_id: campaign.id },
        { token: playerJwt }
      );
      assertEquals(roster.body?.status, 'success');
      assertEquals(
        (roster.body.data as { id: number }[]).map((c) => c.id).sort((a, b) => a - b),
        [playerCharacter.id, allyCharacter.id].sort((a, b) => a - b),
        'a player must see every character in the campaign'
      );

      const stock = await callFunction(
        'find-character',
        { campaign_id: campaign.id },
        { token: playerJwt }
      );
      assertEquals(stock.body?.status, 'success');
      assertEquals(
        (stock.body.data as { id: number }[]).map((c) => c.id),
        [playerCharacter.id],
        'stock find-character must still show a player only their own PCs'
      );
    } finally {
      await admin.from('character').delete().in('id', [playerCharacter.id, allyCharacter.id]);
      await admin.from('campaign').delete().eq('id', campaign.id);
      await admin.auth.admin.deleteUser(gm.userId);
      await admin.auth.admin.deleteUser(ally.userId);
    }
  },
});

Deno.test({
  name: 'wgui-ext: join-campaign sets campaign_id when the caller knows the join key',
  ignore: skip,
  async fn() {
    const gm = await createSignedInUser();
    const player = await createSignedInUser();
    const campaign = await seedCampaign(gm.userId);
    const character = await seedCharacter(player.userId, null);

    try {
      const joined = await callFunction(
        'wgui-ext-join-campaign',
        { character_id: character.id, join_key: campaign.join_key },
        { token: player.jwt }
      );
      assertEquals(joined.body?.status, 'success');
      assertEquals(joined.body?.data?.character?.campaign_id, campaign.id);
      assertEquals(joined.body?.data?.already, false);
      assertEquals(joined.body?.data?.campaign?.join_key, undefined);

      const { data: saved } = await admin.from('character').select('campaign_id').eq('id', character.id).single();
      assertEquals(saved?.campaign_id, campaign.id);

      const badKey = await callFunction(
        'wgui-ext-join-campaign',
        { character_id: character.id, join_key: 'nope-nope' },
        { token: player.jwt }
      );
      assertEquals(badKey.status, 400);

      const outsider = await createSignedInUser();
      try {
        const stolen = await callFunction(
          'wgui-ext-join-campaign',
          { character_id: character.id, join_key: campaign.join_key },
          { token: outsider.jwt }
        );
        assertEquals(stolen.status, 403);
      } finally {
        await admin.auth.admin.deleteUser(outsider.userId);
      }
    } finally {
      await admin.from('character').delete().eq('id', character.id);
      await admin.from('campaign').delete().eq('id', campaign.id);
      await admin.auth.admin.deleteUser(gm.userId);
      await admin.auth.admin.deleteUser(player.userId);
    }
  },
});
