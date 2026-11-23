import type { Character } from '@schemas/content';

export function sameFunctionsHost(left: unknown, right: unknown): boolean;

export function findBuilderCharacter(
  characters: Array<Pick<Character, 'id' | 'meta_data'>>,
  query: {
    wgId?: number | string;
    worldId?: string;
    actorId?: string;
    host?: string;
    signedInHost?: string;
  },
):
  | { action: 'reject'; reason: 'host-mismatch' | 'rejected-link' }
  | { action: 'update'; character: Character }
  | { action: 'create' };

export function planBuilderUpdate(
  character: Pick<Character, 'id' | 'name' | 'level' | 'inventory' | 'meta_data'> & { updated_at?: string },
  proposal: {
    name?: string;
    level?: number;
    inventory?: { status?: string; column?: unknown[] };
    meta?: Record<string, unknown>;
    [field: string]: unknown;
  },
): {
  action: 'update';
  body: Record<string, unknown>;
  rows: { field: string; status: string; note?: string }[];
  confirm: boolean;
};

export function applyConflict(previous: { id?: number }, serverRow: unknown): {
  stale: true;
  character: unknown;
  previousId: number | undefined;
};

export function serverCreateCharacter(
  store: Map<string, { id: number }>,
  key: string,
  body: { meta_data?: Record<string, unknown> } & Record<string, unknown>,
): { inserted: boolean; character: { id: number } };
