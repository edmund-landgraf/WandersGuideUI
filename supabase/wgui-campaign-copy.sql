-- WGUI #73. Apply to the Wanderers Guide database before deploying the edge worker.
-- Re-runnable. The RPC is service-role-only; the edge worker authenticates/authorizes.
begin;

create table if not exists public.wgui_campaign_copy_operation (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  source_id bigint not null,
  target_id bigint not null,
  encounter_names jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.wgui_campaign_copy_operation enable row level security;
revoke all on public.wgui_campaign_copy_operation from public, anon, authenticated;

create or replace function public.wgui_copy_campaign_atomic(
  p_user_id uuid, p_source_id bigint, p_operation_id uuid, p_art_url text default null
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
  if nullif(p_art_url, '') is not null then
    campaign_meta := campaign_meta || jsonb_build_object('image_url', p_art_url);
  end if;

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
        jsonb_build_object('list', coalesce((
          select jsonb_agg(c.value order by c.ordinality)
          from jsonb_array_elements(coalesce(nullif(e.combatants::jsonb->'list', 'null'::jsonb), '[]'::jsonb))
            with ordinality as c(value, ordinality)
          where coalesce(c.value->>'type', 'CHARACTER') <> 'CHARACTER'
        ), '[]'::jsonb)),
        coalesce(nullif(e.meta_data::jsonb, 'null'::jsonb), '{}'::jsonb)
          - 'initiative_log' - 'dice_roll_log' - 'dice_roll_state'
      from public.encounter e where e.campaign_id = p_source_id
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
revoke all on function public.wgui_copy_campaign_atomic(uuid,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.wgui_copy_campaign_atomic(uuid,bigint,uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
