// @ts-ignore
import { serve } from 'std/server';
import { loadCharacterSummaries, serveKeyScoped } from '../_wgui-ext/key-auth.ts';

/**
 * POST {}  -> { status: 'success', data: KeyCharacterSummary[] }
 *
 * API key: the characters granted to that key's client and owned by the key's user.
 * User JWT: the caller's own characters. No / invalid auth: 401.
 */
serve((req: Request) =>
  serveKeyScoped<Record<string, never>>(req, 'wgui-ext-list-key-characters', (caller, _body, admin) =>
    loadCharacterSummaries(admin, caller.characterIds)
  )
);