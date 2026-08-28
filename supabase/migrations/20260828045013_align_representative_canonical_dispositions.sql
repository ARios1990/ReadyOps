-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

alter table public.portal_appointments drop constraint if exists portal_appointments_rep_status_check;
alter table public.portal_appointments add constraint portal_appointments_rep_status_check check (rep_status = any (array['unassigned'::text, 'assigned'::text, 'en_route'::text, 'arrived'::text, 'inspection_started'::text, 'inspection_completed'::text, 'follow_up'::text, 'reschedule_requested'::text]));

create or replace function public.representative_update_appointment(
  p_access_token uuid,
  p_appointment_id uuid,
  p_action text,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rep public.company_representatives%rowtype;
  v_old public.portal_appointments%rowtype;
  v_new public.portal_appointments%rowtype;
begin
  select * into v_rep
  from public.company_representatives r
  where r.access_token = p_access_token and r.active;

  if v_rep.id is null then
    raise exception 'Representative link is invalid or disabled';
  end if;

  select a.* into v_old
  from public.portal_appointments a
  join public.portal_leads l on l.id = a.lead_id
  where a.id = p_appointment_id
    and a.representative_id = v_rep.id
    and l.qc_status = 'approved'
  for update of a;

  if v_old.id is null then
    raise exception 'Approved appointment is not assigned to this representative';
  end if;

  perform set_config('readyops.status_source', 'representative', true);

  if p_action = 'confirmed' then
    update public.portal_appointments
    set canonical_status = 'confirmed', last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  elsif p_action = 'en_route' then
    update public.portal_appointments
    set rep_status = 'en_route'
    where id = v_old.id returning * into v_new;
  elsif p_action = 'arrived' then
    update public.portal_appointments
    set rep_status = 'arrived',
        attendance_status = case when attendance_status = 'verified_show' then attendance_status else 'unverified_show' end
    where id = v_old.id returning * into v_new;
  elsif p_action = 'inspection_started' then
    update public.portal_appointments
    set rep_status = 'inspection_started',
        inspection_status = 'started',
        attendance_status = case when attendance_status = 'verified_show' then attendance_status else 'unverified_show' end
    where id = v_old.id returning * into v_new;
  elsif p_action = 'inspection_completed' then
    update public.portal_appointments
    set rep_status = 'inspection_completed',
        inspection_status = 'completed',
        status = 'completed',
        client_status = case when client_status = 'pending' then 'good' else client_status end,
        attendance_status = case when attendance_status = 'verified_show' then attendance_status else 'unverified_show' end,
        last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  elsif p_action = 'homeowner_no_show' then
    update public.portal_appointments
    set attendance_status = 'homeowner_no_show',
        inspection_status = 'not_completed',
        client_status = 'no_show',
        last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  elsif p_action = 'homeowner_cancelled' then
    update public.portal_appointments
    set attendance_status = 'cancelled',
        status = 'cancelled',
        inspection_status = 'not_completed',
        client_status = 'bad',
        last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  elsif p_action = 'rescheduled' then
    update public.portal_appointments
    set canonical_status = 'rescheduled',
        status = 'rescheduled',
        last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  elsif p_action = 'follow_up' then
    update public.portal_appointments
    set rep_status = 'follow_up', sales_outcome = 'follow_up', client_status = 'follow_up'
    where id = v_old.id returning * into v_new;
  elsif p_action = 'signed_contract' then
    update public.portal_appointments
    set sales_outcome = 'signed_contract',
        client_status = 'signed_contract',
        status = 'completed',
        inspection_status = case when inspection_status = 'not_started' then 'completed' else inspection_status end,
        last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  elsif p_action = 'lost' then
    update public.portal_appointments
    set sales_outcome = 'lost', client_status = 'bad', last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  else
    raise exception 'Unsupported representative action';
  end if;

  if nullif(trim(coalesce(p_note, '')), '') is not null then
    update public.portal_appointments
    set inspector_notes = trim(p_note), last_company_update_at = now()
    where id = v_old.id returning * into v_new;
  end if;

  perform public.portal_write_audit(
    v_rep.company_id,
    'representative',
    v_rep.id,
    v_rep.name,
    p_action,
    'appointment',
    v_new.id,
    to_jsonb(v_old),
    to_jsonb(v_new),
    jsonb_build_object('note', p_note)
  );

  return to_jsonb(v_new);
end;
$function$;

