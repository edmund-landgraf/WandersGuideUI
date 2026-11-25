-- Disposable test database only, after archive fixture and both migrations.
do $$
declare rev bigint; stale_meta jsonb; stale_roster jsonb;
begin
  select meta_data, combatants into stale_meta, stale_roster from public.encounter where id=1;
  -- Existing narrow MCP writer: increment plus compare old revision (initially absent).
  update public.encounter set combatants='{"list":[{"hp":3}]}',
    meta_data=stale_meta || '{"encounter_revision":1}' where id=1 and meta_data->>'encounter_revision' is null;
  select (meta_data->>'encounter_revision')::bigint into rev from public.encounter where id=1;
  if rev <> 1 then raise exception 'Initial CAS revision mismatch'; end if;
  -- A full stale browser save must fail atomically.
  begin
    update public.encounter set meta_data=stale_meta, combatants=stale_roster where id=1;
    raise exception 'Stale full save succeeded';
  exception when serialization_failure then null;
  end;
  if not exists(select 1 from public.encounter where id=1 and combatants='{"list":[{"hp":3}]}' and meta_data->>'encounter_revision'='1') then
    raise exception 'Lost roster or revision';
  end if;
  -- A legitimate current browser save bumps the revision even without explicit CAS.
  update public.encounter set meta_data=meta_data || '{"description":"new"}' where id=1;
  if not exists(select 1 from public.encounter where id=1 and meta_data->>'encounter_revision'='2') then raise exception 'Browser revision not advanced'; end if;
  -- A delayed dice writer that captured revision 1 cannot erase revision 2.
  begin
    update public.encounter set meta_data=stale_meta || '{"encounter_revision":1,"dice_roll_log":[99]}' where id=1;
    raise exception 'Stale dice save succeeded';
  exception when serialization_failure then null;
  end;
  -- Archive RPC still works and preserves both the new revision and roster.
  perform public.wgui_append_foundry_combat_archive('00000000-0000-0000-0000-000000000001',1,1,
    '{"worldId":"test","exportId":"guard","transcript":[{"messageId":"test"}]}');
  if not exists(select 1 from public.encounter where id=1 and meta_data->>'encounter_revision'='3' and jsonb_array_length(meta_data#>'{foundry,combat_logs}')=1 and combatants='{"list":[{"hp":3}]}') then raise exception 'Archive integration failed'; end if;
end $$;
