/**
 * Read-only campaign copy plan. See docs/atomic-campaign-copy.md for environment setup.
 *   npm run dry-run:campaign-copy -- 41
 * Requires SUPABASE_URL, SUPABASE_ANON_KEY and CAMPAIGN_COPY_TOKEN in the environment.
 * CAMPAIGN_COPY_USER_ID is optional and checked against the authenticated user.
 */
import type { Campaign } from '../src/schemas/content';
import { buildCampaignCopyPlan } from '../src/pages/phase1/phase1-campaign-copy-plan';
import { parseCopyEncounterManifest } from '../src/pages/phase1/phase1-campaign-copy-manifest';

const USAGE = [
  'Usage: npm run dry-run:campaign-copy -- <positive integer campaignId>',
  'Required environment: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_ANON_KEY (or VITE_SUPABASE_KEY), CAMPAIGN_COPY_TOKEN (signed-in user access token).',
  'Optional: CAMPAIGN_COPY_USER_ID (must match the authenticated user), VITE_PUBLIC_ASSET_ORIGIN, VITE_PUBLIC_STORAGE_ORIGIN.',
  'This command reads campaign data only; it does not create campaigns, encounters or artwork.',
].join('\n');

class UsageError extends Error {}
const env = (name: string) => process.env[name]?.trim() || undefined;
const token = env('CAMPAIGN_COPY_TOKEN');
const anonKey = env('SUPABASE_ANON_KEY') ?? env('VITE_SUPABASE_KEY');

function redact(text: string): string {
  for (const secret of [token, anonKey]) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

function config(args: string[]) {
  if (args.length !== 1 || !/^\d+$/.test(args[0]) || !Number.isSafeInteger(Number(args[0])) || Number(args[0]) <= 0) {
    throw new UsageError('Campaign ID must be one positive safe integer.');
  }
  if (!token) throw new UsageError('Set CAMPAIGN_COPY_TOKEN to a signed-in user access token.');
  if (!anonKey || /[<>]/.test(anonKey)) throw new UsageError('Set SUPABASE_ANON_KEY (or VITE_SUPABASE_KEY) to the public anon/publishable key.');
  // Do not accept service/secret credentials in the public key slot.
  if (anonKey.startsWith('sb_secret_') || anonKey === env('SUPABASE_SERVICE_ROLE_KEY')) {
    throw new UsageError('Use the public anon/publishable key, never the service-role key.');
  }
  try {
    const claims = JSON.parse(Buffer.from(anonKey.split('.')[1] ?? '', 'base64url').toString('utf8'));
    if (claims?.role === 'service_role') throw new UsageError('Use the public anon/publishable key, never the service-role key.');
  } catch (error) {
    if (error instanceof UsageError) throw error;
    // Modern publishable keys are not JWTs. The gateway validates the actual key.
  }
  const rawUrl = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
  let base: URL;
  try { base = new URL(rawUrl ?? ''); } catch { throw new UsageError('Set SUPABASE_URL (or VITE_SUPABASE_URL) to the API origin.'); }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new UsageError('SUPABASE_URL must be an HTTP(S) API origin without credentials, path or query.');
  }
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) {
    throw new UsageError('Use HTTPS for remote Supabase endpoints; HTTP is permitted only for loopback development.');
  }
  return { campaignId: Number(args[0]), base: base.origin, token, anonKey, expectedUserId: env('CAMPAIGN_COPY_USER_ID') };
}

type Config = ReturnType<typeof config>;
async function request(cfg: Config, label: string, path: string, body?: object): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(cfg.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(label + ': connection failed or timed out.');
  }
  // Do not print arbitrary server errors; they can echo credentials.
  if (!response.ok) throw new Error(label + ': HTTP ' + response.status + '. Check your session, permissions and API configuration.');
  try { return await response.json(); } catch { throw new Error(label + ': invalid JSON response.'); }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readFunction(cfg: Config, name: 'find-campaign' | 'wgui-ext-find-encounter', body: object) {
  const result = record(await request(cfg, name, '/functions/v1/' + name, body));
  if (result?.status !== 'success' || !('data' in result)) throw new Error(name + ': read failed. Check copy permission and deployed functions.');
  return result.data;
}

function safeArtworkUrl(raw: string): string {
  if (/^data:/i.test(raw)) return '[embedded image]';
  // Signed artwork URLs or URLs with credentials must not be printed.
  try {
    const url = new URL(raw, 'https://redaction.invalid');
    if (url.username || url.password) return '[credential-bearing artwork URL]';
  } catch { return '[invalid artwork URL]'; }
  return raw.split(/[?#]/, 1)[0];
}

async function main(args: string[]) {
  if (args.length === 1 && ['--help','-h'].includes(args[0])) {
    console.log(USAGE);
    return;
  }
  const cfg = config(args);
  const user = record(await request(cfg, 'Authentication', '/auth/v1/user'));
  const id = user?.id;
  if (typeof id !== 'string' || !id.trim() || user?.is_anonymous === true) {
    throw new Error('Authentication: a verified signed-in user is required.');
  }
  if (cfg.expectedUserId && cfg.expectedUserId.toLowerCase() !== id.toLowerCase()) {
    throw new UsageError('CAMPAIGN_COPY_USER_ID does not match the authenticated user. Remove it or correct it.');
  }

  // The server enforces owner/copy consent. Do not call ordinary play-filtered
  // reads as a fallback or request the roster, which is not needed for a plan.
  const encounters = parseCopyEncounterManifest(await readFunction(cfg, 'wgui-ext-find-encounter',
    { campaign_id: cfg.campaignId, for_campaign_copy: true, copy_manifest: true }),cfg.campaignId);

  const campaignData = await readFunction(cfg, 'find-campaign', { id: cfg.campaignId });
  const rows = Array.isArray(campaignData) ? campaignData : [campaignData];
  const source = record(rows[0]);
  if (rows.length !== 1 || !source || Number(source.id) !== cfg.campaignId || typeof source.name !== 'string') {
    throw new Error('Campaign was not found or is not visible to this token.');
  }

  const plan = buildCampaignCopyPlan(source as unknown as Campaign, encounters);
  console.log(redact(JSON.stringify({ campaign: source.name, ...plan, sourceArtUrl: safeArtworkUrl(plan.sourceArtUrl) }, null, 2)));
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const usage = error instanceof UsageError;
  // Only expose controlled messages; unexpected exceptions may contain request data.
  const message = error instanceof Error ? error.message : 'Dry run failed.';
  console.error(redact(message));
  if (usage) console.error(USAGE);
  process.exitCode = usage ? 2 : 1;
}
