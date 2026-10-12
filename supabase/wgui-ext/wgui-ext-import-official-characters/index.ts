// @ts-ignore
import { serve } from 'std/server';
import { connect } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import {
  officialCharacterSummary,
  parseOfficialAuthUrl,
  trimOfficialCharacter,
} from '../_wgui-ext/trim-official-character.ts';

const OFFICIAL_FIND = 'https://api.wanderersguide.app/functions/v1/find-character';
const IMPORT_CAP = 50;

interface ImportBody {
  api_key?: string;
  auth_url?: string;
  ids?: number[];
}

async function listOfficialCharacters(apiKey: string, userId: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(OFFICIAL_FIND, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId }),
  });
  let payload: { status?: string; data?: unknown; message?: string } = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload.status !== 'success') {
    const data = payload.data as { message?: string } | undefined;
    const message = data?.message || payload.message || 'Could not reach wanderersguide.app.';
    const status = response.status === 401 || response.status === 403 ? response.status : 400;
    throw new HttpError(status, message, response.status === 403 ? 'NOT_GRANTED' : 'OFFICIAL_API');
  }
  const data = payload.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [];
}

serve(async (req: Request) => {
  return await connect<ImportBody>(req, async (_client, body) => {
    const apiKey = body?.api_key?.trim() ?? '';
    const auth = parseOfficialAuthUrl(body?.auth_url ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(apiKey) || !auth) {
      throw new HttpError(400, 'Enter the API key and the Character Authorization URL from wanderersguide.app.', 'IMPORT_FIELDS');
    }

    const rows = await listOfficialCharacters(apiKey, auth.userId);
    const summaries = rows.map(officialCharacterSummary).filter((row) => row !== null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => Number.isFinite(id)) : [];
    if (ids.length === 0) {
      return { status: 'success', data: { connected: true, characters: summaries } };
    }
    if (ids.length > IMPORT_CAP) {
      throw new HttpError(400, `Import up to ${IMPORT_CAP} characters at a time.`, 'IMPORT_CAP');
    }

    const wanted = new Set(ids);
    const matched = rows.filter((row) => wanted.has(Number(row.id)));
    const found = new Set(matched.map((row) => Number(row.id)));
    const missing = ids.filter((id) => !found.has(id));
    return {
      status: 'success',
      data: {
        characters: matched.map(trimOfficialCharacter),
        missing,
      },
    };
  });
});
