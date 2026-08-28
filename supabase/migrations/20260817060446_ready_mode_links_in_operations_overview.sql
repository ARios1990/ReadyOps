-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

create or replace function public.ready_mode_prefill_query()
returns text
language sql
immutable
set search_path to ''
as $$
  select 'agent=(User.Name)&first_name=(Profile.First Name)&last_name=(Profile.Last Name)&phone=(Profile.Phone Number)&address=(Profile.Address)&city=(Profile.City)&state=(Profile.State)&zip=(Profile.Zip Code)&email=(Profile.Email)&language=(Profile.Language)&services_needed=(Profile.Services Needed)&last_checked=(Profile.Last Checked On)&home_type=(Profile.Home Type)&roof_type=(Profile.Roof Type)&roof_age=(Profile.Roof Age)&stories=(Profile.Stories)&insurance=(Profile.Insurance)&insurance_name=(Profile.Insurance Name)&contract=(Profile.Contract)&home_value=(Profile.Home Value)&sq_ft=(Profile.SQ FT)&web_url=(Profile.Web Url)&notes=(Profile.Notes)&hail_size=(Profile.Size of Hail)&claim_filed=(Profile.File Claim)&visible_damage=(Profile.Visible Damage)&damage_type=(Profile.Damage Type)&additional_properties=(Profile.Add. Properties)&second_address=(Profile.2nd Address)'::text;
$$;

create or replace function public.get_company_operations_overview()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $$
begin
  if not public.portal_is_admin() then raise exception 'Admin access required'; end if;
  return coalesce((
    select jsonb_agg(row_data order by (row_data->>'active_package')::boolean desc,row_data->>'company_name')
    from (
      select jsonb_build_object(
        'company_id',c.id,
        'company_name',c.name,
        'state',c.state,
        'contact_name',c.contact_name,
        'phone',c.phone,
        'email',c.email,
        'account_status',c.account_status,
        'public_slug',s.public_slug,
        'agent_link',case when s.public_slug is null then null else '/book/'||s.public_slug||'?'||public.ready_mode_prefill_query() end,
        'plain_agent_link',case when s.public_slug is null then null else '/book/'||s.public_slug end,
        'company_link',case when s.public_slug is null or s.company_access_token is null then null else '/company/'||s.public_slug||'/manage/'||s.company_access_token end,
        'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'abbreviation',t.abbreviation) order by t.name) from public.company_teams ct join public.teams t on t.id=ct.team_id where ct.company_id=c.id),'[]'::jsonb),
        'total_leads',(select count(*) from public.portal_leads l where l.company_id=c.id),
        'approved_leads',(select count(*) from public.portal_leads l where l.company_id=c.id and l.qc_status='approved'),
        'qc_pending',(select count(*) from public.portal_leads l where l.company_id=c.id and l.qc_status='pending'),
        'scheduled_upcoming',(select count(*) from public.portal_appointments a join public.portal_leads l on l.id=a.lead_id where a.company_id=c.id and l.qc_status='approved' and a.appointment_date>=current_date and a.status not in ('cancelled','rescheduled','qc_denied')),
        'active_package',(cp.id is not null),
        'package',case when cp.id is null then null else to_jsonb(cp)||jsonb_build_object(
          'delivered_leads',(select count(*) from public.portal_leads l where l.package_id=cp.id and l.qc_status='approved'),
          'pending_leads',greatest(cp.lead_target-(select count(*) from public.portal_leads l where l.package_id=cp.id and l.qc_status='approved'),0)
        ) end
      ) row_data
      from public.roster_companies c
      left join public.company_portal_settings s on s.company_id=c.id
      left join lateral (
        select * from public.company_packages p
        where p.company_id=c.id and p.status='active'
        order by p.start_date desc,p.created_at desc limit 1
      ) cp on true
      where c.account_status in ('Active','Pause') or cp.id is not null
    ) q
  ),'[]'::jsonb);
end;
$$;
