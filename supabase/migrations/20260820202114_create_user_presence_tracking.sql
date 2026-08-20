/*
# Create user_presence table for admin Active Users feature

## Summary
Adds a per-user presence row updated by the browser client via a heartbeat.
Admins use this to see who currently has ReadyOps open and who was recently
active. Presence is treated as online when last_seen_at is within 90 seconds.

## New Tables
1. `public.user_presence`
   - `user_id` (uuid, primary key, references auth.users on delete cascade)
   - `session_started_at` (timestamptz, not null) — when the browser tab session began
   - `last_seen_at` (timestamptz, not null, default now()) — most recent heartbeat
   - `current_path` (text, nullable) — pathname the user is currently viewing
   - `created_at` (timestamptz, not null, default now())
   - `updated_at` (timestamptz, not null, default now())

## Indexes
- `user_presence_last_seen_idx` on `last_seen_at DESC` for fast admin listings.

## Security
1. RLS enabled on `public.user_presence`.
2. Privileges: authenticated is granted SELECT, INSERT, UPDATE only. DELETE is
   NOT granted. anon has no privileges.
3. Policies (one per verb, no `FOR ALL`):
   - SELECT — a user reads their own row; admins read all (via public.is_admin()).
   - INSERT — user_id must equal the authenticated caller.
   - UPDATE — USING and WITH CHECK both require user_id = authenticated caller.
4. Auth helper calls are wrapped in `(SELECT auth.uid())` / `(SELECT public.is_admin())`
   so Postgres caches them per-statement instead of per-row.
5. No new SECURITY DEFINER function is introduced. user_metadata is NOT used
   for authorization.

## Notes
- `updated_at` is maintained by a lightweight BEFORE UPDATE trigger.
- Client-side upsert with `onConflict: 'user_id'` will refresh last_seen_at and
  current_path on every heartbeat.
*/

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  current_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_presence_last_seen_idx
  ON public.user_presence (last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_presence FROM PUBLIC;
REVOKE ALL ON TABLE public.user_presence FROM anon;
REVOKE ALL ON TABLE public.user_presence FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_presence TO authenticated;

DROP POLICY IF EXISTS "user_presence_select_self_or_admin" ON public.user_presence;
CREATE POLICY "user_presence_select_self_or_admin"
  ON public.user_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS "user_presence_insert_self" ON public.user_presence;
CREATE POLICY "user_presence_insert_self"
  ON public.user_presence
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_presence_update_self" ON public.user_presence;
CREATE POLICY "user_presence_update_self"
  ON public.user_presence
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.user_presence_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_presence_set_updated_at ON public.user_presence;
CREATE TRIGGER user_presence_set_updated_at
  BEFORE UPDATE ON public.user_presence
  FOR EACH ROW
  EXECUTE FUNCTION public.user_presence_set_updated_at();
