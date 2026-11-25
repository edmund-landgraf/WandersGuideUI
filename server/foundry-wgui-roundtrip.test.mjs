// Module client ↔ relay ↔ WGUI-style browser read (no live Foundry tab).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import { createFoundryRelay } from './foundry-relay-core.mjs';
import { runFoundryReadRelay, generateFoundryConnectionCode } from '../../foundry-wanderersguide-import/scripts/foundry-read-relay.js';

const ORIGIN = 'http://localhost:30000';
const WORLD = 'TestWorld';

function gameFixture() {
  const actor = {
    id: 'ACTOR123',
    type: 'character',
    name: 'Kota',
    folder: { id: 'PARTY1', name: 'The Party' },
    system: { details: { level: { value: 3 } } },
    items: {
      contents: [
        { type: 'class', name: 'Rogue' },
        { type: 'ancestry', name: 'Human' },
      ],
    },
    toObject: () => ({
      _id: 'ACTOR123',
      name: 'Kota',
      type: 'character',
      system: { details: { level: { value: 3 }, biography: { gmNotes: 'secret' } } },
      flags: { pf2e: { rulesSelections: { skill: 'stealth' } } },
      items: [],
    }),
  };
  return {
    user: { isGM: true },
    actors: { contents: [actor], get: (id) => (id === actor.id ? actor : null) },
  };
}

async function listen(relay) {
  const server = createServer((req, res) => {
    relay.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function post(base, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe('foundry module ↔ relay ↔ WGUI list/actor', () => {
  it('lists and reads one PC through the live module client loop', async () => {
    const code = generateFoundryConnectionCode();
    assert.match(code, /^\d{16}$/);
    const { server, base } = await listen(createFoundryRelay({ allowOrigins: ['http://localhost:5194'] }));
    const controller = new AbortController();
    const client = runFoundryReadRelay({
      gameRef: gameFixture(),
      config: { code, worldId: WORLD, origin: ORIGIN, relayUrl: base },
      signal: controller.signal,
      backoffMs: 0,
    });
  try {
      await new Promise((resolve) => setImmediate(resolve));
      const listed = await post(base, '/foundry-relay/v1/characters', { code, origin: ORIGIN });
      assert.equal(listed.status, 200);
      assert.equal(listed.json.worldId, WORLD);
      assert.deepEqual(listed.json.characters, [{
        id: 'ACTOR123',
        name: 'Kota',
        level: 3,
        ancestry: 'Human',
        className: 'Rogue',
        worldId: WORLD,
        folderId: 'PARTY1',
        folderName: 'The Party',
      }]);

      const read = await post(base, '/foundry-relay/v1/actor', { code, origin: ORIGIN, actorId: 'ACTOR123' });
      assert.equal(read.status, 200);
      assert.equal(read.json.actor.name, 'Kota');
      assert.equal(read.json.actor.system.details.biography, undefined);
      assert.deepEqual(read.json.actor.flags, { pf2e: { rulesSelections: { skill: 'stealth' } } });
    } finally {
      controller.abort();
      await client;
      server.close();
    }
  });
});