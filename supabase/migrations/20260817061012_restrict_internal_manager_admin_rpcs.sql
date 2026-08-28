-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

revoke all on function public.admin_clear_manual_slot_blocks() from public;
revoke all on function public.admin_clear_manual_slot_blocks() from anon;
grant execute on function public.admin_clear_manual_slot_blocks() to authenticated;

revoke all on function public.get_manager_team_overview(uuid,date,date) from public;
revoke all on function public.get_manager_team_overview(uuid,date,date) from anon;
grant execute on function public.get_manager_team_overview(uuid,date,date) to authenticated;

revoke all on function public.current_team_id() from public;
revoke all on function public.current_team_id() from anon;
grant execute on function public.current_team_id() to authenticated;

revoke all on function public.get_user_team_id() from public;
revoke all on function public.get_user_team_id() from anon;
grant execute on function public.get_user_team_id() to authenticated;
