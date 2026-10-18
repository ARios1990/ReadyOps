-- API bridge is service-only. Browser workers use only their leased job token.
create function public.roof_pros_form_worker_transition(p_id uuid,p_token uuid,p_status text,p_message text default null)
returns boolean language sql security invoker set search_path='' as $$
 select private.finish_roof_pros_form(p_id,p_token,p_status,p_message);
$$;
revoke all on function public.roof_pros_form_worker_transition(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.roof_pros_form_worker_transition(uuid,uuid,text,text) to service_role;
