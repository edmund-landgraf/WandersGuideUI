/** Build fields copied from an official wanderersguide.app character row. */

const DETAIL_KEYS = [
  'image_url',
  'background_image_url',
  'conditions',
  'ancestry',
  'background',
  'class',
  'class_archetype',
  'class_2',
  'class_archetype_2',
  'info',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OfficialCharacterSummary = { id: number; name: string; level: number };

export function parseOfficialAuthUrl(raw: string): { userId: string; clientId: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const userId = url.searchParams.get('user_id')?.trim() ?? '';
  const clientId = url.searchParams.get('client_id')?.trim() ?? '';
  if (!UUID.test(userId) || !clientId) return null;
  return { userId, clientId };
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Drop session and account blobs. Identity fields are omitted so create-character assigns new ones. */
export function trimOfficialCharacter(row: Record<string, unknown>): Record<string, unknown> {
  const details =
    row.details && typeof row.details === 'object' ? pick(row.details as Record<string, unknown>, DETAIL_KEYS) : null;
  const meta =
    row.meta_data && typeof row.meta_data === 'object' ? (row.meta_data as Record<string, unknown>) : null;
  const keptMeta: Record<string, unknown> = {};
  if (meta?.active_modes !== undefined) keptMeta.active_modes = meta.active_modes;
  if (meta?.given_item_ids !== undefined) keptMeta.given_item_ids = meta.given_item_ids;

  return {
    name: row.name,
    level: row.level,
    experience: row.experience ?? 0,
    hero_points: row.hero_points ?? 0,
    hp_current: row.hp_current ?? 0,
    hp_temp: row.hp_temp ?? 0,
    stamina_current: row.stamina_current ?? 0,
    resolve_current: row.resolve_current ?? 0,
    inventory: row.inventory ?? null,
    spells: row.spells ?? null,
    operation_data: row.operation_data ?? null,
    options: row.options ?? null,
    variants: row.variants ?? null,
    content_sources: row.content_sources ?? null,
    custom_operations: row.custom_operations ?? null,
    companions: row.companions ?? null,
    details,
    meta_data: Object.keys(keptMeta).length > 0 ? keptMeta : null,
  };
}

export function officialCharacterSummary(row: Record<string, unknown>): OfficialCharacterSummary | null {
  const id = typeof row.id === 'number' ? row.id : Number(row.id);
  const name = typeof row.name === 'string' ? row.name : '';
  const level = typeof row.level === 'number' ? row.level : Number(row.level);
  if (!Number.isFinite(id) || !name || !Number.isFinite(level)) return null;
  return { id, name, level };
}
