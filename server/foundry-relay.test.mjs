import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import { createFoundryRelay } from './foundry-relay-core.mjs';

const ORIGIN = 'http://localhost:30000';
const CODE = 'test-code-value-ok';
const WORLD = 'worldA';

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
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

async function connect(base, extra = {}) {
  return post(base, '/foundry-relay/v1/connect', { code: CODE, worldId: WORLD, origin: ORIGIN, ...extra });
}

function serveOne(base, token, answer) {
  return (async () => {
    const wait = await fetch(`${base}/foundry-relay/v1/wait`, { method: 'POST', headers: { 'x-wgi-relay-session': token } });
    const job = await wait.json();
    if (job.type === 'idle' || job.type === 'bye') return job;
    await post(base, '/foundry-relay/v1/respond', answer(job), { 'x-wgi-relay-session': token });
    return job;
  })();
}

describe('foundry relay', () => {
  it('lists and reads one actor for the connected world, and strips biography', async () => {
    const { server, base } = await listen(createFoundryRelay({ allowOrigins: ['http://localhost:5194'] }));
    try {
      const joined = await connect(base);
      assert.equal(joined.status, 200);
      const token = joined.json.session;
      const listWait = serveOne(base, token, (job) => ({
        requestId: job.requestId,
        ok: true,
        worldId: WORLD,
        characters: [{ id: 'actor1', name: 'Reed', level: 3, ancestry: 'Human', className: 'Wizard', worldId: WORLD, notes: 'secret' }],
      }));
      const listed = await post(base, '/foundry-relay/v1/characters', { code: CODE, origin: ORIGIN });
      await listWait;
      assert.equal(listed.status, 200);
      assert.equal(listed.json.worldId, WORLD);
      assert.deepEqual(listed.json.characters, [
        { id: 'actor1', name: 'Reed', level: 3, ancestry: 'Human', className: 'Wizard', worldId: WORLD },
      ]);

      const actorWait = serveOne(base, token, (job) => ({
        requestId: job.requestId,
        ok: true,
        worldId: WORLD,
        actor: {
          _id: job.actorId,
          name: 'Reed',
          system: { details: { level: { value: 3 }, biography: { value: 'secret' } } },
          items: [{ name: 'Longsword' }],
          flags: { pf2e: { rulesSelections: { a: 1 } }, other: { secret: true } },
        },
      }));
      const read = await post(base, '/foundry-relay/v1/actor', { code: CODE, origin: ORIGIN, actorId: 'actor1' });
      const job = await actorWait;
      assert.equal(job.actorId, 'actor1');
      assert.equal(read.status, 200);
      assert.equal(read.json.worldId, WORLD);
      assert.equal(read.json.actor.system.details.biography, undefined);
      assert.equal(read.json.actor.items[0].name, 'Longsword');
      assert.deepEqual(read.json.actor.flags, { pf2e: { rulesSelections: { a: 1 } } });
      assert.equal(JSON.stringify(read.json).includes('secret'), false);
    } finally {
      server.close();
    }
  });

  it('rejects an unknown code, a mismatched origin, and a different world answer', async () => {
    const { server, base } = await listen(createFoundryRelay());
    try {
      const missing = await post(base, '/foundry-relay/v1/characters', { code: CODE, origin: ORIGIN });
      assert.equal(missing.status, 401);
      assert.equal(missing.json.message, 'Connection code rejected.');

      const joined = await connect(base);
      const token = joined.json.session;
      const otherOrigin = await post(base, '/foundry-relay/v1/characters', { code: CODE, origin: 'http://127.0.0.1:9' });
      assert.equal(otherOrigin.status, 401);

      const wait = serveOne(base, token, (job) => ({ requestId: job.requestId, ok: true, worldId: 'otherWorld', characters: [] }));
      const read = await post(base, '/foundry-relay/v1/characters', { code: CODE, origin: ORIGIN });
      await wait;
      assert.equal(read.status, 502);
      assert.equal(read.json.message, 'The Foundry world did not answer.');
    } finally {
      server.close();
    }
  });

  it('does not fetch the world origin, and refuses actor ids and credential URLs', async () => {
    const { server, base } = await listen(createFoundryRelay());
    try {
      const started = Date.now();
      const linkLocal = await post(base, '/foundry-relay/v1/characters', {
        code: CODE,
        origin: 'http://169.254.169.254',
      });
      assert.equal(linkLocal.status, 401);
      assert.ok(Date.now() - started < 1000);
      const badId = await post(base, '/foundry-relay/v1/actor', { code: CODE, origin: ORIGIN, actorId: '../etc' });
      assert.equal(badId.status, 401);
      const joined = await connect(base);
      assert.equal(joined.status, 200);
      const weird = await post(base, '/foundry-relay/v1/actor', { code: CODE, origin: ORIGIN, actorId: '../etc' });
      assert.equal(weird.status, 400);
      const creds = await post(base, '/foundry-relay/v1/connect', {
        code: CODE + '2',
        worldId: WORLD,
        origin: 'http://user:pass@localhost:30000',
      });
      assert.equal(creds.status, 400);
    } finally {
      server.close();
    }
  });

  it('answers module auth failures with the rejection sentence and times out a silent world', async () => {
    const { server, base } = await listen(createFoundryRelay());
    try {
      const joined = await connect(base);
      const token = joined.json.session;
      const wait = serveOne(base, token, (job) => ({ requestId: job.requestId, ok: false, status: 403, worldId: WORLD }));
      const rejected = await post(base, '/foundry-relay/v1/characters', { code: CODE, origin: ORIGIN });
      await wait;
      assert.equal(rejected.status, 403);
      assert.equal(rejected.json.message, 'Connection code rejected.');

      const silent = await post(base, '/foundry-relay/v1/actor', { code: CODE, origin: ORIGIN, actorId: 'actor1' });
      assert.equal(silent.status, 502);
      assert.equal(silent.json.message, 'The Foundry world did not answer.');
    } finally {
      server.close();
    }
  });

  it('keeps the first world when another connect reuses the code, and allows the same world to replace itself', async () => {
    const { server, base } = await listen(createFoundryRelay({ allowOrigins: ['http://localhost:30000', 'http://localhost:5194'] }));
    try {
      const first = await connect(base);
      const stolen = await connect(base, { worldId: 'worldB' });
      assert.equal(stolen.status, 409);
      const again = await connect(base);
      assert.equal(again.status, 200);
      assert.notEqual(again.json.session, first.json.session);
      const listWait = serveOne(base, again.json.session, (job) => ({
        requestId: job.requestId,
        ok: true,
        worldId: WORLD,
        characters: [],
      }));
      const listed = await post(base, '/foundry-relay/v1/characters', { code: CODE, origin: ORIGIN });
      await listWait;
      assert.equal(listed.status, 200);
      assert.equal(listed.json.worldId, WORLD);
    } finally {
      server.close();
    }
  });

  it('answers preflight only for an allowlisted origin, including private-network', async () => {
    const { server, base } = await listen(createFoundryRelay({ allowOrigins: ['http://localhost:30000'] }));
    try {
      const ok = await fetch(`${base}/foundry-relay/v1/connect`, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:30000',
          'access-control-request-method': 'POST',
          'access-control-request-private-network': 'true',
        },
      });
      assert.equal(ok.status, 204);
      assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:30000');
      assert.equal(ok.headers.get('access-control-allow-private-network'), 'true');
      const denied = await fetch(`${base}/foundry-relay/v1/connect`, {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
      const short = await connect(base, { code: 'short-code' });
      assert.equal(short.status, 400);
    } finally {
      server.close();
    }
  });
});
