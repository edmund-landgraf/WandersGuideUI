-- WGUI #78. Apply to the database BEFORE deploying the edge function.
-- Service-role-only RPC, canonical append-only receipts, and a protected metadata mirror.
begin;
create table if not exists public.wgui_foundry_combat_archive (
  encounter_id bigint not null references public.encounter(id) on delete cascade,
  world_id text not null,
  export_id text not null,
  receipt uuid not null default gen_random_uuid(),
  archive jsonb not null,
  created_at timestamptz not null default now(),
  primary key (encounter_id, world_id, export_id)
);
alter table public.wgui_foundry_combat_archive enable row level security;
revoke all on public.wgui_foundry_combat_archive from public, anon, authenticated, service_role;

-- Protect the archive subtree against existing whole-meta writers, including a stale
-- dice/roster update that arrives after the archive transaction. Clients cannot
-- add logs via metadata writes; only the canonical RPC can append.
create or replace function public.wgui_protect_foundry_combat_archive()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  meta jsonb := coalesce(new.meta_data::jsonb, '{}'::jsonb);
  foundry jsonb;
  previous_logs jsonb := '[]'::jsonb;
  canonical_logs jsonb := '[]'::jsonb;
  logs jsonb;
begin
  if jsonb_typeof(meta) <> 'object' then meta := '{}'::jsonb; end if;
  foundry := meta->'foundry';
  if jsonb_typeof(foundry) is distinct from 'object' then foundry := '{}'::jsonb; end if;
  if tg_op = 'UPDATE' then
    -- Preserve pre-migration archives, never trust the new caller-provided array.
    if jsonb_typeof(old.meta_data::jsonb #> '{foundry,combat_logs}') = 'array' then
      previous_logs := old.meta_data::jsonb #> '{foundry,combat_logs}';
    end if;
    select coalesce(jsonb_agg(a.archive order by a.created_at, a.receipt), '[]'::jsonb)
      into canonical_logs from public.wgui_foundry_combat_archive a where a.encounter_id = old.id;
  end if;
  -- On INSERT (including campaign copies) never inherit historical combat logs.
  -- Preserve all historical records verbatim, including records that predate
  -- the current world/export identity format. Append only new canonical keys.
  logs := previous_logs || coalesce((
    select jsonb_agg(c.value order by c.ord)
    from jsonb_array_elements(canonical_logs) with ordinality c(value,ord)
    where not exists (
      select 1 from jsonb_array_elements(previous_logs) p(value)
      where p.value->>'worldId' = c.value->>'worldId'
        and p.value->>'exportId' = c.value->>'exportId'
    )
  ), '[]'::jsonb);
  if jsonb_array_length(logs) > 0 then
    new.meta_data := jsonb_set(meta, '{foundry}', foundry || jsonb_build_object('combat_logs',logs), true);
  elsif foundry ? 'combat_logs' then
    new.meta_data := jsonb_set(meta, '{foundry}', foundry - 'combat_logs', true);
  end if;
  return new;
end;
$$;
revoke all on function public.wgui_protect_foundry_combat_archive() from public, anon, authenticated, service_role;
drop trigger if exists wgui_protect_foundry_combat_archive on public.encounter;
create trigger wgui_protect_foundry_combat_archive before insert or update of meta_data on public.encounter
for each row execute function public.wgui_protect_foundry_combat_archive();

create or replace function public.wgui_append_foundry_combat_archive(
  p_user_id uuid, p_campaign_id bigint, p_encounter_id bigint, p_archive jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  e public.encounter%rowtype;
  prior public.wgui_foundry_combat_archive%rowtype;
  world text := p_archive->>'worldId';
  export text := p_archive->>'exportId';
  receipt_id uuid;
  log_count integer;
  log_bytes bigint;
  legacy jsonb;
begin
  if p_user_id is null or p_campaign_id is null or p_encounter_id is null
    or coalesce(jsonb_typeof(p_archive),'') <> 'object'
    or world is null or export is null or length(world) not between 1 and 160 or length(export) not between 1 and 160
    or world !~ '^[A-Za-z0-9_.:-]+$' or export !~ '^[A-Za-z0-9_.:-]+$'
    or octet_length(p_archive::text) > 65536
    or coalesce(jsonb_typeof(p_archive->'transcript'),'') <> 'array' then
    raise exception 'Invalid archive' using errcode = '22023';
  end if;
  if jsonb_array_length(p_archive->'transcript') not between 1 and 100 then
    raise exception 'Invalid archive' using errcode = '22023';
  end if;
  -- Lock the current campaign owner and encounter to serialize ownership changes,
  -- concurrent append requests, and unrelated encounter metadata updates.
  perform 1 from public.campaign where id = p_campaign_id and user_id = p_user_id for share;
  if not found then raise exception 'GM authorization required' using errcode = '42501'; end if;
  select * into e from public.encounter where id = p_encounter_id and campaign_id = p_campaign_id for update;
  if not found then raise exception 'GM authorization required' using errcode = '42501'; end if;
  select * into prior from public.wgui_foundry_combat_archive
    where encounter_id = p_encounter_id and world_id = world and export_id = export;
  if found then
    if prior.archive <> p_archive then raise exception 'Archive conflict' using errcode = '23505'; end if;
    return jsonb_build_object('receipt', prior.receipt, 'worldId', world, 'exportId', export, 'campaignId', p_campaign_id, 'encounterId', p_encounter_id, 'idempotent', true);
  end if;
  -- Protect a legacy key from being silently replaced by a different transcript.
  select v into legacy from jsonb_array_elements(
    case when jsonb_typeof(e.meta_data::jsonb #> '{foundry,combat_logs}') = 'array'
      then e.meta_data::jsonb #> '{foundry,combat_logs}' else '[]'::jsonb end
  ) as l(v) where v->>'worldId' = world and v->>'exportId' = export limit 1;
  if found and legacy <> p_archive then raise exception 'Archive conflict' using errcode = '23505'; end if;
  select count(*), coalesce(sum(octet_length(archive::text)),0) into log_count, log_bytes from public.wgui_foundry_combat_archive where encounter_id = p_encounter_id;
  if log_count >= 100 or log_bytes + octet_length(p_archive::text) > 1048576 then raise exception 'Archive capacity reached' using errcode = '54000'; end if;
  insert into public.wgui_foundry_combat_archive(encounter_id, world_id, export_id, archive)
    values (p_encounter_id, world, export, p_archive) returning receipt into receipt_id;
  -- The trigger merges the new canonical row into the current metadata. Do not
  -- touch combatants, dice state or unrelated metadata. The revision guard,
  -- when installed, advances the encounter revision once for this update.
  update public.encounter set meta_data = meta_data where id = p_encounter_id returning * into e;
  -- Do not acknowledge a new receipt if a partial deployment left the mirror
  -- trigger missing or broken. Raising here rolls back the canonical insert.
  if not exists (
    select 1 from jsonb_array_elements(case
      when jsonb_typeof(e.meta_data::jsonb #> '{foundry,combat_logs}') = 'array'
      then e.meta_data::jsonb #> '{foundry,combat_logs}' else '[]'::jsonb end) as m(value)
    where m.value = p_archive
  ) then
    raise exception 'Archive mirror is unavailable' using errcode = '55000';
  end if;
  return jsonb_build_object('receipt', receipt_id, 'worldId', world, 'exportId', export, 'campaignId', p_campaign_id, 'encounterId', p_encounter_id, 'idempotent', false);
end;
$$;
revoke all on function public.wgui_append_foundry_combat_archive(uuid,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.wgui_append_foundry_combat_archive(uuid,bigint,bigint,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
