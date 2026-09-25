import { assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import { admin, callFunction, seed, stackUnavailable } from '../../functions/_tests/seed.ts';

const skip = stackUnavailable();

Deno.test({
  name: 'wgui-export-character: missing format is 400',
  ignore: skip,
  async fn() {
    const { jwt } = await seed();
    const result = await callFunction('wgui-export-character', { id: 1 }, { token: jwt });
    assertEquals(result.status, 400);
    assertEquals(result.body?.status, 'fail');
  },
});

Deno.test({
  name: 'wgui-export-character: API key without grant returns 403',
  ignore: skip,
  async fn() {
    const { userId, apiKey } = await seed();
    const { data: char } = await admin
      .from('character')
      .insert({ name: 'Export Locked', user_id: userId, level: 1, experience: 0 })
      .select()
      .single();
    try {
      const result = await callFunction(
        'wgui-export-character',
        { id: char.id, format: 'json' },
        { token: apiKey }
      );
      assertEquals(result.status, 403);
      assertEquals(result.body?.status, 'fail');
    } finally {
      await admin.from('character').delete().eq('id', char.id);
    }
  },
});
