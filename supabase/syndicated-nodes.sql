-- Shared syndication table. Shop rows use content_kind = 'shop'.
-- Apply once in the Supabase SQL editor. A later Amba copy can replace this file.

create table if not exists public.syndicated_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content_kind text not null,
  kind text not null check (kind in ('folder', 'entry')),
  name text not null,
  parent_id uuid references public.syndicated_nodes (id) on delete cascade,
  draft jsonb,
  published boolean not null default false,
  public_token text unique,
  snapshot jsonb,
  published_at timestamptz,
  constraint syndicated_folder_at_root check (kind <> 'folder' or parent_id is null)
);

alter table public.syndicated_nodes enable row level security;

create policy syndicated_owner_all on public.syndicated_nodes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace view public.syndicated_public as
  select id, content_kind, name, public_token, snapshot, published_at
  from public.syndicated_nodes
  where published = true and public_token is not null and snapshot is not null;

grant select on public.syndicated_public to anon, authenticated;
