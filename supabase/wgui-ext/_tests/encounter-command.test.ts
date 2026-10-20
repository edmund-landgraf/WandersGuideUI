import { assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const SUPABASE_URL = Deno.env.get('PUBLIC_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('PUBLIC_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const FUNCTIONS_URL = SUPABASE_URL + '/functions/v1';
const NO_BG_REFRESH = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, NO_BG_REFRESH);
const skip = !SERVICE_ROLE_KEY || !ANON_KEY;

async function user() {
  const email = 'wgui-command-' + crypto.randomUUID().slice(0, 8) + '@wanderersguide.test';
  const password = 'test1234';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('user create failed');
  const anon = createClient(SUPABASE_URL, ANON_KEY, NO_BG_REFRESH);
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error('user sign-in failed');
  return { id: created.data.user.id, jwt: signed.data.session.access_token };
}

async function call(name: string, body: unknown, jwt?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = 'Bearer ' + jwt;
  const response = await fetch(FUNCTIONS_URL + '/' + name, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) };
}

async function campaign(userId: string) {
  const result = await admin.from('campaign').insert({
    user_id: userId,
    name: 'wgui-command-' + crypto.randomUUID().slice(0, 8),
    join_key: 'command-' + crypto.randomUUID().slice(0, 8),
  }).select().single();
  if (result.error || !result.data) throw result.error ?? new Error('campaign seed failed');
  return result.data;
}

async function character(userId: string, campaignId: number | null) {
  const result = await admin.from('character').insert({
    user_id: userId,
    name: 'wgui-command-character',
    level: 1,
    campaign_id: campaignId,
  }).select().single();
  if (result.error || !result.data) throw result.error ?? new Error('character seed failed');
  return result.data;
}

Deno.test({
  name: 'wgui encounter commands are GM-scoped and mutate only the requested combatant list',
  ignore: skip,
  async fn() {
    const gm = await user();
    const player = await user();
    const camp = await campaign(gm.id);
    const joined = await character(player.id, camp.id);
    const outsider = await character(gm.id, null);
    const combatantId = crypto.randomUUID();
    const creatureId = crypto.randomUUID();

    const encounterResult = await admin.from('encounter').insert({
      user_id: gm.id,
      campaign_id: camp.id,
      name: 'wgui-command-encounter',
      meta_data: { party_level: 1, party_size: 0, untouched: true },
      combatants: {
        list: [{
          _id: creatureId,
          type: 'CREATURE',
          ally: false,
          initiative: 5,
          creature: {
            id: 901,
            name: 'Command Creature',
            hp_current: 20,
            hp_temp: 0,
            details: { conditions: [] },
          },
        }],
      },
    }).select().single();
    if (encounterResult.error || !encounterResult.data) throw encounterResult.error ?? new Error('encounter seed failed');
    const encounter = encounterResult.data;

    try {
      const added = await call('wgui-ext-add-encounter-character', {
        campaign_id: camp.id,
        encounter_id: encounter.id,
        character_id: joined.id,
        encounter_revision: 0,
      }, gm.jwt);
      assertEquals(added.status, 200);
      assertEquals(added.body.status, 'success');
      const addedId = added.body.data.combatant._id;

      const duplicate = await call('wgui-ext-add-encounter-character', {
        campaign_id: camp.id,
        encounter_id: encounter.id,
        character_id: joined.id,
        encounter_revision: 1,
      }, gm.jwt);
      assertEquals(duplicate.status, 409);
      assertEquals(duplicate.body.code, 'CHARACTER_ALREADY_IN_ENCOUNTER');

      const patched = await call('wgui-ext-patch-encounter-combatant', {
        campaign_id: camp.id,
        encounter_id: encounter.id,
        combatant_id: creatureId,
        initiative: 12,
        hp_current: 7,
        conditions: [{ name: 'Frightened', value: 1 }],
        encounter_revision: 1,
      }, gm.jwt);
      assertEquals(patched.status, 200);
      assertEquals(patched.body.data.combatant.initiative, 12);
      assertEquals(patched.body.data.combatant.creature.hp_current, 7);
      assertEquals(patched.body.data.combatant.creature.details.conditions.length, 1);

      const playerAttempt = await call('wgui-ext-remove-encounter-character', {
        campaign_id: camp.id,
        encounter_id: encounter.id,
        combatant_id: creatureId,
        encounter_revision: 1,
      }, player.jwt);
      assertEquals(playerAttempt.status, 403);
      assertEquals(playerAttempt.body.code, 'GM_REQUIRED');

      const removed = await call('wgui-ext-remove-encounter-character', {
        campaign_id: camp.id,
        encounter_id: encounter.id,
        combatant_id: addedId,
        encounter_revision: 2,
      }, gm.jwt);
      assertEquals(removed.status, 200);
      assertEquals(removed.body.data.removed_combatant_id, addedId);

      const notJoined = await call('wgui-ext-add-encounter-character', {
        campaign_id: camp.id,
        encounter_id: encounter.id,
        character_id: outsider.id,
        encounter_revision: 3,
      }, gm.jwt);
      assertEquals(notJoined.status, 403);
      assertEquals(notJoined.body.code, 'CHARACTER_NOT_IN_CAMPAIGN');

      const saved = await admin.from('encounter').select('meta_data, combatants').eq('id', encounter.id).single();
      assertEquals(saved.data?.meta_data?.untouched, true);
      assertEquals(saved.data?.combatants?.list?.length, 1);
    } finally {
      await admin.from('encounter').delete().eq('id', encounter.id);
      await admin.from('character').delete().in('id', [joined.id, outsider.id]);
      await admin.from('campaign').delete().eq('id', camp.id);
      await admin.auth.admin.deleteUser(gm.id);
      await admin.auth.admin.deleteUser(player.id);
    }
  },
});
