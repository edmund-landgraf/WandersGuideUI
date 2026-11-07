// In-memory read relay. No outbound requests. Connection codes and session
// tokens are compared in memory and are not written to the response or logs.
import { randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_BROWSER_BODY = 4_096;
const MAX_MODULE_BODY = 1_500_000;
const WAIT_MS = 20_000;
const READ_MS = 8_000;
const SESSION_MS = 60_000;
const MIN_CODE = 16;
const MAX_DEPTH = 32;

const ID_TEXT = /^[A-Za-z0-9]{1,32}$/;

export function createFoundryRelay({ allowOrigins = [] } = {}) {
  const sessions = new Map();
  const byCode = new Map();

  function sameSecret(left, right) {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  function worldOrigin(value) {
    if (typeof value !== 'string' || value.length > 200) return null;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  }

  function allowed(requestOrigin) {
    return typeof requestOrigin === 'string' && allowOrigins.includes(requestOrigin);
  }

  function send(res, status, body, req) {
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    const privateNetwork = req.headers['access-control-request-private-network'] === 'true';
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    if (allowed(requestOrigin)) {
      headers['access-control-allow-origin'] = requestOrigin;
      headers.vary = 'Origin';
      if (privateNetwork) headers['access-control-allow-private-network'] = 'true';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(Object.assign(new Error('too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('invalid json'), { status: 400 }));
        }
      });
      req.on('error', () => reject(Object.assign(new Error('unreadable'), { status: 400 })));
    });
  }

  function dropSession(session) {
    if (byCode.get(session.code) === session.token) byCode.delete(session.code);
    sessions.delete(session.token);
    if (session.waiter) {
      clearTimeout(session.waiter.timer);
      session.waiter.resolve({ type: 'bye' });
      session.waiter = null;
    }
    if (session.pending) {
      clearTimeout(session.pending.timer);
      session.pending.reject(Object.assign(new Error('gone'), { status: 503 }));
      session.pending = null;
    }
  }

  function touch(session) {
    session.expires = Date.now() + SESSION_MS;
  }

  function sessionFromToken(token) {
    if (typeof token !== 'string' || token.length < 16) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expires < Date.now()) {
      dropSession(session);
      return null;
    }
    return session;
  }

  function sessionFromCode(code, origin) {
    const token = byCode.get(code);
    if (!token) return null;
    const session = sessionFromToken(token);
    if (!session || !sameSecret(session.code, code) || session.origin !== origin) return null;
    return session;
  }

  function deliver(session, job) {
    if (session.waiter) {
      const waiter = session.waiter;
      session.waiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve(job);
      return;
    }
    session.queued = job;
  }

  function ask(session, kind, actorId) {
    if (session.pending) {
      return Promise.reject(Object.assign(new Error('busy'), { status: 429 }));
    }
    const requestId = randomBytes(8).toString('hex');
    const job = { type: kind, requestId, ...(actorId ? { actorId } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (session.pending && session.pending.requestId === requestId) session.pending = null;
        if (session.queued && session.queued.requestId === requestId) session.queued = null;
        reject(Object.assign(new Error('timeout'), { status: 504 }));
      }, READ_MS);
      session.pending = { requestId, kind, actorId, resolve, reject, timer };
      deliver(session, job);
      touch(session);
    });
  }

  function listRows(characters, worldId) {
    if (!Array.isArray(characters)) return null;
    const rows = [];
    for (const row of characters) {
      if (!row || typeof row !== 'object') return null;
      if (typeof row.id !== 'string' || !ID_TEXT.test(row.id)) return null;
      if (row.worldId !== undefined && row.worldId !== worldId) return null;
      const level = row.level == null ? null : row.level;
      if (level !== null && (typeof level !== 'number' || !Number.isFinite(level))) return null;
      rows.push({
        id: row.id,
        name: typeof row.name === 'string' ? row.name.slice(0, 200) : '',
        level,
        ancestry: typeof row.ancestry === 'string' ? row.ancestry.slice(0, 200) : null,
        className: typeof row.className === 'string' ? row.className.slice(0, 200) : null,
        worldId,
      });
    }
    return rows;
  }

  function scrubActor(actor, actorId) {
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return null;
    const id = typeof actor._id === 'string' ? actor._id : typeof actor.id === 'string' ? actor.id : '';
    if (id !== actorId) return null;
    let depth = 0;
    const walk = (value) => {
      if (value === null || typeof value !== 'object') return;
      depth += 1;
      if (depth > MAX_DEPTH) throw Object.assign(new Error('deep'), { status: 413 });
      for (const child of Object.values(value)) walk(child);
      depth -= 1;
    };
    walk(actor);
    const copy = JSON.parse(JSON.stringify(actor));
    const details = copy.system && copy.system.details;
    if (details && typeof details === 'object') delete details.biography;
    const rules = copy.flags && copy.flags.pf2e && copy.flags.pf2e.rulesSelections;
    copy.flags = rules === undefined ? {} : { pf2e: { rulesSelections: rules } };
    return copy;
  }

  async function connect(req, res) {
    const body = await readBody(req, 4_096);
    const origin = worldOrigin(body.origin);
    const worldId = typeof body.worldId === 'string' && ID_TEXT.test(body.worldId) ? body.worldId : null;
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!origin || !worldId || code.length < MIN_CODE || code.length > 128) {
      send(res, 400, { message: 'The Foundry world did not answer.' }, req);
      return;
    }
    const previous = byCode.get(code);
    if (previous) {
      const old = sessions.get(previous);
      if (old && old.expires >= Date.now() && (old.worldId !== worldId || old.origin !== origin)) {
        send(res, 409, { message: 'Connection code rejected.' }, req);
        return;
      }
      if (old) dropSession(old);
    }
    const token = randomBytes(32).toString('hex');
    const session = {
      token,
      code,
      worldId,
      origin,
      waiter: null,
      queued: null,
      pending: null,
      expires: Date.now() + SESSION_MS,
    };
    sessions.set(token, session);
    byCode.set(code, token);
    send(res, 200, { session: token, worldId }, req);
  }

  async function wait(req, res) {
    const session = sessionFromToken(req.headers['x-wgi-relay-session']);
    if (!session) {
      send(res, 401, { message: 'Connection code rejected.' }, req);
      return;
    }
    touch(session);
    if (session.queued) {
      const job = session.queued;
      session.queued = null;
      send(res, 200, job, req);
      return;
    }
    if (session.waiter) {
      send(res, 429, { message: 'The Foundry world did not answer.' }, req);
      return;
    }
    let settled = false;
    const job = await new Promise((resolve) => {
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (session.waiter) session.waiter = null;
        clearTimeout(timer);
        req.off('close', onClose);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ type: 'idle' }), WAIT_MS);
      const onClose = () => finish({ type: 'bye' });
      req.on('close', onClose);
      session.waiter = { resolve: (value) => finish(value), timer };
    });
    if (res.writableEnded) return;
    if (!sessions.has(session.token)) {
      send(res, 401, { message: 'Connection code rejected.' }, req);
      return;
    }
    send(res, 200, job, req);
  }

  async function respond(req, res) {
    const session = sessionFromToken(req.headers['x-wgi-relay-session']);
    if (!session) {
      send(res, 401, { message: 'Connection code rejected.' }, req);
      return;
    }
    const body = await readBody(req, MAX_MODULE_BODY);
    const pending = session.pending;
    if (!pending || body.requestId !== pending.requestId) {
      send(res, 409, { message: 'The Foundry world did not answer.' }, req);
      return;
    }
    session.pending = null;
    clearTimeout(pending.timer);
    touch(session);
    if (body.worldId !== session.worldId) {
      pending.reject(Object.assign(new Error('world'), { status: 502 }));
      send(res, 200, { ok: false }, req);
      return;
    }
    if (body.ok === false) {
      const status = body.status === 401 || body.status === 403 ? body.status : 502;
      pending.reject(Object.assign(new Error('module'), { status }));
      send(res, 200, { ok: true }, req);
      return;
    }
    try {
      if (pending.kind === 'list') {
        const characters = listRows(body.characters, session.worldId);
        if (!characters) pending.reject(Object.assign(new Error('shape'), { status: 502 }));
        else pending.resolve({ worldId: session.worldId, characters });
      } else {
        const actor = scrubActor(body.actor, pending.actorId);
        if (!actor) pending.reject(Object.assign(new Error('shape'), { status: 502 }));
        else pending.resolve({ worldId: session.worldId, actor });
      }
    } catch (error) {
      pending.reject(Object.assign(new Error('shape'), { status: error.status || 502 }));
    }
    send(res, 200, { ok: true }, req);
  }

  async function browserRead(req, res, kind) {
    const body = await readBody(req, MAX_BROWSER_BODY);
    const origin = worldOrigin(body.origin);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!origin || !code) {
      send(res, 400, { message: 'The Foundry world did not answer.' }, req);
      return;
    }
    const session = sessionFromCode(code, origin);
    if (!session) {
      send(res, 401, { message: 'Connection code rejected.' }, req);
      return;
    }
    let actorId;
    if (kind === 'actor') {
      actorId = typeof body.actorId === 'string' ? body.actorId : '';
      if (!ID_TEXT.test(actorId)) {
        send(res, 400, { message: 'The Foundry world did not answer.' }, req);
        return;
      }
    }
    try {
      const result = await ask(session, kind, actorId);
      send(res, 200, result, req);
    } catch (error) {
      const status = error.status === 401 || error.status === 403 ? error.status : 502;
      const message = status === 401 || status === 403 ? 'Connection code rejected.' : 'The Foundry world did not answer.';
      send(res, status, { message }, req);
    }
  }

  return {
    async handle(req, res) {
      const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
      const privateNetwork = req.headers['access-control-request-private-network'] === 'true';
      if (req.method === 'OPTIONS') {
        if (allowed(requestOrigin)) {
          const headers = {
            'access-control-allow-origin': requestOrigin,
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type, x-wgi-relay-session',
            'access-control-max-age': '600',
            vary: 'Origin',
          };
          if (privateNetwork) headers['access-control-allow-private-network'] = 'true';
          res.writeHead(204, headers);
          res.end();
          return;
        }
        res.writeHead(403);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { message: 'The Foundry world did not answer.' }, req);
        return;
      }
      const path = new URL(req.url || '/', 'http://relay.local').pathname;
      try {
        if (path === '/foundry-relay/v1/connect') return await connect(req, res);
        if (path === '/foundry-relay/v1/wait') return await wait(req, res);
        if (path === '/foundry-relay/v1/respond') return await respond(req, res);
        if (path === '/foundry-relay/v1/characters') return await browserRead(req, res, 'list');
        if (path === '/foundry-relay/v1/actor') return await browserRead(req, res, 'actor');
        send(res, 404, { message: 'The Foundry world did not answer.' }, req);
      } catch (error) {
        send(res, error.status || 400, { message: 'The Foundry world did not answer.' }, req);
      }
    },
  };
}
