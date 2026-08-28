-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

create table if not exists public.agent_aliases (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  alias text not null,
  alias_key text generated always as (lower(btrim(alias))) stored,
  created_at timestamptz not null default now(),
  unique(alias_key)
);

alter table public.agent_aliases enable row level security;
drop policy if exists agent_aliases_admin_all on public.agent_aliases;
create policy agent_aliases_admin_all on public.agent_aliases for all to authenticated using (public.portal_is_admin()) with check (public.portal_is_admin());
revoke all on public.agent_aliases from anon;
grant select,insert,update,delete on public.agent_aliases to authenticated;

create table if not exists public.manager_portal_links (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  portal_slug text not null unique,
  access_token uuid not null default gen_random_uuid() unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists manager_portal_links_team_name_uidx on public.manager_portal_links(team_id, lower(btrim(name)));
alter table public.manager_portal_links enable row level security;
drop policy if exists manager_portal_links_admin_all on public.manager_portal_links;
create policy manager_portal_links_admin_all on public.manager_portal_links for all to authenticated using (public.portal_is_admin()) with check (public.portal_is_admin());
revoke all on public.manager_portal_links from anon;
grant select,insert,update,delete on public.manager_portal_links to authenticated;

create or replace function public.portal_resolve_agent_id(p_agent_name text, p_form_data jsonb)
returns uuid
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare v_id uuid; v_token uuid;
begin
  begin
    v_token := nullif(p_form_data->>'agent_token','')::uuid;
  exception when invalid_text_representation then v_token := null;
  end;

  if v_token is not null then
    select id into v_id from public.agents where access_token=v_token and active limit 1;
  end if;

  if v_id is null and nullif(trim(coalesce(p_agent_name,'')),'') is not null then
    select aa.agent_id into v_id
    from public.agent_aliases aa
    join public.agents a on a.id=aa.agent_id and a.active
    where aa.alias_key=lower(trim(p_agent_name))
    limit 1;
  end if;

  if v_id is null and nullif(trim(coalesce(p_agent_name,'')),'') is not null then
    select id into v_id from public.agents
    where active and lower(trim(name))=lower(trim(p_agent_name))
    order by id limit 1;
  end if;

  return v_id;
end;
$function$;

create or replace function public.get_manager_link_overview(
  p_access_token uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_manager public.manager_portal_links%rowtype;
  v_start date := coalesce(p_start_date,current_date-14);
  v_end date := coalesce(p_end_date,current_date+45);
begin
  select * into v_manager
  from public.manager_portal_links m
  where m.access_token=p_access_token and m.active;

  if v_manager.id is null then
    raise exception 'Manager link is invalid or disabled';
  end if;

  return jsonb_build_object(
    'manager',jsonb_build_object('id',v_manager.id,'name',v_manager.name,'portal_slug',v_manager.portal_slug),
    'team',(select jsonb_build_object('id',t.id,'name',t.name,'abbreviation',t.abbreviation) from public.teams t where t.id=v_manager.team_id),
    'agents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'name',a.name,'email',a.email,'active',a.active,'portal_slug',a.portal_slug,'access_token',a.access_token,'team_id',a.team_id,
        'total_leads',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and ap.appointment_date between v_start and v_end),
        'qc_pending',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and l.qc_status='pending' and ap.appointment_date between v_start and v_end),
        'approved',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and l.qc_status='approved' and ap.appointment_date between v_start and v_end),
        'denied',(select count(*) from public.portal_leads l join public.portal_appointments ap on ap.lead_id=l.id where l.agent_id=a.id and l.qc_status='denied' and ap.appointment_date between v_start and v_end)
      ) order by a.name)
      from public.agents a where a.team_id=v_manager.team_id and a.active
    ),'[]'::jsonb),
    'companies',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'public_slug',s.public_slug,'account_status',c.account_status) order by c.name)
      from public.roster_companies c
      left join public.company_portal_settings s on s.company_id=c.id
      where exists(select 1 from public.company_teams ct where ct.company_id=c.id and ct.team_id=v_manager.team_id)
         or (not exists(select 1 from public.company_teams ct2 where ct2.company_id=c.id) and c.team_id=v_manager.team_id)
    ),'[]'::jsonb),
    'range',jsonb_build_object('start_date',v_start,'end_date',v_end)
  );
end;
$function$;

revoke all on function public.get_manager_link_overview(uuid,date,date) from public;
grant execute on function public.get_manager_link_overview(uuid,date,date) to anon,authenticated;

-- Canonicalize existing people while preserving their existing private portal tokens.
update public.agents set name='Rios' where name='Rios-MSR';
update public.agents set name='Martin Cervantes' where name='Martin-MSR';
update public.agents set name='Mike' where name='Mike-MSR';
update public.agents set name='Ross' where name='Ross-MSR';
update public.agents set name='Agustin' where name='Agustin-OCTO';
update public.agents set name='Aldrin' where name='Aldrin-OCTO';
update public.agents set name='Dawn' where name='Dawn-OCTO';
update public.agents set name='Elle' where name='Elle-OCTO';
update public.agents set name='Jay' where name='Jay-OCTO';
update public.agents set name='Luis Flores' where name='Luis Flores-BRL';
update public.agents set name='Luis Maldonado' where name='Luis Maldonado-BRL';
update public.agents set name='Miguel' where name='Miguel-BRL';
update public.agents set name='Mike1' where name='Mike 1-BRL';
update public.agents set name='MikeVargas' where name='MikeVargas-BRL';
update public.agents set name='OsvaldoGarcia' where name='Osvaldo Garcia-BRL';
update public.agents set name='Jeremy' where name='Jeremy-BRL';
update public.agents set name='Joey' where name='Joey Chambers-BRL';
update public.agents set name='Jose' where name='Jose-BRL';
update public.agents set name='Josue' where name='Josue-BRL';
update public.agents set name='Kenny' where name='Kenny Woods-BRL';
update public.agents set name='Leon' where name='Leon-BRL';

-- Create missing requested agents. Non-MSR names are OCTO unless explicitly BRL below.
with octo as (select id from public.teams where abbreviation='OCTO' limit 1), names(name,slug) as (
  values
  ('Dave','dave-octo'),('Judah','judah-octo'),('Armand','armand-octo'),('Daisy','daisy-octo'),('Elijah','elijah-octo'),
  ('Erjesty','erjesty-octo'),('Giancarlo','giancarlo-octo'),('Jenelyn','jenelyn-octo'),('Jericho','jericho-octo'),
  ('Johnlie','johnlie-octo'),('Jonazon','jonazon-octo'),('Ruby','ruby-octo')
)
insert into public.agents(name,team_id,portal_slug)
select n.name,o.id,n.slug from names n cross join octo o
where not exists(select 1 from public.agents a where lower(trim(a.name))=lower(trim(n.name)) and a.team_id=o.id);

with msr as (select id from public.teams where abbreviation='MSR' limit 1), names(name,slug) as (
  values ('Chad-MSR','chad-msr'),('Joey-MSR','joey-msr'),('Yeni-MSR','yeni-msr')
)
insert into public.agents(name,team_id,portal_slug)
select n.name,m.id,n.slug from names n cross join msr m
where not exists(select 1 from public.agents a where lower(trim(a.name))=lower(trim(n.name)) and a.team_id=m.id);

with brl as (select id from public.teams where abbreviation='BRL' limit 1), names(name,slug) as (
  values ('Rafael','rafael-brl'),('Vincent','vincent-brl'),('Zenen','zenen-brl'),('Alex','alex-brl'),('Jose 1','jose-1-brl'),('Lilly','lilly-brl')
)
insert into public.agents(name,team_id,portal_slug)
select n.name,b.id,n.slug from names n cross join brl b
where not exists(select 1 from public.agents a where lower(trim(a.name))=lower(trim(n.name)) and a.team_id=b.id);

-- ReadyMode aliases: multiple login names resolve to one canonical agent/link.
with pairs(agent_name,alias) as (
 values
 ('Rios','Rios'),('Rios','Rios-CP'),('Rios','Rios-MSR'),
 ('Martin Cervantes','Martin-FWD'),('Martin Cervantes','Martin-MSR'),('Martin Cervantes','Martin Cervantes'),
 ('Mike','Mike'),('Mike','Mike-LV'),('Mike','Mike-BRL'),('Mike','Mike-UAC'),('Mike','Mike-MSR'),('Mike','Mike-IL'),
 ('Ross','Ross'),('Ross','Ross-MSR'),
 ('Agustin','Agustin'),('Agustin','Agustin-OCTO'),
 ('Aldrin','Aldrin'),('Aldrin','Aldrin-OCTO'),('Armand','Armand'),('Daisy','Daisy'),('Dawn','Dawn'),('Dawn','Dawn-OCTO'),
 ('Dave','Dave'),('Elijah','Elijah'),('Elle','Elle'),('Elle','Elle-OCTO'),('Erjesty','Erjesty'),('Giancarlo','Giancarlo'),
 ('Jay','Jay'),('Jay','Jay-OCTO'),('Jenelyn','Jenelyn'),('Jericho','Jericho'),('Johnlie','Johnlie'),('Jonazon','Jonazon'),('Judah','Judah'),('Ruby','Ruby'),
 ('Chad-MSR','Chad-MSR'),('Dopey-MSR','Dopey-MSR'),('Joey-MSR','Joey-MSR'),('Leah-MSR','Leah-MSR'),('Shorty-MSR','Shorty-MSR'),('Yeni-MSR','Yeni-MSR'),
 ('Luis Flores','Luis Flores'),('Luis Flores','Luis Flores-BRL'),('Luis Maldonado','Luis Maldonado'),('Luis Maldonado','Luis Maldonado-BRL'),
 ('Miguel','Miguel'),('Miguel','Miguel-BRL'),('Mike1','Mike1'),('Mike1','Mike 1-BRL'),('MikeVargas','MikeVargas'),('MikeVargas','MikeVargas-BRL'),
 ('OsvaldoGarcia','OsvaldoGarcia'),('OsvaldoGarcia','Osvaldo Garcia-BRL'),('Rafael','Rafael'),('Vincent','Vincent'),('Zenen','Zenen'),('Alex','Alex'),
 ('Jeremy','Jeremy'),('Jeremy','Jeremy-BRL'),('Joey','Joey'),('Joey','Joey Chambers-BRL'),('Jose','Jose'),('Jose','Jose-BRL'),('Jose 1','Jose 1'),
 ('Josue','Josue'),('Josue','Josue-BRL'),('Kenny','Kenny'),('Kenny','Kenny Woods-BRL'),('Leon','Leon'),('Leon','Leon-BRL'),('Lilly','Lilly')
)
insert into public.agent_aliases(agent_id,alias)
select a.id,p.alias
from pairs p
join public.agents a on lower(trim(a.name))=lower(trim(p.agent_name))
on conflict(alias_key) do update set agent_id=excluded.agent_id,alias=excluded.alias;

-- Private manager links, no password required.
with managers(name,team_abbr,slug) as (
  values ('Agustin','OCTO','agustin-octo-manager'),('Dave','OCTO','dave-octo-manager'),('Judah','OCTO','judah-octo-manager'),('Big Boy','BRL','big-boy-brl-manager')
)
insert into public.manager_portal_links(name,team_id,portal_slug)
select m.name,t.id,m.slug
from managers m join public.teams t on t.abbreviation=m.team_abbr
where not exists(select 1 from public.manager_portal_links x where x.team_id=t.id and lower(trim(x.name))=lower(trim(m.name)));

-- Apply the roles already represented by existing login accounts without requiring new credentials.
update public.profiles set role='admin', updated_at=now() where lower(email)='rios@mastersreadyservices.pro';
update public.profiles set role='qc', updated_at=now() where lower(display_name)='ross';
update public.profiles p set role='manager', team_id=t.id, updated_at=now()
from public.teams t where t.abbreviation='BRL' and lower(p.display_name)='big boy';
update public.profiles p set role='manager', team_id=t.id, updated_at=now()
from public.teams t where t.abbreviation='OCTO' and lower(p.email)='agustin@mastersreadyservices.pro';

