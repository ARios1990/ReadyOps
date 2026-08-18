create or replace function public.portal_normalize_match_text(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.resolve_readymode_campaign(p_campaign_name text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with input as (
  select public.portal_normalize_match_text(p_campaign_name) as campaign_norm
), candidates as (
  select
    s.public_slug,
    c.name as company_name,
    c.state,
    case
      when i.campaign_norm = public.portal_normalize_match_text(c.name || ' ' || coalesce(c.state,'')) then 120
      when i.campaign_norm = public.portal_normalize_match_text(c.name) then 115
      when nullif(c.metro_tag,'') is not null and i.campaign_norm = public.portal_normalize_match_text(c.name || ' ' || c.metro_tag) then 110
      when i.campaign_norm like public.portal_normalize_match_text(c.name) || ' %' then 95
      when public.portal_normalize_match_text(c.name) like i.campaign_norm || ' %' then 90
      else 0
    end as score
  from public.roster_companies c
  join public.company_portal_settings s on s.company_id = c.id
  cross join input i
  where s.portal_enabled = true
    and s.allow_public_booking = true
    and i.campaign_norm <> ''
)
select coalesce(
  (
    select jsonb_build_object(
      'public_slug', public_slug,
      'company_name', company_name,
      'state', state
    )
    from candidates
    where score > 0
    order by score desc, length(company_name) desc
    limit 1
  ),
  '{}'::jsonb
);
$$;

revoke all on function public.resolve_readymode_campaign(text) from public;
grant execute on function public.resolve_readymode_campaign(text) to anon, authenticated;

revoke all on function public.portal_normalize_match_text(text) from public;
grant execute on function public.portal_normalize_match_text(text) to anon, authenticated;
