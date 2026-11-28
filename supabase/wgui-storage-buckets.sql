-- Public art buckets used by upload-public-file (portraits, backgrounds).
-- Storage returns HTTP 400 NoSuchBucket when these rows are missing, and the
-- character sheet then cannot render the public object URL.
insert into storage.buckets (id, name, public)
values ('portraits', 'portraits', true),
       ('backgrounds', 'backgrounds', true)
on conflict (id) do update
  set name = excluded.name,
      public = true;
