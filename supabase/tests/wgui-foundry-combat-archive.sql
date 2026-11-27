-- Run only against the disposable fixture DB, after the migration.
\set ON_ERROR_STOP on
begin;
do $$
declare
  gm uuid := '00000000-0000-0000-0000-000000000001';
  foreign_user uuid := '00000000-0000-0000-0000-000000000002';
  log jsonb := '{"worldId":"world","exportId":"combat:1","transcript":[{"messageId":"one"}]}'::jsonb;
  second_log jsonb := '{"worldId":"world","exportId":"combat:2","transcript":[{"messageId":"two"}]}'::jsonb;
  first_receipt jsonb;
  retry_receipt jsonb;
  current_row public.encounter%rowtype;
  denied boolean;
begin
  if has_function_privilege('authenticated','public.wgui_append_foundry_combat_archive(uuid,bigint,bigint,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.wgui_append_foundry_combat_archive(uuid,bigint,bigint,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.wgui_append_foundry_combat_archive(uuid,bigint,bigint,jsonb)','EXECUTE') then
    raise exception 'Wrong RPC grants';
  end if;
  denied := false;
  begin perform public.wgui_append_foundry_combat_archive(foreign_user,1,1,log);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Foreign GM authorized'; end if;
  denied := false;
  begin perform public.wgui_append_foundry_combat_archive(gm,1,2,log);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Foreign encounter authorized'; end if;
  first_receipt := public.wgui_append_foundry_combat_archive(gm,1,1,log);
  retry_receipt := public.wgui_append_foundry_combat_archive(gm,1,1,log);
  if first_receipt->>'receipt' is distinct from retry_receipt->>'receipt' or retry_receipt->>'idempotent' <> 'true' then
    raise exception 'Retry receipt changed';
  end if;
  denied := false;
  begin perform public.wgui_append_foundry_combat_archive(gm,1,1,log || '{"rounds":2}'::jsonb);
  exception when unique_violation then denied := true; end;
  if not denied then raise exception 'Conflicting duplicate accepted'; end if;
  select * into current_row from public.encounter where id=1;
  if current_row.meta_data->'dice_roll_log' <> '[1]'::jsonb or current_row.meta_data->>'untouched' <> 'true'
     or current_row.combatants <> '{"list":[{"hp":7}]}'::jsonb or current_row.meta_data#>'{foundry,other}' <> '1'::jsonb
     or current_row.meta_data#>'{foundry,combat_logs}' is distinct from jsonb_build_array(log) then
    raise exception 'Append changed unrelated metadata or combatants';
  end if;
  -- Simulate a stale whole-meta update created before the first archive commit.
  update public.encounter set meta_data = '{"untouched":true,"dice_roll_log":[2],"foundry":{"other":1}}' where id=1;
  perform public.wgui_append_foundry_combat_archive(gm,1,1,second_log);
  -- Attempt to overwrite archive with caller-controlled records.
  update public.encounter set meta_data = jsonb_set(meta_data,'{foundry,combat_logs}','[{"forged":true}]') where id=1;
  select * into current_row from public.encounter where id=1;
  if current_row.meta_data->'dice_roll_log' <> '[2]'::jsonb
     or current_row.meta_data#>'{foundry,combat_logs}' is distinct from jsonb_build_array(log,second_log) then
    raise exception 'Stale metadata or forged archive defeated preservation';
  end if;
  insert into public.encounter values (3,1,current_row.meta_data,current_row.combatants);
  if exists(select 1 from public.encounter where id=3 and meta_data#>'{foundry,combat_logs}' is not null) then
    raise exception 'Copied combat archives leaked';
  end if;
  delete from public.encounter where id=1;
  if exists(select 1 from public.wgui_foundry_combat_archive where encounter_id=1) then
    raise exception 'Orphaned archive records';
  end if;
end;
$$;
rollback;

-- A partial deployment must not persist or acknowledge an archive without its mirror.
begin;
alter table public.encounter disable trigger wgui_protect_foundry_combat_archive;
do $missing_archive_mirror$
begin
  begin
    perform public.wgui_append_foundry_combat_archive('00000000-0000-0000-0000-000000000001',1,1,
      '{"worldId":"test","exportId":"missing-mirror","transcript":[{"messageId":"one"}]}');
    raise exception 'Missing mirror was acknowledged';
  exception when object_not_in_prerequisite_state then null; end;
  if exists(select 1 from public.wgui_foundry_combat_archive where export_id='missing-mirror') then
    raise exception 'Failed mirror left a canonical receipt';
  end if;
end;
$missing_archive_mirror$;
rollback;
