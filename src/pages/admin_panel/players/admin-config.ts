import { PublicUser } from '@schemas/content';

/**
 * Mirror of the server flag in wanderers-guide `supabase/functions/_shared/admin-access.ts`.
 * The server value is authoritative; this only controls what the UI shows.
 */
export const ADMIN_SCREENS_ALLOW_MODS = false;

/** Same character cap the player view shows for non-patrons (src/constants/data.ts). */
export { CHARACTER_SLOT_CAP as ADMIN_PC_CAP } from '@constants/data';

export function canUseAdminScreens(user: PublicUser | null | undefined): boolean {
  if (!user || user.deactivated) return false;
  return !!user.is_admin || (ADMIN_SCREENS_ALLOW_MODS && (user as any).is_mod === true);
}