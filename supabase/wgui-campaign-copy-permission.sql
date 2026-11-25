-- #71: explicit owner consent, private by default. Apply after #73 and #75.
begin;
create table if not exists public.wgui_campaign_copy_permission (
  campaign_id bigint primary key references public.campaign(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  enabled_at timestamptz not null default now()
);
alter table public.wgui_campaign_copy_permission enable row level security;
revoke all on public.wgui_campaign_copy_permission from public, anon, authenticated;
grant select on public.wgui_campaign_copy_permission to service_role;

-- Only the trusted edge passes a verified caller identity. Recheck current ownership
-- and serialize permission changes against the copy transaction.
create or replace function public.wgui_set_campaign_copy_permission(
  p_user_id uuid, p_campaign_id bigint, p_enabled boolean
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare current_owner text;
begin
  select user_id::text into current_owner from public.campaign where id = p_campaign_id for update;
  if not found or p_user_id is null or current_owner is distinct from p_user_id::text or p_enabled is null then
    raise exception 'Only the campaign owner may change copy permission' using errcode = '42501';
  end if;
  if p_enabled then
    insert into public.wgui_campaign_copy_permission(campaign_id, owner_id)
      values(p_campaign_id,p_user_id)
      on conflict(campaign_id) do update set owner_id = excluded.owner_id, enabled_at = now();
  else
    delete from public.wgui_campaign_copy_permission where campaign_id = p_campaign_id;
  end if;
end;
$$;
revoke all on function public.wgui_set_campaign_copy_permission(uuid,bigint,boolean) from public, anon, authenticated;
grant execute on function public.wgui_set_campaign_copy_permission(uuid,bigint,boolean) to service_role;

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

  -- The edge checks normal readability as well as copy consent. Recheck owner/consent
  -- in the transaction and lock the rows so revocation cannot race a new copy.
  select * into source_row from public.campaign where id = p_source_id for share;
  if not found then
    raise exception 'Campaign copy not permitted' using errcode = '42501';
  end if;
  if source_row.user_id::text <> p_user_id::text then
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
    return jsonb_build_object('created', to_jsonb(target_row), 'encounterNames', prior.encounter_names);
  end if;

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
