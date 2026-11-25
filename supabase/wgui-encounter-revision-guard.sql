-- WGUI #66: database-side compare-and-swap for existing full-row and narrow writers.
-- Deploy only after staging against the stock create-encounter handler.
begin;
create or replace function public.wgui_guard_encounter_revision()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  prior jsonb := coalesce(old.meta_data::jsonb, '{}'::jsonb);
  incoming jsonb := coalesce(new.meta_data::jsonb, '{}'::jsonb);
  old_revision bigint := 0;
  supplied_revision bigint := 0;
begin
  if jsonb_typeof(prior) <> 'object' or jsonb_typeof(incoming) <> 'object' then
    raise exception 'Invalid encounter metadata' using errcode = '22023';
  end if;
  if prior ? 'encounter_revision' then
    if jsonb_typeof(prior->'encounter_revision') <> 'number' or
       (prior->>'encounter_revision') !~ '^[0-9]{1,16}$' then
      raise exception 'Invalid stored encounter revision' using errcode = '22023';
    end if;
    old_revision := (prior->>'encounter_revision')::bigint;
  end if;
  if incoming ? 'encounter_revision' then
    if jsonb_typeof(incoming->'encounter_revision') <> 'number' or
       (incoming->>'encounter_revision') !~ '^[0-9]{1,16}$' then
      raise exception 'Invalid encounter revision' using errcode = '22023';
    end if;
    supplied_revision := (incoming->>'encounter_revision')::bigint;
  end if;
  if old_revision >= 9007199254740991 then
    raise exception 'Encounter revision exhausted' using errcode = '22023';
  end if;
  -- Legacy full-row writers send the revision they read. Existing narrow CAS
  -- writers send old+1 and additionally constrain the UPDATE to old revision.
  -- A writer that omitted meta_data receives the current metadata from Postgres.
  if supplied_revision <> old_revision and supplied_revision <> old_revision + 1 then
    raise exception 'Encounter changed in another browser. Reload it and retry.' using errcode = '40001';
  end if;
  new.meta_data := jsonb_set(incoming, '{encounter_revision}', to_jsonb(old_revision + 1), true);
  return new;
end;
$$;
drop trigger if exists wgui_guard_encounter_revision on public.encounter;
create trigger wgui_guard_encounter_revision before update on public.encounter
for each row execute function public.wgui_guard_encounter_revision();

-- Explicit owner-only CAS for updates; stock create remains for inserts only.
-- Lock campaign ownership before the encounter, in the same order as the archive RPC.
create or replace function public.wgui_save_encounter_revision(
  p_user_id uuid,p_encounter_id bigint,p_revision bigint,p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog,public as $
declare e public.encounter%rowtype; source_campaign bigint; destination_campaign bigint;
  actual_revision bigint; next_meta jsonb; locked_campaign bigint;
begin
  if p_user_id is null or p_encounter_id is null or p_encounter_id <= 0 or
    p_revision is null or p_revision < 0 or p_revision >= 9007199254740991 or
    jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb or
    exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('name','icon','color','campaign_id','combatants','meta_data')) or
    (p_patch ? 'name' and (jsonb_typeof(p_patch->'name') is distinct from 'string' or btrim(p_patch->>'name')='')) or
    (p_patch ? 'icon' and jsonb_typeof(p_patch->'icon') is distinct from 'string') or
    (p_patch ? 'color' and jsonb_typeof(p_patch->'color') is distinct from 'string') or
    (p_patch ? 'campaign_id' and jsonb_typeof(p_patch->'campaign_id') not in ('number','null')) or
    (p_patch ? 'campaign_id' and jsonb_typeof(p_patch->'campaign_id')='number' and (p_patch->>'campaign_id') !~ '^[1-9][0-9]{0,15}
) or
    (p_patch ? 'combatants' and (jsonb_typeof(p_patch->'combatants') is distinct from 'object' or jsonb_typeof(p_patch->'combatants'->'list') is distinct from 'array')) or
    (p_patch ? 'meta_data' and jsonb_typeof(p_patch->'meta_data') is distinct from 'object') then
    raise exception 'Invalid encounter update' using errcode='22023';
  end if;
  select * into e from public.encounter where id=p_encounter_id and user_id=p_user_id;
  if not found then raise exception 'Encounter update forbidden' using errcode='42501'; end if;
  source_campaign := e.campaign_id;
  destination_campaign := case when p_patch ? 'campaign_id' then (p_patch->>'campaign_id')::bigint else source_campaign end;
  -- A transfer must be authorized for BOTH campaigns, and ownership cannot change during the write.
  for locked_campaign in select distinct c from unnest(array[source_campaign,destination_campaign]) as u(c) where c is not null order by c loop
    perform 1 from public.campaign where id=locked_campaign and user_id=p_user_id for share;
    if not found then raise exception 'Encounter update forbidden' using errcode='42501'; end if;
  end loop;
  select * into e from public.encounter where id=p_encounter_id and user_id=p_user_id for update;
  if not found then raise exception 'Encounter update forbidden' using errcode='42501'; end if;
  actual_revision := coalesce((e.meta_data->>'encounter_revision')::bigint,0);
  if e.campaign_id is distinct from source_campaign or actual_revision <> p_revision then
    raise exception 'Encounter changed in another browser. Reload it and retry.' using errcode='40001';
  end if;
  next_meta := case when p_patch ? 'meta_data' then p_patch->'meta_data' else coalesce(e.meta_data::jsonb,'{}'::jsonb) end;
  -- The server owns the revision, not the caller's metadata.
  next_meta := jsonb_set(next_meta,'{encounter_revision}',to_jsonb(actual_revision),true);
  update public.encounter set
    name=case when p_patch ? 'name' then p_patch->>'name' else e.name end,
    icon=case when p_patch ? 'icon' then p_patch->>'icon' else e.icon end,
    color=case when p_patch ? 'color' then p_patch->>'color' else e.color end,
    campaign_id=destination_campaign,
    combatants=case when p_patch ? 'combatants' then p_patch->'combatants' else e.combatants end,
    meta_data=next_meta
    where id=e.id returning * into e;
  if (e.meta_data->>'encounter_revision')::bigint is distinct from actual_revision+1 then
    raise exception 'Encounter revision guard is unavailable' using errcode='55000';
  end if;
  return to_jsonb(e);
end;
$;
revoke all on function public.wgui_save_encounter_revision(uuid,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.wgui_save_encounter_revision(uuid,bigint,bigint,jsonb) to service_role;
notify pgrst, 'reload schema';

commit;
