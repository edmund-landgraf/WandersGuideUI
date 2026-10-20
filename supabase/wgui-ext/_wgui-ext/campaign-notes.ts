export interface CampaignNotePage {
  name: string;
  icon: string;
  color: string;
  shared?: boolean;
  contents: unknown;
}

export interface CampaignNotes {
  pages: CampaignNotePage[];
}

export interface CampaignNotesPageDto extends CampaignNotePage {
  index: number;
}

export function notesFromCampaign(campaign: Record<string, unknown>): CampaignNotes {
  const notes = campaign.notes;
  if (!notes || typeof notes !== 'object') return { pages: [] };
  const pages = (notes as Record<string, unknown>).pages;
  if (!Array.isArray(pages)) return { pages: [] };

  if (!pages.every(isNotePage)) return { pages: [] };

  return {
    pages: pages.map((page) => ({ ...page })),
  };
}

function isNotePage(value: unknown): value is CampaignNotePage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Record<string, unknown>;
  return typeof page.name === 'string'
    && typeof page.icon === 'string'
    && typeof page.color === 'string'
    && 'contents' in page;
}

export function toPageDto(page: CampaignNotePage, index: number): CampaignNotesPageDto {
  return { ...page, index };
}

export function patchNotePage(
  pages: CampaignNotePage[],
  index: number,
  patch: Record<string, unknown>,
  isGm: boolean
): CampaignNotePage[] {
  const current = pages[index];
  if (!current) return pages;

  const next = pages.slice();
  const updated = { ...current };

  if ('contents' in patch) updated.contents = patch.contents;
  if (isGm) {
    if ('name' in patch) updated.name = patch.name as string;
    if ('icon' in patch) updated.icon = patch.icon as string;
    if ('color' in patch) updated.color = patch.color as string;
    if ('shared' in patch) updated.shared = patch.shared as boolean;
  }

  next[index] = updated;
  return next;
}
