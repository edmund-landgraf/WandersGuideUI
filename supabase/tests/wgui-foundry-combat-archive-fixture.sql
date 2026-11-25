-- Disposable CI database ONLY. Minimal tables mirror the fields this migration touches.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.campaign(id bigint primary key, user_id uuid not null);
create table public.encounter(id bigint primary key, campaign_id bigint not null references public.campaign(id), meta_data jsonb, combatants jsonb);
insert into public.campaign values (1,'00000000-0000-0000-0000-000000000001'), (2,'00000000-0000-0000-0000-000000000002');
insert into public.encounter values (1,1,'{"untouched":true,"foundry":{"other":1},"dice_roll_log":[1]}'::jsonb,'{"list":[{"hp":7}]}'::jsonb),(2,2,'{}','{}');
