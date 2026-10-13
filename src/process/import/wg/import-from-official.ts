import type { Character } from '@schemas/content';
import { phase1Request } from '@pages/phase1/phase1-api';
import { officialCharacterSummary, parseOfficialAuthUrl, trimOfficialCharacter, type OfficialCharacterSummary } from './trim-official-character';

export type { OfficialCharacterSummary };

export type OfficialImportResult = { name: string; ok: boolean; message?: string };

const OFFICIAL_FIND = 'https://api.wanderersguide.app/functions/v1/find-character';
const OFFICIAL_USER = 'https://api.wanderersguide.app/functions/v1/get-user';
const IMPORT_CAP = 50;

async function officialRequest(url: string, apiKey: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let payload: { status?: string; data?: unknown; message?: string } = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload.status !== 'success') {
    const data = payload.data as { message?: string } | undefined;
    throw new Error(data?.message || payload.message || 'Could not reach wanderersguide.app.');
  }
  return payload.data;
}

async function listOfficialCharacters(apiKey: string, authUrl: string): Promise<Record<string, unknown>[]> {
  const key = apiKey.trim();
  const auth = parseOfficialAuthUrl(authUrl);
  if (!/^[0-9a-f-]{36}$/i.test(key) || !auth) {
    throw new Error('Enter the API key and the Character Authorization URL from wanderersguide.app.');
  }
  const profile = await officialRequest(OFFICIAL_USER, key, {});
  const account = profile as { id?: number; user_id?: string };
  const accountId = account.user_id;
  if (!accountId) throw new Error('Could not read the account for this API key.');
  const urlId = auth.userId;
  const matches = /^\d+$/.test(urlId) ? String(account.id) === urlId : accountId === urlId;
  if (!matches) throw new Error('That authorization URL is for a different account than this API key.');
  const data = await officialRequest(OFFICIAL_FIND, key, { user_id: accountId });
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [];
}

export async function testOfficialConnection(apiKey: string, authUrl: string): Promise<OfficialCharacterSummary[]> {
  const rows = await listOfficialCharacters(apiKey, authUrl);
  return rows.map(officialCharacterSummary).filter((row): row is OfficialCharacterSummary => row !== null);
}

export async function importOfficialCharacters(
  apiKey: string,
  authUrl: string,
  ids: number[],
  accessToken?: string
): Promise<OfficialImportResult[]> {
  if (ids.length > IMPORT_CAP) {
    throw new Error(`Import up to ${IMPORT_CAP} characters at a time.`);
  }
  const rows = await listOfficialCharacters(apiKey, authUrl);
  const wanted = new Set(ids);
  const results: OfficialImportResult[] = [];
  const found = new Set<number>();
  for (const row of rows) {
    const id = Number(row.id);
    if (!wanted.has(id)) continue;
    found.add(id);
    const trimmed = trimOfficialCharacter(row);
    const name = typeof trimmed.name === 'string' && trimmed.name ? trimmed.name : 'Character';
    try {
      await phase1Request<Character>('create-character', trimmed, accessToken);
      results.push({ name, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create character.';
      const notGranted = /403|do not have access|not granted/i.test(message);
      results.push({ name, ok: false, message: notGranted ? 'Not granted.' : message });
    }
  }
  for (const id of ids) {
    if (!found.has(id)) results.push({ name: `Character ${id}`, ok: false, message: 'Not on this account.' });
  }
  return results;
}
