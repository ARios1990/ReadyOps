-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

alter policy user_presence_select_self_or_admin
on public.user_presence
to authenticated;

alter policy user_presence_insert_self
on public.user_presence
to authenticated;

alter policy user_presence_update_self
on public.user_presence
to authenticated;
