// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaignRead } from '../_wgui-ext/shared.ts';

interface CopyCampaignArtBody {
  campaign_id?: number;
}

const STORAGE_OBJECT = /\/storage\/v1\/object\/(?:public|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/;
const SITE_RELATIVE = /^\/(?:portraits|backgrounds)\//;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function assetOrigin(): string {
  return (Deno.env.get('PUBLIC_ASSET_ORIGIN') ?? 'https://wgui.wandersguide.site').replace(/\/$/, '');
}

function absoluteFetchUrl(stored: string): string | null {
  const trimmed = stored.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (SITE_RELATIVE.test(trimmed)) return `${assetOrigin()}${trimmed}`;
  return null;
}

function storageParts(url: string): { bucket: string; path: string } | null {
  const match = STORAGE_OBJECT.exec(url);
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

async function loadImageBytes(
  admin: ReturnType<typeof createServiceClient>,
  stored: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const fromStorage = storageParts(stored);
  if (fromStorage) {
    const { data, error } = await admin.storage.from(fromStorage.bucket).download(fromStorage.path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const header = data.type.split(';')[0]?.trim().toLowerCase() ?? '';
    const contentType = IMAGE_TYPES.has(header) ? header : 'image/jpeg';
    return { bytes, contentType };
  }

  const fetchUrl = absoluteFetchUrl(stored);
  if (!fetchUrl) return null;
  const response = await fetch(fetchUrl, { referrerPolicy: 'no-referrer' });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const contentType = IMAGE_TYPES.has(header) ? header : 'image/jpeg';
  return { bytes, contentType };
}

async function uploadForCaller(
  base: string,
  token: string,
  bytes: Uint8Array,
  contentType: string
): Promise<string> {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const data = btoa(binary);
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] ?? 'jpg';
  const response = await fetch(`${base}/functions/v1/upload-public-file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data, category: 'backgrounds', type: extension }),
  });
  if (!response.ok) {
    throw new HttpError(502, 'Could not store campaign art for your account.', 'ART_UPLOAD_FAILED');
  }
  const envelope = (await response.json()) as { status?: string; data?: { url?: string } };
  const url = envelope?.data?.url?.trim();
  if (envelope?.status !== 'success' || !url) {
    throw new HttpError(502, 'Could not store campaign art for your account.', 'ART_UPLOAD_FAILED');
  }
  return url;
}

/**
 * Re-upload campaign banner art for the caller using the service role to read the source
 * bytes (storage or public asset URL), then stock upload-public-file for the destination.
 */
serve(async (req: Request) => {
  return await connect<CopyCampaignArtBody>(req, async (client, body, token) => {
    const { campaign_id } = body ?? {};
    if (campaign_id === undefined || campaign_id === null) {
      throw new HttpError(400, 'A campaign_id is required.', 'CAMPAIGN_ID_REQUIRED');
    }

    const admin = createServiceClient();
    await authorizeCampaignRead(client, admin, token, campaign_id);

    const campaigns = await fetchData<Record<string, unknown>>(admin, 'campaign', [
      { column: 'id', value: campaign_id },
    ]);
    const meta = campaigns[0]?.meta_data as { image_url?: string } | null | undefined;
    const stored = typeof meta?.image_url === 'string' ? meta.image_url.trim() : '';
    if (!stored) {
      return { status: 'success', data: { image_url: '' } };
    }

    const loaded = await loadImageBytes(admin, stored);
    if (!loaded) {
      throw new HttpError(404, 'Campaign art could not be read.', 'ART_NOT_FOUND');
    }

    const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
    if (!base) {
      throw new HttpError(503, 'Storage is temporarily unavailable.', 'SUPABASE_URL_MISSING');
    }

    const image_url = await uploadForCaller(base, token, loaded.bytes, loaded.contentType);
    return { status: 'success', data: { image_url } };
  });
});