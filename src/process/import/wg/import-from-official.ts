import type { Character } from '@schemas/content';
import { phase1Request } from '@pages/phase1/phase1-api';

export type OfficialCharacterSummary = { id: number; name: string; level: number };

export type OfficialImportResult = { name: string; ok: boolean; message?: string };

type ConnectData = { connected: true; characters: OfficialCharacterSummary[] };
type FetchData = { characters: Record<string, unknown>[]; missing: number[] };

export async function testOfficialConnection(
  apiKey: string,
  authUrl: string,
  accessToken?: string
): Promise<OfficialCharacterSummary[]> {
  const data = await phase1Request<ConnectData>(
    'wgui-ext-import-official-characters',
    { api_key: apiKey.trim(), auth_url: authUrl.trim() },
    accessToken
  );
  return data.characters ?? [];
}

export async function importOfficialCharacters(
  apiKey: string,
  authUrl: string,
  ids: number[],
  accessToken?: string
): Promise<OfficialImportResult[]> {
  const data = await phase1Request<FetchData>(
    'wgui-ext-import-official-characters',
    { api_key: apiKey.trim(), auth_url: authUrl.trim(), ids },
    accessToken
  );
  const results: OfficialImportResult[] = [];
  for (const id of data.missing ?? []) {
    results.push({ name: `Character ${id}`, ok: false, message: 'Not on this account.' });
  }
  for (const row of data.characters ?? []) {
    const name = typeof row.name === 'string' && row.name ? row.name : 'Character';
    try {
      await phase1Request<Character>('create-character', row, accessToken);
      results.push({ name, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create character.';
      const notGranted = /403|do not have access|not granted/i.test(message);
      results.push({ name, ok: false, message: notGranted ? 'Not granted.' : message });
    }
  }
  return results;
}
