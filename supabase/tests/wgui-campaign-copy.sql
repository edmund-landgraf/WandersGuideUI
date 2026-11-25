-- Isolated test DB only; requires an existing auth user. Everything is rolled back.
\set ON_ERROR_STOP on
begin;
select set_config('wgui.copy_test_user', :'test_user_id', true);

create function pg_temp.reject_copy_encounter() returns trigger language plpgsql as $$
begin
  if new.name = 'wgui-73-fail' and current_setting('wgui.copy_test_fail', true) = 'yes' then
    raise exception 'injected encounter failure';
  end if;
  return new;
end;
$$;
create trigger wgui_73_test_failure before insert on public.encounter
for each row execute function pg_temp.reject_copy_encounter();

do $$
declare
  owner_id uuid := current_setting('wgui.copy_test_user')::uuid;
  source_id bigint;
  target_id bigint;
  op uuid := gen_random_uuid();
  second_op uuid := gen_random_uuid();
  before_count bigint;
  result jsonb;
  replay jsonb;
begin
  insert into public.campaign(user_id,name,join_key,meta_data)
    values(owner_id,'wgui-73-source',gen_random_uuid()::text,'{"party_ids":[123],"encounter_folders":[{"id":"a"}]}')
    returning id into source_id;
  insert into public.encounter(user_id,campaign_id,name,icon,color,combatants,meta_data)
    values
      (owner_id,source_id,'wgui-73-first','sword','#ffffff','{"list":[{"type":"CHARACTER"},{"type":"CREATURE"}]}','{"folder_id":"a","initiative_log":[]}'),
      (owner_id,source_id,'wgui-73-fail','sword','#ffffff','{"list":[]}','{}');
  select count(*) into before_count from public.campaign where user_id=owner_id;
  perform set_config('wgui.copy_test_fail','yes',true);
  begin
    perform public.wgui_copy_campaign_atomic(owner_id,source_id,op,null);
    raise exception 'expected copy to fail';
  exception when others then
    if sqlerrm <> 'injected encounter failure' then raise; end if;
  end;
  if (select count(*) from public.campaign where user_id=owner_id) <> before_count or
     exists(select 1 from public.wgui_campaign_copy_operation where user_id=owner_id and operation_id=op) then
    raise exception 'failed transaction left a campaign or receipt';
  end if;
  perform set_config('wgui.copy_test_fail','no',true);
  result := public.wgui_copy_campaign_atomic(owner_id,source_id,op,null);
  target_id := (result->'created'->>'id')::bigint;
  replay := public.wgui_copy_campaign_atomic(owner_id,source_id,op,null);
  if replay <> result or jsonb_array_length(result->'encounterNames') <> 2 or
     (select count(*) from public.encounter where campaign_id=target_id) <> 2 or
     (select count(*) from public.campaign where user_id=owner_id) <> before_count + 1 then
    raise exception 'copy or retry count incorrect';
  end if;
  if result->'created'->'meta_data'->'party_ids' <> '[]'::jsonb or
     result->'created'->'meta_data'->'encounter_folders' is distinct from '[{"id":"a"}]'::jsonb or
     exists(select 1 from public.encounter where campaign_id=target_id and name='wgui-73-first'
       and (combatants::jsonb->'list' <> '[{"type":"CREATURE"}]'::jsonb or meta_data::jsonb ? 'initiative_log')) then
    raise exception 'copy did not preserve/reset expected data';
  end if;
  if (public.wgui_copy_campaign_atomic(owner_id,source_id,second_op,null)->'created'->>'id')::bigint = target_id then
    raise exception 'new operation should create a distinct campaign';
  end if;
end;
$$;
rollback;
