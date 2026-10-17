-- Last 10 sign-ins for the signed-in user, from GoTrue's audit log.
-- Apply once in the Supabase SQL editor.

create or replace function public.recent_logins()
returns table (logged_in_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select created_at
  from auth.audit_log_entries
  where payload->>'action' = 'login'
    and lower(payload->>'actor_id') = lower(auth.uid()::text)
  order by created_at desc
  limit 10;
$$;

revoke all on function public.recent_logins() from public;
grant execute on function public.recent_logins() to authenticated;
