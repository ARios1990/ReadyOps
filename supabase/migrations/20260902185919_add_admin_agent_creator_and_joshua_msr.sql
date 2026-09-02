-- Give administrators one safe entry point for creating roster agents. The
-- canonical stored name always carries the selected team's abbreviation so
-- form submissions, reporting, and portal pages use the same identity.
create or replace function public.create_agent_admin(
  p_name text,
  p_team_id uuid,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_base_name text;
  v_canonical_name text;
  v_agent public.agents%rowtype;
begin
  if auth.uid() is null or not public.portal_is_admin() then
    raise exception 'ReadyOps administrator access required';
  end if;

  v_base_name := nullif(trim(p_name), '');
  if v_base_name is null then
    raise exception 'Agent name is required';
  end if;

  select *
    into v_team
  from public.teams
  where id = p_team_id;

  if v_team.id is null then
    raise exception 'A valid team is required';
  end if;

  -- Do not double-append the suffix if an administrator enters Joshua-MSR.
  if lower(right(v_base_name, length(v_team.abbreviation) + 1)) =
     lower('-' || v_team.abbreviation) then
    v_base_name := nullif(trim(left(
      v_base_name,
      length(v_base_name) - length(v_team.abbreviation) - 1
    )), '');
  end if;

  if v_base_name is null then
    raise exception 'Agent name is required';
  end if;

  v_canonical_name := v_base_name || '-' || trim(v_team.abbreviation);

  if exists (
    select 1
    from public.agents a
    where a.team_id = v_team.id
      and lower(trim(a.name)) = lower(v_canonical_name)
  ) then
    raise exception 'Agent % already exists on team %', v_canonical_name, v_team.abbreviation;
  end if;

  insert into public.agents (name, team_id, email, active)
  values (v_canonical_name, v_team.id, nullif(trim(p_email), ''), true)
  returning * into v_agent;

  update public.agents
  set portal_slug = trim(both '-' from regexp_replace(
        lower(v_canonical_name), '[^a-z0-9]+', '-', 'g'
      )) || '-' || left(v_agent.id::text, 8)
  where id = v_agent.id
  returning * into v_agent;

  -- The canonical alias is authoritative. The short alias is also useful for
  -- older forms, but is only added when another agent does not already own it.
  insert into public.agent_aliases (agent_id, alias)
  values (v_agent.id, v_canonical_name)
  on conflict (alias_key) do nothing;

  insert into public.agent_aliases (agent_id, alias)
  values (v_agent.id, v_base_name)
  on conflict (alias_key) do nothing;

  return jsonb_build_object(
    'id', v_agent.id,
    'name', v_agent.name,
    'team_id', v_agent.team_id,
    'email', v_agent.email,
    'portal_slug', v_agent.portal_slug,
    'access_token', v_agent.access_token,
    'active', v_agent.active
  );
end;
$$;

revoke all on function public.create_agent_admin(text, uuid, text) from public;
revoke all on function public.create_agent_admin(text, uuid, text) from anon;
grant execute on function public.create_agent_admin(text, uuid, text) to authenticated;

comment on function public.create_agent_admin(text, uuid, text) is
  'Admin-only agent creator. Stores Name-TEAM as the canonical name and registers form aliases.';

-- Add Joshua to Masters Ready Services once. This is idempotent so the
-- migration remains safe if a matching record was created manually first.
do $$
declare
  v_team_id uuid;
  v_agent_id uuid;
begin
  select id into v_team_id
  from public.teams
  where upper(trim(abbreviation)) = 'MSR'
  order by id
  limit 1;

  if v_team_id is null then
    raise exception 'MSR team not found';
  end if;

  select id into v_agent_id
  from public.agents
  where team_id = v_team_id
    and lower(trim(name)) in ('joshua', 'joshua-msr')
  order by case when lower(trim(name)) = 'joshua-msr' then 0 else 1 end
  limit 1;

  if v_agent_id is null then
    insert into public.agents (name, team_id, active)
    values ('Joshua-MSR', v_team_id, true)
    returning id into v_agent_id;
  else
    update public.agents
    set name = 'Joshua-MSR',
        team_id = v_team_id,
        active = true
    where id = v_agent_id;
  end if;

  update public.agents
  set portal_slug = coalesce(
        nullif(trim(portal_slug), ''),
        'joshua-msr-' || left(v_agent_id::text, 8)
      ),
      access_token = coalesce(access_token, gen_random_uuid())
  where id = v_agent_id;

  insert into public.agent_aliases (agent_id, alias)
  values (v_agent_id, 'Joshua-MSR')
  on conflict (alias_key) do update
    set agent_id = excluded.agent_id,
        alias = excluded.alias;

  insert into public.agent_aliases (agent_id, alias)
  values (v_agent_id, 'Joshua')
  on conflict (alias_key) do update
    set agent_id = excluded.agent_id,
        alias = excluded.alias;
end;
$$;
