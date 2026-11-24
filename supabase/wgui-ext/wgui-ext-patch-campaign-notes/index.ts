// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { authorizeCampaign } from '../_wgui-ext/shared.ts';
import { notesFromCampaign, patchNotePage } from '../_wgui-ext/campaign-notes.ts';

interface PatchCampaignNotesBody {
  campaign_id?: number;
  page_index?: number;
  expected_page_name?: string;
  patch?: Record<string, unknown>;
  create?: {
    name?: string;
    contents?: unknown;
    icon?: string;
    color?: string;
    shared?: boolean;
  };
}

function notesRecord(campaign: Record<string, unknown>) {
  const notes = campaign.notes;
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return {} as Record<string, unknown>;
  return { ...(notes as Record<string, unknown>) };
}

/**
 * Patch one campaign note page, never the whole campaign row.
 *
 * A GM can change page metadata and contents. A player can change contents only
 * when the existing page is shared. expected_page_name prevents a stale page index
 * from updating a different page after pages were reordered.
 */
serve(async (req: Request) => {
  return await connect<PatchCampaignNotesBody>(req, async (client, body, token) => {
    const { campaign_id, page_index, expected_page_name, patch, create } = body ?? {};
    if (campaign_id === undefined || campaign_id === null) {
      throw new HttpError(400, 'A campaign_id is required.', 'CAMPAIGN_ID_REQUIRED');
    }

    const admin = createServiceClient();
    const access = await authorizeCampaign(client, admin, token, campaign_id);
    const campaigns = await fetchData<Record<string, unknown>>(admin, 'campaign', [
      { column: 'id', value: campaign_id },
    ]);
    const campaign = campaigns[0];
    if (!campaign) {
      throw new HttpError(404, 'Campaign not found.', 'CAMPAIGN_NOT_FOUND');
    }

    if (create) {
      if (!access.isGm) {
        throw new HttpError(403, 'Only the GM can add a campaign note page.', 'NOTE_PAGE_FORBIDDEN');
      }
      if (typeof create.name !== 'string' || !create.name.trim()) {
        throw new HttpError(400, 'A page name is required.', 'PAGE_PATCH_INVALID');
      }
      if (!('contents' in create)) {
        throw new HttpError(400, 'Page contents are required.', 'PAGE_PATCH_INVALID');
      }
      const raw = notesRecord(campaign);
      const pages = Array.isArray(raw.pages) ? [...raw.pages] : [];
      const page = {
        name: create.name.trim(),
        icon: typeof create.icon === 'string' ? create.icon : 'notebook',
        color: typeof create.color === 'string' ? create.color : '#359fdf',
        ...(typeof create.shared === 'boolean' ? { shared: create.shared } : {}),
        contents: create.contents,
      };
      pages.push(page);
      const { error } = await admin.from('campaign').update({ notes: { ...raw, pages } }).eq('id', campaign_id);
      if (error) throw error;
      return {
        status: 'success',
        data: { campaign_id, page: { ...page, index: pages.length - 1 } },
      };
    }

    if (!Number.isInteger(page_index) || page_index < 0) {
      throw new HttpError(400, 'A non-negative page_index is required.', 'PAGE_INDEX_REQUIRED');
    }
    if (typeof expected_page_name !== 'string') {
      throw new HttpError(400, 'expected_page_name is required.', 'EXPECTED_PAGE_REQUIRED');
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new HttpError(400, 'A page patch is required.', 'PAGE_PATCH_REQUIRED');
    }

    const keys = Object.keys(patch);
    const allowed = new Set(['contents', 'name', 'icon', 'color', 'shared']);
    if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
      throw new HttpError(400, 'The patch contains unsupported fields.', 'PAGE_PATCH_INVALID');
    }

    for (const key of ['name', 'icon', 'color']) {
      if (key in patch && typeof patch[key] !== 'string') {
        throw new HttpError(400, `${key} must be a string.`, 'PAGE_PATCH_INVALID');
      }
    }
    if ('shared' in patch && typeof patch.shared !== 'boolean') {
      throw new HttpError(400, 'shared must be a boolean.', 'PAGE_PATCH_INVALID');
    }

    const notes = notesFromCampaign(campaign);
    const raw = notesRecord(campaign);
    const current = notes.pages[page_index];
    if (!current) {
      throw new HttpError(404, 'Campaign note page not found.', 'NOTE_PAGE_NOT_FOUND');
    }
    if (current.name !== expected_page_name) {
      throw new HttpError(409, 'The note page changed. Reload and retry.', 'NOTE_PAGE_CHANGED');
    }

    if (!access.isGm) {
      if (!current.shared) {
        throw new HttpError(403, 'Only shared note pages can be edited by a player.', 'NOTE_PAGE_FORBIDDEN');
      }
      if (keys.some((key) => key !== 'contents')) {
        throw new HttpError(403, 'Players may edit shared note contents only.', 'NOTE_PAGE_FORBIDDEN');
      }
    }

    const pages = patchNotePage(notes.pages, page_index, patch, access.isGm);
    const { error } = await admin
      .from('campaign')
      .update({ notes: { ...raw, pages } })
      .eq('id', campaign_id);
    if (error) throw error;

    return {
      status: 'success',
      data: {
        campaign_id,
        page: { ...pages[page_index], index: page_index },
      },
    };
  });
});
