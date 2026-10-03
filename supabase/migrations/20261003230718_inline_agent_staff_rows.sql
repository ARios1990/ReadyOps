-- Inline roster edits are one server-authorized transaction. Existing login
-- email, role and display name stay unchanged; account settings edit those.
create or replace function public.save_readyops_agent_row(
 p_actor_id uuid,p_agent_id uuid,p_name text,p_team_id uuid,p_active boolean,
 p_linked_profile_id uuid,p_expected jsonb,p_apply boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_agent public.agents;v_old public.profiles;v_target public.profiles;
 v_changes jsonb:='[]'::jsonb;v_old_count integer;v_link_changed boolean;
begin
 perform 1 from public.profiles where id=p_actor_id and role='admin' and active for share;
 if not found then raise exception 'Active admin access required';end if;
 if p_active is null or p_agent_id is null or p_expected is null or jsonb_typeof(p_expected)<>'object'
 or not (p_expected ?& array['name','team_id','active','profile_id','profile_updated_at','target_updated_at']) then raise exception 'Refresh the staff table before saving';end if;
 if nullif(trim(p_name),'') is null or length(p_name)>150 then raise exception 'Agent name is required (maximum 150 characters)';end if;
 if p_team_id is null or not exists(select 1 from public.teams where id=p_team_id) then raise exception 'Select a valid team';end if;
 -- Serialize row-link operations, including two agents selecting one login.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('readyops-staff-links',0));
 select count(*) into v_old_count from public.profiles where agent_id=p_agent_id;
 if v_old_count>1 then raise exception 'This agent has multiple linked users; resolve the links in account settings first';end if;
 -- Profile-before-agent lock order matches the existing staff-account editor.
 perform 1 from public.profiles where agent_id=p_agent_id or id=p_linked_profile_id order by id for update;
 select * into v_old from public.profiles where agent_id=p_agent_id;
 select * into v_target from public.profiles where id=p_linked_profile_id;
 select * into v_agent from public.agents where id=p_agent_id for update;
 if v_agent.id is null then raise exception 'Agent not found';end if;
 if (p_expected->>'name') is distinct from v_agent.name
 or (p_expected->>'team_id')::uuid is distinct from v_agent.team_id
 or (p_expected->>'active')::boolean is distinct from coalesce(v_agent.active,true)
 or (p_expected->>'profile_id')::uuid is distinct from v_old.id
 or (p_expected->>'profile_updated_at')::timestamptz is distinct from v_old.updated_at
 or (p_expected->>'target_updated_at')::timestamptz is distinct from v_target.updated_at then
   raise exception 'This row or selected login changed. Cancel, refresh, and try again';
 end if;
 v_link_changed:=v_old.id is distinct from p_linked_profile_id;
 if v_link_changed and v_old.id is not null and v_old.role is distinct from 'agent' then
   raise exception 'Only Agent login links can be replaced or removed from this row';end if;
 if p_linked_profile_id is not null then
   if v_target.id is null then raise exception 'Selected user not found';end if;
   if v_link_changed and (v_target.role is distinct from 'agent' or v_target.agent_id is not null) then
     raise exception 'Choose an unlinked Agent login; another agent account cannot be reassigned silently';end if;
   if v_target.id=p_actor_id and not p_active then raise exception 'You cannot disable your own admin account';end if;
 end if;
 if v_link_changed and v_old.id is not null then
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object('id',v_old.id,'active',v_old.active,'next_active',false));end if;
 if v_target.id is not null then
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object('id',v_target.id,'active',v_target.active,'next_active',p_active));end if;
 if p_apply then
   if v_link_changed and v_old.id is not null then
     -- Historical leads retain their author, but the displaced login loses
     -- access immediately through active-profile checks, even with an old JWT.
     update public.profiles set agent_id=null,team_id=null,active=false,updated_at=now() where id=v_old.id;
   end if;
   if v_target.id is not null then
     update public.profiles set agent_id=v_agent.id,team_id=p_team_id,active=p_active,updated_at=now() where id=v_target.id;
   end if;
   update public.agents set name=trim(p_name),team_id=p_team_id,active=p_active,
   email=case when v_link_changed and v_target.id is not null then coalesce(v_target.email,email) else email end,
   access_token=case when v_link_changed or team_id is distinct from p_team_id or active is distinct from p_active
     then gen_random_uuid() else access_token end where id=v_agent.id;
   insert into public.management_audit_events(actor_id,team_id,target_id,event_type,metadata)
   values(p_actor_id,p_team_id,v_agent.id,'agent_row_updated',jsonb_build_object(
     'previous_name',v_agent.name,'name',trim(p_name),'previous_team',v_agent.team_id,'team',p_team_id,
     'previous_active',v_agent.active,'active',p_active,'previous_profile',v_old.id,'profile',p_linked_profile_id));
 end if;
 return jsonb_build_object('success',true,'profile_changes',v_changes,'link_changed',v_link_changed);
end $$;
-- update-staff checks the real user and coordinates Auth ban/unban with this
-- validate/apply RPC. Browser callers may not impersonate p_actor_id.
revoke all on function public.save_readyops_agent_row(uuid,uuid,text,uuid,boolean,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_readyops_agent_row(uuid,uuid,text,uuid,boolean,uuid,jsonb,boolean) to service_role;
