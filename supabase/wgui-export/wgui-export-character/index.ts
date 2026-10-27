// @ts-ignore
import { serve } from 'std/server';
import type { Character } from '../_shared/content';
import { fetchData } from '../_shared/helpers.ts';
import { connect } from '../_wgui-export/connect-raw.ts';
import { loadContentPackage } from '../_wgui-export/content-package.ts';
import { HttpError } from '../_shared/http-errors.ts';
// @ts-ignore compiled by scripts/bundle-wgui-export.mjs
import { setExportContentPackage, buildJsonV4Object, buildPdfV2Bytes } from './compile.bundle.js';

let templateBytes: Uint8Array | null = null;
let compileQueue: Promise<unknown> = Promise.resolve();

function failJson(status: number, message: string, code: string): Response {
  return new Response(JSON.stringify({ status: 'fail', data: { message, code } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadTemplate(): Promise<Uint8Array> {
  if (templateBytes) return templateBytes;
  const res = await fetch('https://wanderersguide.app/files/character-sheet-v2.pdf');
  if (!res.ok) {
    throw new HttpError(503, 'Character sheet template is unavailable.', 'TEMPLATE_UNAVAILABLE');
  }
  templateBytes = new Uint8Array(await res.arrayBuffer());
  return templateBytes;
}

serve(async (req: Request) => {
  return await connect<{ id?: number; format?: string }>(
    req,
    async (client, body) => {
      const id = body?.id;
      const format = body?.format;
      if (typeof id !== 'number' || !Number.isFinite(id)) {
        return failJson(400, 'Missing character id.', 'INVALID_ID');
      }
      if (format !== 'json' && format !== 'pdf') {
        return failJson(400, 'format must be json or pdf.', 'INVALID_FORMAT');
      }

      const results = await fetchData<Character>(client, 'character', [{ column: 'id', value: id }]);
      const character = results[0];
      if (!character) {
        throw new HttpError(403, 'You do not have access to this character', 'CHARACTER_FORBIDDEN');
      }

      const pkg = await loadContentPackage(client, character.content_sources?.enabled ?? []);

      const run = compileQueue.then(async () => {
        setExportContentPackage(pkg);
        if (format === 'json') {
          const object = await buildJsonV4Object(character);
          return new Response(JSON.stringify(object), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const bytes = await buildPdfV2Bytes(character, await loadTemplate());
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
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
