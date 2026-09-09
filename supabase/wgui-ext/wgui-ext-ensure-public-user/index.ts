// @ts-ignore
import { serve } from 'std/server';
import type { PublicUser } from '../_shared/content';
import { connect, createServiceClient, fetchData } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import { requireCallerId } from '../_wgui-ext/shared.ts';

function displayNameFromAuthUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = user.user_metadata ?? {};
  const named = [meta.display_name, meta.name, meta.full_name]
    .find((value) => typeof value === 'string' && value.trim() !== '') as string | undefined;
  if (named) return named.trim();
  const email = user.email?.split('@')[0];
  return email && email.trim() ? email.trim() : 'Unknown User';
}

/**
 * Create the caller's `public_user` row if Auth created an account without one.
 *
 * `create-campaign` / `create-character` look up that row and return "User not found"
 * when it is missing. Direct REST insert was revoked (migration 20260905010000); the
 * remaining path is the Auth trigger in wanderers-guide `data/auth-trigger.sql`. Accounts
 * created before that trigger was applied, or on a stack that never loaded it, can sign
 * in but cannot create campaigns. This endpoint inserts the same default row the trigger
 * would have, via the service-role client, for the already-authenticated caller.
 */
serve(async (req: Request) => {
  return await connect(req, async (client, _body, token) => {
    const userId = await requireCallerId(client, token);
    const admin = createServiceClient();

    const existing = await fetchData<PublicUser>(admin, 'public_user', [
      { column: 'user_id', value: userId },
    ]);
    if (existing[0]) {
      return { status: 'success', data: existing[0] };
    }

    const {
      data: { user },
    } = await client.auth.getUser(token);
    // insertData().select() can fail after public_user column grants were tightened even
    // when the insert itself succeeded. Write, then re-read the caller's row.
    const { error: insertError } = await admin.from('public_user').insert({
      user_id: userId,
      display_name: displayNameFromAuthUser(user ?? {}),
    });
    if (insertError && insertError.code !== '23505') {
      throw insertError;
    }

    const retry = await fetchData<PublicUser>(admin, 'public_user', [
      { column: 'user_id', value: userId },
    ]);
    if (retry[0]) {
      return { status: 'success', data: retry[0] };
    }
    throw new HttpError(500, 'Could not create a user profile.', 'PUBLIC_USER_CREATE_FAILED');
  });
});
