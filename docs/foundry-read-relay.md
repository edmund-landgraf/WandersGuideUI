# Foundry read relay

The character import dialog reads one world through this process. It does not call `/modules/foundry-wanderersguide-import/export/characters`. A Foundry module runs in the browser and cannot register that route. This process also does not fetch the world URL the user typed. That URL is only the label that ties a browser request to a connected world.

Nothing here writes an actor, a character, or a combat. Content matching is unchanged.

## Run

From this repo:

```bash
npm run foundry-relay
```

The default listen address is `127.0.0.1:8787`. A host other than `127.0.0.1` or `::1` exits unless `FOUNDRY_RELAY_ALLOW_REMOTE=1`. Browser origins that may call it are `FOUNDRY_RELAY_ORIGINS` (default `http://localhost:5194`, `http://127.0.0.1:5194`, `http://localhost:30000`, and `http://127.0.0.1:30000`). The Foundry page origin has to be on that list, because the module’s `fetch` is cross-origin. A preflight from an allowlisted origin may include `Access-Control-Allow-Private-Network: true`. Other origins get no CORS headers. The WGUI dev server uses `http://127.0.0.1:8787` unless `VITE_FOUNDRY_RELAY_URL` is set.

A page loaded over HTTPS cannot be assumed to reach this HTTP loopback listener. Chromium’s private-network preflight is answered for allowlisted origins. That path was not run in a browser. An HTTP Foundry page on port 30000 calling this HTTP listener is the arrangement the contract is written for. A hosted HTTPS world needs an HTTPS relay URL on `VITE_FOUNDRY_RELAY_URL`, which is not provided here.

The connection code is the shared secret. It is not printed and it is not placed in a URL. A code that does not match a connected world is `401` with `Connection code rejected.` A world that accepts the read and then fails, or that does not answer within 8 seconds, is `502` with `The Foundry world did not answer.`

## What the module must add

`foundry-wanderersguide-import` does not do this yet. Until it does, a real Foundry world will not appear in the dialog. The tests in `server/foundry-relay.test.mjs` speak this contract with a fixture. They are not a live world.

While the world is open, and only for a GM client:

1. `POST /foundry-relay/v1/connect` with JSON `{ "code", "worldId", "origin" }`. `code` is 16 to 128 characters. `origin` is `http://localhost:30000` or the hosted origin, with no path, user, or query. `worldId` is `game.world.id` (`game.world.id` in the browser client). The response is `{ "session", "worldId" }`. Keep `session` in memory for the wait calls. Do not log either secret. A second connect with the same code and the same origin and world replaces the session, which is how a reload recovers. A second connect that changes the world or the origin is rejected while the first session is still inside its 60 second lifetime. `game.user.isGM` is checked in the module before connect. This relay does not see the Foundry user.
2. `POST /foundry-relay/v1/wait` with header `X-WGI-Relay-Session`. The body is empty. The reply is `{ "type": "idle" }`, `{ "type": "list", "requestId" }`, or `{ "type": "actor", "requestId", "actorId" }`. Wait again after each reply.
3. `POST /foundry-relay/v1/respond` with the same header and `{ "requestId", "ok": true, "worldId", "characters" }` or `{ "requestId", "ok": true, "worldId", "actor" }`. A refused code is `{ "ok": false, "status": 401 or 403, "worldId" }`.

`characters` rows are `{ id, name, level, ancestry, className }`. `worldId` on the row, when present, must be this world. `actor` is that one character actor: fields, embedded items, and `flags.pf2e.rulesSelections`. The module reads those with the browser APIs `game.world.id`, `game.actors`, and the actor’s items and flags. It does not register a Foundry server route.

Omit biography, GM notes, and other users' secret text before the response is built. The relay also deletes `system.details.biography` and every flag except `flags.pf2e.rulesSelections`. Those values are not stored as tagged leftovers. They are dropped on purpose so a secret note cannot sit on the Wanderer's Guide character. Everything else on the actor is what the importer plans, including leftover leaves. List columns other than id, name, level, ancestry, className, and world id are not returned.

Do not add or edit actors on these calls. Encounter list, combat read, link, and sync patch stay in `docs/foundry-encounter-sync-module.md` and are not served here.

## Checks

```bash
npm run test:foundry-relay
npx vitest run src/process/import/foundry
```

The relay test binds `127.0.0.1` and uses the fixture above. It does not open a Foundry world and does not write a Wanderer's Guide character.
