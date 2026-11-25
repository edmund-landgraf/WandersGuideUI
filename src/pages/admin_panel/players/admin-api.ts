import { supabase, supabaseInvokeHeaders } from '../../../supabase-client';
import { useQuery } from '@tanstack/react-query';

export interface AdminPlayer {
  user_id: string;
  display_name: string | null;
  image_url: string | null;
  masked_email: string | null;
  providers: string[];
  patreon_tier: string | null;
  is_capped: boolean;
  is_admin: boolean;
  is_mod: boolean;
  deactivated: boolean;
  pc_count: number;
  campaign_count: number;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface AdminPlayerPage {
  page: number;
  page_size: number;
  total: number;
  players: AdminPlayer[];
}

export interface AdminCharacterSummary {
  id: number;
  user_id: string;
  name: string;
  level: number;
  campaign_id: number | null;
  updated_at: string;
  ancestry: string | null;
  heritage: string | null;
  background: string | null;
  class: string | null;
  class_2: string | null;
  image_url: string | null;
}

export interface AdminCharacterDetail {
  character: Record<string, any>;
  owner_display_name: string | null;
  campaign_name: string | null;
}

const UNLOCK_KEY = 'wgui-admin-unlock';
export const ADMIN_LOCKED_EVENT = 'wgui-admin-locked';

/** Unlock token from admin-unlock (signed server-side, ~8h). sessionStorage only: gone when the tab closes. */
export function getAdminUnlock(): string | null {
  try {
    const raw = sessionStorage.getItem(UNLOCK_KEY);
    if (!raw) return null;
    const { token, expires_at } = JSON.parse(raw) as { token: string; expires_at: number };
    if (!token || !expires_at || expires_at * 1000 <= Date.now()) {
      sessionStorage.removeItem(UNLOCK_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function clearAdminUnlock() {
  sessionStorage.removeItem(UNLOCK_KEY);
  window.dispatchEvent(new Event(ADMIN_LOCKED_EVENT));
}

async function errorInfo(error: unknown, response?: Response): Promise<{ status?: number; code?: string; message?: string }> {
  const fromError = (error as { context?: Response })?.context;
  const res = response ?? fromError;
  const status = res?.status;
  try {
    const json = await res?.clone().json();
    return { status, code: json?.data?.code ?? json?.code, message: json?.data?.message ?? json?.message };
  } catch {
    return { status, message: error instanceof Error ? error.message : undefined };
  }
}

function unlockFailureMessage(
  info: { status?: number; code?: string; message?: string },
  data: unknown
): string {
  if (info.code === 'BAD_ADMIN_PASSWORD') return 'Incorrect password.';
  if (info.code === 'ADMIN_NOT_CONFIGURED') {
    return 'Admin password is not set on the server. Set ADMIN_PANEL_PASSWORD in the stack .env and recreate the functions container (npm run stack:restart).';
  }
  if (info.message) return info.message;
  const body = data as { status?: string; message?: string; code?: string } | null;
  if (body?.message) return body.message;
  if (body?.status === 'error') {
    return 'Admin unlock failed on the server (often admin_audit_log or service role). See docs/local-stack-rest-and-export-boot.md.';
  }
  const hint = [info.code, info.status].filter((v) => v != null).join(', ');
  return hint ? `Unlock failed (${hint}).` : 'Unlock failed. Check the Network tab for POST /functions/v1/admin-unlock.';
}

/** Admin endpoints are not part of the player RequestType union, so call them directly. */
async function adminRequest<T>(fn: string, body: Record<string, any>): Promise<T> {
  const headers = await supabaseInvokeHeaders();
  const { data, error } = await supabase.functions.invoke(fn, { body: { ...body, admin_unlock: getAdminUnlock() ?? undefined }, headers });
  if (error) {
    const info = await errorInfo(error);
    if (info.code === 'ADMIN_LOCKED') {
      clearAdminUnlock();
      throw new Error('Admin panel is locked.');
    }
    throw new Error(info.status === 403 ? 'Administrator access is required.' : info.message ?? `Request failed (${fn})`);
  }
  if (!data || data.status !== 'success') throw new Error(data?.message ?? data?.data?.message ?? `Request failed (${fn})`);
  return data.data as T;
}

/** Exchanges the admin password for an unlock token. The password is never stored. */
export async function unlockAdmin(password: string): Promise<void> {
  const headers = await supabaseInvokeHeaders();
  if (!headers?.Authorization) {
    throw new Error('Sign in again, then retry the admin password.');
  }
  const { data, error, response } = await supabase.functions.invoke('admin-unlock', { body: { password }, headers });
  if (error) {
    const info = await errorInfo(error, response);
    throw new Error(unlockFailureMessage(info, data));
  }
  if (!data || data.status !== 'success') {
    throw new Error(unlockFailureMessage({}, data));
  }
  if (!data.data?.token || !data.data?.expires_at) {
    throw new Error('Unlock succeeded but the server response was incomplete. Try again.');
  }
  sessionStorage.setItem(UNLOCK_KEY, JSON.stringify(data.data));
}

export type AdminPlayerSort = 'name' | 'email' | 'login' | 'tier' | 'pcs' | 'campaigns' | 'last_login';

export function useAdminPlayers(params: { page: number; pageSize: number; query: string; tier: string | null; provider: string | null; sort: AdminPlayerSort | null; direction: 'asc' | 'desc' }) {
  return useQuery({
    queryKey: ['admin-list-players', params],
    queryFn: () =>
      adminRequest<AdminPlayerPage>('admin-list-players', {
        page: params.page,
        page_size: params.pageSize,
        query: params.query || undefined,
        tier: params.tier || undefined,
        provider: params.provider || undefined,
        sort: params.sort || undefined,
        direction: params.direction,
      }),
    placeholderData: (prev) => prev,
  });
}

export function useAdminPlayerCharacters(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-get-player-characters', userId],
    enabled,
    queryFn: () => adminRequest<AdminCharacterSummary[]>('admin-get-player-characters', { user_id: userId }),
  });
}

export function useAdminCharacter(characterId: number) {
  return useQuery({
    queryKey: ['admin-get-character', characterId],
    enabled: Number.isFinite(characterId) && characterId > 0,
    queryFn: () => adminRequest<AdminCharacterDetail>('admin-get-character', { character_id: characterId }),
    retry: false,
  });
}

/** Not cached: the full email lives only in the caller's component state. Server writes an audit row. */
export function revealEmail(userId: string) {
  return adminRequest<{ user_id: string; email: string | null }>('admin-reveal-email', { user_id: userId });
}