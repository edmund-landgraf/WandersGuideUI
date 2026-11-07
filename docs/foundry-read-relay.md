# Foundry read relay

The character import dialog reads one world through this process. It does not call `/modules/foundry-wanderersguide-import/export/characters`. A Foundry module runs in the browser and cannot register that route. This process also does not fetch the world URL the user typed. That URL is only the label that ties a browser request to a connected world.

Nothing here writes an actor, a character, or a combat. Content matching is unchanged.

## Run

From this repo:

```bash
npm run foundry-relay
```

The default listen address is `127.0.0.1:8787`. A host other than `127.0.0.1` or `::1` exits unless `FOUNDRY_RELAY_ALLOW_REMOTE=1`. Browser origins that may call it are `FOUNDRY_RELAY_ORIGINS` (default `http://localhost:5194,http://127.0.0.1:5194`). The WGUI dev server uses `http://127.0.0.1:8787` unless `VITE_FOUNDRY_RELAY_URL` is set.

The connection code is the shared secret. It is not printed and it is not placed in a URL. A code that does not match a connected world is `401` with `Connection code rejected.` A world that accepts the read and then fails, or that does not answer within 8 seconds, is `502` with `The Foundry world did not answer.`

## What the module must add

`foundry-wanderersguide-import` does not do this yet. Until it does, a real Foundry world will not appear in the dialog. The tests in `server/foundry-relay.test.mjs` speak this contract with a fixture. They are not a live world.

While the world is open, and only for a GM client:

1. `POST /foundry-relay/v1/connect` with JSON `{ "code", "worldId", "origin" }`. `origin` is `http://localhost:30000` or the hosted origin, with no path, user, or query. `worldId` is `game.world.id`. The response is `{ "session", "worldId" }`. Keep `session` in memory. Do not log either secret.
2. `POST /foundry-relay/v1/wait` with header `X-WGI-Relay-Session`. The body is empty. The reply is `{ "type": "idle" }`, `{ "type": "list", "requestId" }`, or `{ "type": "actor", "requestId", "actorId" }`. Wait again after each reply.
3. `POST /foundry-relay/v1/respond` with the same header and `{ "requestId", "ok": true, "worldId", "characters" }` or `{ "requestId", "ok": true, "worldId", "actor" }`. A refused code is `{ "ok": false, "status": 401 or 403, "worldId" }`.

`characters` rows are `{ id, name, level, ancestry, className }`. `worldId` on the row, when present, must be this world. `actor` is that one character actor: fields, embedded items, and `flags.pf2e.rulesSelections`. Omit biography, GM notes, and other users' secret text. The relay deletes `system.details.biography` and every flag except `flags.pf2e.rulesSelections` before the browser sees the actor. It also drops list columns other than the six above.

Do not add or edit actors on these calls. Encounter list, combat read, link, and sync patch stay in `docs/foundry-encounter-sync-module.md` and are not served here.

## Checks

```bash
npm run test:foundry-relay
npx vitest run src/process/import/foundry
```

The relay test binds `127.0.0.1` and uses the fixture above. It does not open a Foundry world and does not write a Wanderer's Guide character.
