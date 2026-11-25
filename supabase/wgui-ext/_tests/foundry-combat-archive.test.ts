import { assertEquals, assertThrows } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import { validateFoundryArchive } from '../_wgui-ext/foundry-combat-archive.ts';
const at = '2026-11-24T00:00:00.000Z';
const log = () => ({ worldId: 'world', exportId: 'combat:'+at, foundryCombatId: 'combat', foundrySceneId: 'scene', startedAt: at, endedAt: at, rounds: 1,
  transcript: [{ messageId: 'roll-1', at, round: 1, speaker: { alias: 'Goblin', actor: 'actor', token: 'token' }, rolls: [{ total: 12, formula: '1d20' }] }] });
Deno.test('archive validation accepts only structured public roll data', () => {
  assertEquals(validateFoundryArchive(log()), log());
  assertThrows(() => validateFoundryArchive({ ...log(), gmAccessToken: 'secret' }));
  assertThrows(() => validateFoundryArchive({ ...log(), combatants: [] }));
  const message = log().transcript[0];
  assertThrows(() => validateFoundryArchive({ ...log(), transcript: [{ ...message, content: '<p>hidden</p>' }] }));
  assertThrows(() => validateFoundryArchive({ ...log(), transcript: [message, message] }));
  assertThrows(() => validateFoundryArchive({ ...log(), transcript: Array.from({ length: 101 }, (_, i) => ({ ...message, messageId: String(i) })) }));
});
