-- Disposable fixture only; add production fields omitted from the archive fixture.
begin;
alter table public.encounter add column user_id uuid;
alter table public.encounter add column name text default 'Fixture';
alter table public.encounter add column icon text default 'combat';
alter table public.encounter add column color text default 'blue';
alter table public.encounter alter column campaign_id drop not null;
update public.encounter e set user_id=c.user_id from public.campaign c where e.campaign_id=c.id;
do $$
declare owner_id uuid:='00000000-0000-0000-0000-000000000001'; outsider uuid:='00000000-0000-0000-0000-000000000002';
  rev bigint; result jsonb; roster jsonb; meta jsonb;
begin
  select (meta_data->>'encounter_revision')::bigint,combatants,meta_data into rev,roster,meta from public.encounter where id=1;
  result:=public.wgui_save_encounter_revision(owner_id,1,rev,'{"name":"Renamed"}');
  if result->>'name'<>'Renamed' or (result#>>'{meta_data,encounter_revision}')::bigint<>rev+1 or result->'combatants'<>roster then raise exception 'Rename lost combat state'; end if;
  begin
    perform public.wgui_save_encounter_revision(owner_id,1,rev,'{"combatants":{"list":[]}}');
    raise exception 'Stale save succeeded';
  exception when serialization_failure then null; end;
  begin
    perform public.wgui_save_encounter_revision(outsider,1,rev+1,'{"name":"Unauthorized"}');
    raise exception 'Unauthorized save succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.wgui_save_encounter_revision(owner_id,1,rev+1,'{"campaign_id":2}');
    raise exception 'Unauthorized transfer succeeded';
  exception when insufficient_privilege then null; end;
  result:=public.wgui_save_encounter_revision(owner_id,1,rev+1,'{"campaign_id":null}');
  if result->'campaign_id'<>'null'::jsonb then raise exception 'Detach failed'; end if;
  result:=public.wgui_save_encounter_revision(owner_id,1,rev+2,'{"campaign_id":1}');
  if result->'campaign_id'<>'1'::jsonb or result->'combatants'<>roster or ((result->'meta_data') - 'encounter_revision'::text) <> (meta - 'encounter_revision'::text) then raise exception 'Attach lost state'; end if;
end $$;

-- Exercise the production save RPC and archive RPC together, under both triggers.
do $archive_revision_interleaving$
declare gm uuid:='00000000-0000-0000-0000-000000000001';
  rev bigint; roster jsonb; meta jsonb; first_receipt jsonb; retry_receipt jsonb; saved jsonb;
  log jsonb:='{"worldId":"test","exportId":"save-archive-race","transcript":[{"messageId":"new"}]}';
begin
  select (meta_data->>'encounter_revision')::bigint,combatants,meta_data into rev,roster,meta from public.encounter where id=1;
  first_receipt:=public.wgui_append_foundry_combat_archive(gm,1,1,log);
  retry_receipt:=public.wgui_append_foundry_combat_archive(gm,1,1,log);
  if first_receipt->>'receipt' is distinct from retry_receipt->>'receipt' or retry_receipt->>'idempotent' is distinct from 'true' then
    raise exception 'Archive retry changed receipt';
  end if;
  if not exists(select 1 from public.encounter where id=1 and meta_data->>'encounter_revision'=(rev+1)::text and combatants=roster
    and meta_data#>'{foundry,combat_logs}' @> jsonb_build_array(log)) then
    raise exception 'Append/retry must advance revision exactly once and preserve roster';
  end if;
  begin
    perform public.wgui_save_encounter_revision(gm,1,rev,jsonb_build_object('combatants','{"list":[]}'::jsonb,'meta_data',meta));
    raise exception 'Pre-archive snapshot was accepted';
  exception when serialization_failure then null; end;
  saved:=public.wgui_save_encounter_revision(gm,1,rev+1,jsonb_build_object('name','After archive','meta_data',meta));
  if (saved#>>'{meta_data,encounter_revision}')::bigint is distinct from rev+2
    or saved->'combatants' is distinct from roster
    or not coalesce(saved#>'{meta_data,foundry,combat_logs}' @> jsonb_build_array(log),false) then
    raise exception 'Current CAS save lost archive or roster';
  end if;
end;
$archive_revision_interleaving$;
rollback;
