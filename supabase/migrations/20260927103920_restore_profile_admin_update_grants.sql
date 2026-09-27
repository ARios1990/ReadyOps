-- Corrective to restrict_profile_update_columns: administrators link and unlink
-- staff accounts directly from the browser (AdminPanel / AdminReferenceDashboard
-- write profiles.agent_id), and column grants apply to the whole `authenticated`
-- role rather than to a single user, so the blanket revoke broke that feature.
--
-- The authoritative control for F2 is the BEFORE UPDATE trigger
-- prevent_profile_privilege_escalation, which now also rejects team_id changes
-- and is role-aware. UPDATE (id) stays revoked: nothing ever needs it.

GRANT UPDATE (email, role, agent_id, team_id) ON public.profiles TO authenticated;
