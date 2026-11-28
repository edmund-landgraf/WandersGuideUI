-- Public art buckets used by upload-public-file (portraits, backgrounds).
-- Storage returns HTTP 400 NoSuchBucket when these rows are missing, and the
-- character sheet then cannot render the public object URL.
insert into storage.buckets (id, name, public)
values ('portraits', 'portraits', true),
       ('backgrounds', 'backgrounds', true)
on conflict (id) do update
  set name = excluded.name,
      public = true;

-- storage.objects has row level security and no policies, so an authenticated
-- upload is rejected with 42501 and the following public GET is HTTP 400.
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'wgui_public_read_art'
  ) then
    create policy wgui_public_read_art on storage.objects
      for select using (bucket_id in ('portraits', 'backgrounds'));
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'wgui_insert_own_art'
  ) then
    create policy wgui_insert_own_art on storage.objects
      for insert to authenticated
      with check (
        bucket_id in ('portraits', 'backgrounds')
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'wgui_update_own_art'
  ) then
    create policy wgui_update_own_art on storage.objects
      for update to authenticated
      using (
        bucket_id in ('portraits', 'backgrounds')
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      )
      with check (
        bucket_id in ('portraits', 'backgrounds')
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'wgui_delete_own_art'
  ) then
    create policy wgui_delete_own_art on storage.objects
      for delete to authenticated
      using (
        bucket_id in ('portraits', 'backgrounds')
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );
  end if;
end $$;
