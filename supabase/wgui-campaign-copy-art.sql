-- Apply after supabase/wgui-campaign-copy.sql (#73). Re-runnable.
begin;

-- #75: the same allowlist drives the manifest and transactional rewrite.
create or replace function public.wgui_copy_art_key(k text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select k in ('image_url','background_image_url','portrait_url','map_url','token_url','art_url',
    'token_image_url','map_image_url','background_url','imageUrl','backgroundImageUrl',
    'portraitUrl','mapUrl','tokenUrl','artUrl','tokenImageUrl','mapImageUrl','backgroundUrl');
$$;

create or replace function public.wgui_copy_art_refs(doc jsonb) returns setof text
language plpgsql immutable set search_path = pg_catalog, public as $$
declare k text; v jsonb; ref text;
begin
  if jsonb_typeof(doc) = 'object' then
    for k,v in select key,value from jsonb_each(doc) loop
      if public.wgui_copy_art_key(k) and jsonb_typeof(v) = 'string' then
        ref := v #>> '{}';
        if btrim(ref) <> '' and btrim(ref) !~* '^data:image/' then return next ref; end if;
      elsif jsonb_typeof(v) in ('object','array') then
        return query select * from public.wgui_copy_art_refs(v);
      end if;
    end loop;
  elsif jsonb_typeof(doc) = 'array' then
    for v in select value from jsonb_array_elements(doc) loop
      return query select * from public.wgui_copy_art_refs(v);
    end loop;
  end if;
end;
$$;

create or replace function public.wgui_copy_art_rewrite(doc jsonb, art_map jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog, public as $$
declare k text; v jsonb; ref text; result jsonb;
begin
  if jsonb_typeof(doc) = 'object' then
    result := '{}'::jsonb;
    for k,v in select key,value from jsonb_each(doc) loop
      if public.wgui_copy_art_key(k) and jsonb_typeof(v) = 'string' then
        ref := v #>> '{}';
        if btrim(ref) <> '' and btrim(ref) !~* '^data:image/' then
          if coalesce(jsonb_typeof(art_map->ref),'missing') <> 'string' or btrim(art_map->>ref) = '' then
            raise exception 'Artwork manifest changed or is incomplete';
          end if;
          v := art_map->ref;
        end if;
      elsif jsonb_typeof(v) in ('object','array') then
        v := public.wgui_copy_art_rewrite(v, art_map);
      end if;
      result := result || jsonb_build_object(k,v);
    end loop;
    return result;
  elsif jsonb_typeof(doc) = 'array' then
    select coalesce(jsonb_agg(public.wgui_copy_art_rewrite(value,art_map) order by ordinality),'[]'::jsonb)
      into result from jsonb_array_elements(doc) with ordinality;
    return result;
  end if;
  return doc;
end;
$$;

create or replace function public.wgui_copy_encounter_document(combatants jsonb, meta jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'combatants', jsonb_build_object('list', coalesce((
      select jsonb_agg(c.value order by c.ordinality)
      from jsonb_array_elements(coalesce(nullif(combatants->'list','null'::jsonb),'[]'::jsonb))
        with ordinality as c(value,ordinality)
      where coalesce(c.value->>'type','CHARACTER') <> 'CHARACTER'
    ),'[]'::jsonb)),
    'meta_data', coalesce(nullif(meta,'null'::jsonb),'{}'::jsonb)
      - 'initiative_log' - 'dice_roll_log' - 'dice_roll_state'
  );
$$;

revoke all on function public.wgui_copy_art_key(text) from public, anon, authenticated;
revoke all on function public.wgui_copy_art_refs(jsonb) from public, anon, authenticated;
revoke all on function public.wgui_copy_art_rewrite(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.wgui_copy_encounter_document(jsonb,jsonb) from public, anon, authenticated;

-- Retire the prior signature rather than leaving a legacy path that skips artwork.
drop function if exists public.wgui_copy_campaign_atomic(uuid,bigint,uuid,text);

create or replace function public.wgui_copy_campaign_atomic(
  p_user_id uuid, p_source_id bigint, p_operation_id uuid, p_art_map jsonb default '{}'::jsonb, p_prepare boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prior public.wgui_campaign_copy_operation%rowtype;
  source_row public.campaign%rowtype;
  target_row public.campaign%rowtype;
  copied_names jsonb;
  campaign_meta jsonb;
  manifest jsonb;
begin
  if p_user_id is null or p_source_id is null or p_source_id <= 0 or p_operation_id is null then
    raise exception 'Invalid copy operation';
  end if;

  -- Serialize identical retries, including concurrent requests from a lost response.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_operation_id::text, 0));

  select * into prior from public.wgui_campaign_copy_operation
    where user_id = p_user_id and operation_id = p_operation_id;
  if found then
    if prior.source_id <> p_source_id then
      raise exception 'Copy operation belongs to a different source';
    end if;
    select * into target_row from public.campaign
      where id = prior.target_id and user_id = p_user_id;
    if not found then
      raise exception 'Previously copied campaign no longer exists';
    end if;
    return jsonb_build_object('created', to_jsonb(target_row), 'encounterNames', prior.encounter_names);
  end if;

  select * into strict source_row from public.campaign where id = p_source_id;
  campaign_meta := coalesce(nullif(source_row.meta_data::jsonb, 'null'::jsonb), '{}'::jsonb)
    || jsonb_build_object('party_ids', '[]'::jsonb);
  if p_prepare then
    select coalesce(jsonb_agg(distinct ref order by ref),'[]'::jsonb) into manifest
    from (
      select public.wgui_copy_art_refs(campaign_meta) as ref
      union all
      select public.wgui_copy_art_refs(public.wgui_copy_encounter_document(e.combatants::jsonb,e.meta_data::jsonb))
        from public.encounter e where e.campaign_id = p_source_id
    ) refs;
    return jsonb_build_object('assets',manifest);
  end if;
  campaign_meta := public.wgui_copy_art_rewrite(campaign_meta,coalesce(p_art_map,'{}'::jsonb));

  insert into public.campaign
    (user_id, name, description, join_key, notes, recommended_options,
     recommended_variants, recommended_content_sources, meta_data)
  values
    (p_user_id, source_row.name, coalesce(source_row.description, 'A new adventure begins...'),
     replace(gen_random_uuid()::text, '-', ''), source_row.notes, source_row.recommended_options,
     source_row.recommended_variants, source_row.recommended_content_sources, campaign_meta)
  returning * into target_row;

  -- All source encounters are read in the database, not from a filtered or
  -- paginated player-facing API. Any failure aborts the campaign AND all encounters.
  with copied as (
    insert into public.encounter (user_id, name, icon, color, campaign_id, combatants, meta_data)
      select p_user_id, e.name, e.icon, e.color, target_row.id,
        rewritten.doc->'combatants', rewritten.doc->'meta_data'
      from public.encounter e
      cross join lateral (
        select public.wgui_copy_art_rewrite(
          public.wgui_copy_encounter_document(e.combatants::jsonb,e.meta_data::jsonb),
          coalesce(p_art_map,'{}'::jsonb)
        ) as doc
      ) rewritten
      where e.campaign_id = p_source_id
      order by e.id
      returning id, name
  )
  select coalesce(jsonb_agg(name order by id), '[]'::jsonb) into copied_names from copied;

  insert into public.wgui_campaign_copy_operation
    (user_id, operation_id, source_id, target_id, encounter_names)
  values (p_user_id, p_operation_id, p_source_id, target_row.id, copied_names);

  return jsonb_build_object('created', to_jsonb(target_row), 'encounterNames', copied_names);
end;
$$;
revoke all on function public.wgui_copy_campaign_atomic(uuid,bigint,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.wgui_copy_campaign_atomic(uuid,bigint,uuid,jsonb,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
