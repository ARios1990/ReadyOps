-- Keep normal QC authorization, auditing and owner-only scheduling intact.
-- One transaction: a rejected schedule correction cannot partially save fields.
create function public.qc_save_verified_edits(p_lead_id uuid,p_patch jsonb,p_date date default null,p_time text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_lead jsonb;v_moved jsonb;
begin
 if (p_date is null) <> (p_time is null) then raise exception 'Both appointment date and time are required';end if;
 v_lead:=public.qc_update_lead(p_lead_id,p_patch);
 if p_date is not null then
  v_moved:=public.qc_move_lead(p_lead_id,(v_lead->>'company_id')::uuid,
   nullif(v_lead->>'location_id','')::uuid,p_date,p_time,'Recording-supported appointment correction reviewed and saved by QC');
  return v_moved;
 end if;
 return jsonb_build_object('lead',v_lead);
end $$;
revoke all on function public.qc_save_verified_edits(uuid,jsonb,date,text) from public,anon,service_role;
grant execute on function public.qc_save_verified_edits(uuid,jsonb,date,text) to authenticated;
