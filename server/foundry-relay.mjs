// Read-only bridge between a Foundry world and the WGUI browser.
// The world dials out and waits. This process never fetches the world URL.
import { createServer } from 'node:http';
import { createFoundryRelay } from './foundry-relay-core.mjs';

const host = process.env.FOUNDRY_RELAY_HOST || '127.0.0.1';
const port = Number(process.env.FOUNDRY_RELAY_PORT || 8787);
const remote = process.env.FOUNDRY_RELAY_ALLOW_REMOTE === '1';
if (!remote && host !== '127.0.0.1' && host !== '::1') {
  console.error('foundry-relay: refusing to listen outside loopback. Set FOUNDRY_RELAY_ALLOW_REMOTE=1 to bind elsewhere.');
  process.exit(1);
}
const allowOrigins = (process.env.FOUNDRY_RELAY_ORIGINS || 'http://localhost:5194,http://127.0.0.1:5194')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const relay = createFoundryRelay({ allowOrigins });
const server = createServer((req, res) => {
  relay.handle(req, res).catch((error) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: 'The Foundry world did not answer.' }));
    }
    console.error('foundry-relay: request failed', error && error.status ? error.status : '');
  });
});
server.listen(port, host, () => {
  console.error(`foundry-relay: listening on http://${host}:${port} (origins ${allowOrigins.join(', ')})`);
});
