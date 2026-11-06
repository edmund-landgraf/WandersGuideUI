/** One Foundry character actor, read into Wanderer's Guide. No content is guessed. */

export const LIST_PATH = '/modules/foundry-wanderersguide-import/export/characters';

export type FoundryListRow = {
  id: string;
  name: string;
  level: number | null;
  ancestry: string | null;
  className: string | null;
  worldId: string;
};

export type CoverageStatus = 'mapped' | 'included' | 'unresolved' | 'leftover-preserved' | 'dropped';

export type CoverageRow = { path: string; status: CoverageStatus; reason: string };

export type SinglePcPlan = {
  name: string | null;
  level: number | null;
  worldId: string;
  actorId: string;
  rows: CoverageRow[];
  leftovers: Record<string, unknown>;
  counts: Record<CoverageStatus, number>;
};

type ActorSource = {
  name?: unknown;
  _id?: unknown;
  id?: unknown;
  system?: { details?: { level?: { value?: unknown }; biography?: unknown } };
  [key: string]: unknown;
};

const DROPPED_PREFIX = 'system.details.biography';

export function actorPath(actorId: string): string {
  return `${LIST_PATH}/${encodeURIComponent(actorId)}`;
}

export async function foundryGet<T>(origin: string, code: string, path: string): Promise<T> {
  const base = origin.trim().replace(/\/$/, '');
  if (!base) throw new Error('Enter the Foundry world address.');
  if (!code.trim()) throw new Error('Enter the connection code.');
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { headers: { 'X-WGI-Connection-Code': code.trim() } });
  } catch {
    throw new Error('The Foundry world did not answer.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('Connection code rejected.');
  if (!response.ok) throw new Error('The Foundry world did not answer.');
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error('The Foundry world did not answer.');
  }
}

/** Classify one actor. Name and level are copied when they are already a string and a number. Everything else is kept verbatim or dropped with a reason. */
export function planSinglePc(actor: ActorSource, worldId: string): SinglePcPlan {
  const actorId = typeof actor._id === 'string' ? actor._id : typeof actor.id === 'string' ? actor.id : '';
  if (!actorId) throw new Error('This actor has no id.');
  if (!worldId) throw new Error('This world has no id.');

  const rows: CoverageRow[] = [];
  const leftovers: Record<string, unknown> = {};
  let name: string | null = null;
  let level: number | null = null;

  walk(actor, '', (path, value) => {
    if (path === '_id' || path === 'id') return;
    if (path === 'name') {
      if (typeof value === 'string' && value.trim()) {
        name = value.trim();
        rows.push({ path, status: 'mapped', reason: 'actor name' });
      } else {
        rows.push({ path, status: 'leftover-preserved', reason: 'not interpreted' });
        leftovers[path] = value ?? null;
      }
      return;
    }
    if (path === 'system.details.level.value') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        level = value;
        rows.push({ path, status: 'mapped', reason: 'actor level' });
      } else {
        rows.push({ path, status: 'leftover-preserved', reason: 'not interpreted' });
        leftovers[path] = value ?? null;
      }
      return;
    }
    if (path === DROPPED_PREFIX || path.startsWith(`${DROPPED_PREFIX}.`)) {
      rows.push({ path, status: 'dropped', reason: 'biography and GM notes are omitted' });
      return;
    }
    rows.push({ path, status: 'leftover-preserved', reason: 'not interpreted' });
    leftovers[path] = value ?? null;
  });

  if (!rows.some((row) => row.path === 'name')) {
    rows.push({ path: 'name', status: 'unresolved', reason: 'actor name is missing' });
  }
  if (!rows.some((row) => row.path === 'system.details.level.value')) {
    rows.push({ path: 'system.details.level.value', status: 'unresolved', reason: 'actor level is missing' });
  }

  const counts: SinglePcPlan['counts'] = { mapped: 0, included: 0, unresolved: 0, 'leftover-preserved': 0, dropped: 0 };
  for (const row of rows) counts[row.status] += 1;
  if (rows.some((row) => row.status === 'dropped' && !row.reason)) {
    throw new Error('A dropped path has no reason.');
  }
  return {
    name,
    level,
    worldId,
    actorId,
    rows,
    leftovers,
    counts,
  };
}

function walk(value: unknown, path: string, visit: (path: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, path ? `${path}[${index}]` : `[${index}]`, visit));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, path ? `${path}.${key}` : key, visit);
    }
    return;
  }
  if (path) visit(path, value);
}

export function foundryMeta(plan: SinglePcPlan, previous: Record<string, unknown> | null | undefined) {
  const prev = previous ?? {};
  const prevFoundry =
    prev.foundry && typeof prev.foundry === 'object' ? (prev.foundry as Record<string, unknown>) : {};
  const prevLeftovers =
    prevFoundry.leftovers && typeof prevFoundry.leftovers === 'object'
      ? (prevFoundry.leftovers as Record<string, unknown>)
      : {};
  return {
    ...prev,
    foundry: {
      ...prevFoundry,
      worldId: plan.worldId,
      actorId: plan.actorId,
      leftovers: { ...prevLeftovers, ...plan.leftovers },
      ledger: plan.rows,
    },
  };
}

export type FoundryLinkedCharacter = {
  id: number;
  name: string;
  meta_data?: Record<string, unknown> | null;
};

/** Match only when both the Foundry world id and the actor id are present and equal. */
export function findImportedCharacter<T extends { meta_data?: unknown }>(
  characters: readonly T[],
  worldId: string,
  actorId: string,
): T | undefined {
  if (!worldId || !actorId) return undefined;
  return characters.find((character) => {
    const meta = character.meta_data;
    if (!meta || typeof meta !== 'object') return undefined;
    const foundry = (meta as { foundry?: { worldId?: unknown; actorId?: unknown } }).foundry;
    return foundry?.worldId === worldId && foundry?.actorId === actorId;
  });
}

export const CREATE_REQUIRES_NAME_AND_LEVEL =
  'Import needs a string name and a numeric level to create a character.';

export type ImportWrite =
  | { action: 'reject'; message: string }
  | { action: 'create'; body: Record<string, unknown>; messageName: string }
  | { action: 'update'; body: Record<string, unknown>; messageName: string };

/**
 * Create needs a nonempty string name and a finite numeric level.
 * An existing world+actor match may update with either field absent.
 * The update body carries id, optional name, optional level, and meta_data only.
 */
export function planImportWrite(plan: SinglePcPlan, previous: FoundryLinkedCharacter | undefined): ImportWrite {
  if (!previous && (plan.name == null || plan.level == null)) {
    return { action: 'reject', message: CREATE_REQUIRES_NAME_AND_LEVEL };
  }
  if (previous) {
    const body: Record<string, unknown> = {
      id: previous.id,
      meta_data: foundryMeta(plan, previous.meta_data ?? undefined),
    };
    if (plan.name) body.name = plan.name;
    if (plan.level != null) body.level = plan.level;
    return { action: 'update', body, messageName: plan.name ?? previous.name };
  }
  return {
    action: 'create',
    body: {
      name: plan.name,
      level: plan.level,
      meta_data: foundryMeta(plan, { reset_hp: true }),
      details: {},
    },
    messageName: plan.name ?? 'character',
  };
}
