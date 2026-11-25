-- #75 isolated test DB, after both migrations. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
select set_config('wgui.copy_test_user', :'test_user_id', true);
do $$
declare
  owner_id uuid := current_setting('wgui.copy_test_user')::uuid;
  src bigint;
  dst bigint;
  op uuid := gen_random_uuid();
  before_count bigint;
  result jsonb;
  staged jsonb := '{"https://old.example/storage/v1/object/public/portraits/a.png":"https://new.example/storage/v1/object/public/portraits/b.png","/backgrounds/map.webp":"https://new.example/storage/v1/object/public/backgrounds/map.webp","https://cdn.example/canonical.png":"https://cdn.example/canonical.png"}';
begin
  insert into public.campaign(user_id,name,join_key,meta_data)
    values(owner_id,'wgui-75-source',gen_random_uuid()::text,'{"image_url":"/backgrounds/map.webp","party_ids":[99]}')
    returning id into src;
  insert into public.encounter(user_id,campaign_id,name,icon,color,combatants,meta_data) values
    (owner_id,src,'wgui-75-art','sword','#ffffff',
     '{"list":[{"type":"CHARACTER","data":{"details":{"image_url":"/portraits/skip.png"}}},{"type":"CREATURE","creature":{"details":{"image_url":"https://old.example/storage/v1/object/public/portraits/a.png"}},"data":{"details":{"image_url":"https://old.example/storage/v1/object/public/portraits/a.png","background_image_url":"https://cdn.example/canonical.png"}}}]}',
     '{"map_url":"/backgrounds/map.webp","initiative_log":[{"image_url":"/portraits/log.png"}],"description":"unchanged","source":{"url":"https://example.org/rules"}}');
  result := public.wgui_copy_campaign_atomic(owner_id,src,op,'{}',true);
  if jsonb_array_length(result->'assets') <> 3 or not (result->'assets' ? '/backgrounds/map.webp') then
    raise exception 'manifest did not deduplicate or exclude live player/log art';
  end if;
  select count(*) into before_count from public.campaign where user_id=owner_id;
  begin
    perform public.wgui_copy_campaign_atomic(owner_id,src,op,staged - '/backgrounds/map.webp');
    raise exception 'expected incomplete manifest to fail';
  exception when others then
    if sqlerrm <> 'Artwork manifest changed or is incomplete' then raise; end if;
  end;
  if (select count(*) from public.campaign where user_id=owner_id) <> before_count then
    raise exception 'incomplete art map left a campaign';
  end if;
  result := public.wgui_copy_campaign_atomic(owner_id,src,op,staged);
  dst := (result->'created'->>'id')::bigint;
  if result->'created'->'meta_data'->>'image_url' is distinct from staged->>'/backgrounds/map.webp' or
    not exists(select 1 from public.encounter where campaign_id=dst and
      meta_data::jsonb->>'map_url'=staged->>'/backgrounds/map.webp' and
      meta_data::jsonb#>>'{source,url}'='https://example.org/rules' and
      jsonb_array_length(combatants::jsonb->'list')=1 and
      combatants::jsonb#>>'{list,0,creature,details,image_url}'=staged->>'https://old.example/storage/v1/object/public/portraits/a.png' and
      combatants::jsonb#>>'{list,0,data,details,image_url}'=staged->>'https://old.example/storage/v1/object/public/portraits/a.png' and
      combatants::jsonb#>>'{list,0,data,details,background_image_url}'='https://cdn.example/canonical.png') then
    raise exception 'target artwork references were not rewritten correctly';
  end if;
  if public.wgui_copy_campaign_atomic(owner_id,src,op,'{}',true) <> result then
    raise exception 'prepare did not recover existing receipt';
  end if;
end;
$$;
rollback;
