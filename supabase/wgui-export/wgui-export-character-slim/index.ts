// Slim JSON export: wgui-export-character's jsonV4 file without the content
// catalog (all_spells, all_traits, raw_data_dump bonuses/history). About 4 MB
// becomes about 0.2 MB for a level 1 caster. Same auth as wgui-export-character:
// owner JWT, API key with a grant, or the GM of the PC's campaign.
// See _wgui-export/slim.ts for what is kept.
// @ts-ignore
import { serve } from 'std/server';
import type { Character } from '../_shared/content';
import { fetchData } from '../_shared/helpers.ts';
import { connect } from '../_wgui-export/connect-raw.ts';
import { loadContentPackage } from '../_wgui-export/content-package.ts';
import { slimExport } from '../_wgui-export/slim.ts';
import { HttpError } from '../_shared/http-errors.ts';
// @ts-ignore compiled by scripts/bundle-wgui-export.mjs into wgui-export-character
import { setExportContentPackage, buildJsonV4Object } from '../wgui-export-character/compile.bundle.js';

let compileQueue: Promise<unknown> = Promise.resolve();

function failJson(status: number, message: string, code: string): Response {
  return new Response(JSON.stringify({ status: 'fail', data: { message, code } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  return await connect<{ id?: number }>(
    req,
    async (client, body) => {
      const id = body?.id;
      if (typeof id !== 'number' || !Number.isFinite(id)) {
        return failJson(400, 'Missing character id.', 'INVALID_ID');
      }

      const results = await fetchData<Character>(client, 'character', [{ column: 'id', value: id }]);
      const character = results[0];
      if (!character) {
        throw new HttpError(403, 'You do not have access to this character', 'CHARACTER_FORBIDDEN');
      }

      const pkg = await loadContentPackage(client, character.content_sources?.enabled ?? []);
      const run = compileQueue.then(async () => {
        setExportContentPackage(pkg);
        const object = slimExport(await buildJsonV4Object(character));
        return new Response(JSON.stringify(object), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      compileQueue = run.then(
        () => undefined,
        () => undefined
      );
      return await run;
    },
    { supportsCharacterAPI: true }
  );
});