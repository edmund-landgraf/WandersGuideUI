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
  if result->'campaign_id'<>'1'::jsonb or result->'combatants'<>roster or (result->'meta_data'-'encounter_revision')<>(meta-'encounter_revision') then raise exception 'Attach lost state'; end if;
end $$;
rollback;
