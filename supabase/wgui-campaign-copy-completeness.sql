-- #72: complete, snapshot-consistent encounter manifests. Apply after #71.
begin;

create or replace function public.wgui_copy_campaign_encounters(p_user_id uuid,p_source_id bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare source_row public.campaign%rowtype; result jsonb;
begin
  if p_user_id is null or p_source_id is null or p_source_id <= 0 then
    raise exception 'Campaign copy not permitted' using errcode = '42501';
  end if;
  -- The edge checks normal readability as well as copy consent. Recheck owner/consent
  -- in the transaction and lock the rows so revocation cannot race a new copy.
  select * into source_row from public.campaign where id = p_source_id for share;
  if not found then
    raise exception 'Campaign copy not permitted' using errcode = '42501';
  end if;
  if source_row.user_id::text is distinct from p_user_id::text then
    perform 1 from public.wgui_campaign_copy_permission
      where campaign_id = p_source_id and owner_id::text = source_row.user_id::text
      for share;
    if not found then
      raise exception 'Campaign copy not permitted' using errcode = '42501';
    end if;
  end if;


  -- A single scalar JSON result avoids the REST max_rows limit; the count and
  -- array are derived in the same SQL statement, including the confirmed empty case.
  select jsonb_build_object('campaignId',p_source_id,'encounterCount',count(*),
    'encounters',coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb))
    into result from public.encounter e where e.campaign_id=p_source_id;
  return result;
end;
$$;
revoke all on function public.wgui_copy_campaign_encounters(uuid,bigint) from public,anon,authenticated;
grant execute on function public.wgui_copy_campaign_encounters(uuid,bigint) to service_role;

-- Remove the previous signature so an older RPC cannot bypass completeness checks.
drop function if exists public.wgui_copy_campaign_atomic(uuid,bigint,uuid,jsonb,boolean);
create or replace function public.wgui_copy_campaign_atomic(
  p_user_id uuid, p_source_id bigint, p_operation_id uuid, p_art_map jsonb default '{}'::jsonb, p_prepare boolean default false, p_expected_encounter_ids jsonb default null
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
  source_encounters jsonb;
  source_ids jsonb;
  source_count bigint;
begin
  if p_user_id is null or p_source_id is null or p_source_id <= 0 or p_operation_id is null then
    raise exception 'Invalid copy operation';
  end if;

  -- The edge checks normal readability as well as copy consent. Recheck owner/consent
  -- in the transaction and lock the rows so revocation cannot race a new copy.
  select * into source_row from public.campaign where id = p_source_id for share;
  if not found then
    raise exception 'Campaign copy not permitted' using errcode = '42501';
  end if;
  if source_row.user_id::text is distinct from p_user_id::text then
    perform 1 from public.wgui_campaign_copy_permission
      where campaign_id = p_source_id and owner_id::text = source_row.user_id::text
      for share;
    if not found then
      raise exception 'Campaign copy not permitted' using errcode = '42501';
    end if;
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
    return jsonb_build_object('created', to_jsonb(target_row), 'encounterNames', prior.encounter_names, 'encounterCount', jsonb_array_length(prior.encounter_names));
  end if;

  campaign_meta := coalesce(nullif(source_row.meta_data::jsonb, 'null'::jsonb), '{}'::jsonb)
    || jsonb_build_object('party_ids', '[]'::jsonb);
  -- Freeze the source rows before inserting anything. Both prepare and commit
  -- derive their counts and IDs from a single database snapshot.
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb),
         coalesce(jsonb_agg(e.id order by e.id),'[]'::jsonb), count(*)
    into source_encounters,source_ids,source_count
    from public.encounter e where e.campaign_id=p_source_id;
  if p_prepare then
    select coalesce(jsonb_agg(distinct ref order by ref),'[]'::jsonb) into manifest
    from (
      select public.wgui_copy_art_refs(campaign_meta) as ref
      union all
      select public.wgui_copy_art_refs(public.wgui_copy_encounter_document(e.combatants::jsonb,e.meta_data::jsonb))
        from jsonb_populate_recordset(null::public.encounter,source_encounters) e
    ) refs;
    return jsonb_build_object('assets',manifest,'campaignId',p_source_id,
      'encounterCount',source_count,'encounterIds',source_ids);
  end if;
  if p_expected_encounter_ids is not null and p_expected_encounter_ids is distinct from source_ids then
    raise exception 'Source encounter list changed; prepare the copy again' using errcode = 'P0072';
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
      from jsonb_populate_recordset(null::public.encounter,source_encounters) e
      cross join lateral (
        select public.wgui_copy_art_rewrite(
          public.wgui_copy_encounter_document(e.combatants::jsonb,e.meta_data::jsonb),
          coalesce(p_art_map,'{}'::jsonb)
        ) as doc
      ) rewritten
      order by e.id
      returning id, name
  )
  select coalesce(jsonb_agg(name order by id), '[]'::jsonb) into copied_names from copied;

  if jsonb_array_length(copied_names) <> source_count or
      (select count(*) from public.encounter where campaign_id=target_row.id) <> source_count then
    raise exception 'Incomplete campaign encounter copy' using errcode = 'P0072';
  end if;

  insert into public.wgui_campaign_copy_operation
    (user_id, operation_id, source_id, target_id, encounter_names)
  values (p_user_id, p_operation_id, p_source_id, target_row.id, copied_names);

  return jsonb_build_object('created', to_jsonb(target_row), 'encounterNames', copied_names, 'encounterCount', source_count);
end;
$$;
revoke all on function public.wgui_copy_campaign_atomic(uuid,bigint,uuid,jsonb,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.wgui_copy_campaign_atomic(uuid,bigint,uuid,jsonb,boolean,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
