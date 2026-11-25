-- Isolated test DB; all fixtures roll back. Requires test_user_id.
\set ON_ERROR_STOP on
begin;
select set_config('wgui.copy_test_user', :'test_user_id', true);
create function pg_temp.skip_copy_encounter() returns trigger language plpgsql as $$
begin
  if new.name='wgui-72-hidden' and current_setting('wgui.copy_test_skip',true)='yes' then return null; end if;
  return new;
end;
$$;
create trigger wgui_72_skip before insert on public.encounter for each row execute function pg_temp.skip_copy_encounter();
do $$
declare
  owner_id uuid := current_setting('wgui.copy_test_user')::uuid;
  src bigint; dst bigint; op uuid := gen_random_uuid(); before_count bigint;
  prep jsonb; result jsonb;
begin
  insert into public.campaign(user_id,name,join_key,meta_data)
    values(owner_id,'wgui-72-source',gen_random_uuid()::text,'{}') returning id into src;
  result := public.wgui_copy_campaign_encounters(owner_id,src);
  if result->'encounterCount' <> '0'::jsonb or result->'encounters' <> '[]'::jsonb then raise exception 'Empty manifest invalid'; end if;
  -- Exceed the typical PostgREST 1000-row maximum.
  insert into public.encounter(user_id,campaign_id,name,icon,color,combatants,meta_data)
    select owner_id,src,'wgui-72-'||n,'sword','#ffffff','{"list":[]}','{}' from generate_series(1,1001) n;
  prep := public.wgui_copy_campaign_atomic(owner_id,src,op,'{}',true);
  if prep->'encounterCount' <> '1001'::jsonb or jsonb_array_length(prep->'encounterIds') <> 1001 then raise exception 'Prepare truncated'; end if;
  result := public.wgui_copy_campaign_encounters(owner_id,src);
  if result->'encounterCount' <> '1001'::jsonb or jsonb_array_length(result->'encounters') <> 1001 then raise exception 'Read truncated'; end if;
  insert into public.encounter(user_id,campaign_id,name,icon,color,combatants,meta_data)
    values(owner_id,src,'wgui-72-hidden','sword','#ffffff','{"list":[]}','{}');
  select count(*) into before_count from public.campaign where user_id=owner_id;
  begin
    perform public.wgui_copy_campaign_atomic(owner_id,src,op,'{}',false,prep->'encounterIds');
    raise exception 'Expected stale manifest failure';
  exception when sqlstate 'P0072' then null;
  end;
  prep := public.wgui_copy_campaign_atomic(owner_id,src,op,'{}',true);
  perform set_config('wgui.copy_test_skip','yes',true);
  begin
    perform public.wgui_copy_campaign_atomic(owner_id,src,op,'{}',false,prep->'encounterIds');
    raise exception 'Expected skipped row failure';
  exception when sqlstate 'P0072' then null;
  end;
  if (select count(*) from public.campaign where user_id=owner_id) <> before_count or
    exists(select 1 from public.wgui_campaign_copy_operation where operation_id=op and user_id=owner_id) then
    raise exception 'Incomplete copy left a campaign or receipt';
  end if;
  perform set_config('wgui.copy_test_skip','no',true);
  result := public.wgui_copy_campaign_atomic(owner_id,src,op,'{}',false,prep->'encounterIds');
  dst := (result->'created'->>'id')::bigint;
  if result->'encounterCount' <> '1002'::jsonb or (select count(*) from public.encounter where campaign_id=dst) <> 1002 then
    raise exception 'Complete copy count invalid';
  end if;
end;
$$;
rollback;
