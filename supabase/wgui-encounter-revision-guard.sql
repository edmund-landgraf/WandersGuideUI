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
commit;
