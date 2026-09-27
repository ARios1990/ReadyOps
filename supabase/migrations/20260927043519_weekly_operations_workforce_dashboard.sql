-- Weekly Operations workforce dashboard: uploads, parsed rows, and per-admin schedule config.
-- Admin-only. Isolated from lead/appointment tables.

CREATE TABLE IF NOT EXISTS weekly_ops_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  filename text NOT NULL,
  file_type text NOT NULL,
  detected_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  unmapped_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weekly_ops_uploads_owner_week_idx
  ON weekly_ops_uploads (owner_id, week_start DESC, created_at DESC);
ALTER TABLE weekly_ops_uploads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS weekly_ops_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES weekly_ops_uploads(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  agent_name text,
  team_name text,
  entry_date date,
  day_of_week text,
  scheduled_hours numeric,
  actual_hours numeric,
  productive_hours numeric,
  idle_hours numeric,
  break_hours numeric,
  calls integer,
  appointments integer,
  results integer,
  login_at timestamptz,
  logout_at timestamptz,
  status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weekly_ops_rows_owner_week_idx
  ON weekly_ops_rows (owner_id, week_start, agent_name);
CREATE INDEX IF NOT EXISTS weekly_ops_rows_upload_idx
  ON weekly_ops_rows (upload_id);
ALTER TABLE weekly_ops_rows ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS weekly_ops_schedule_config (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  paid_hours_per_week numeric NOT NULL DEFAULT 40,
  scheduled_hours_per_day numeric NOT NULL DEFAULT 8,
  work_days text[] NOT NULL DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri']::text[],
  hourly_rate numeric NOT NULL DEFAULT 6.25,
  lunch_minutes_unpaid integer NOT NULL DEFAULT 60,
  break_count integer NOT NULL DEFAULT 2,
  break_minutes_paid_each integer NOT NULL DEFAULT 20,
  planned_start_time text,
  planned_end_time text,
  low_productivity_threshold numeric NOT NULL DEFAULT 0.6,
  low_calls_threshold integer NOT NULL DEFAULT 40,
  high_idle_hours_threshold numeric NOT NULL DEFAULT 1.5,
  attendance_shortfall_hours numeric NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE weekly_ops_schedule_config ENABLE ROW LEVEL SECURITY;

-- Only admins get access to workforce data.
CREATE OR REPLACE FUNCTION is_weekly_ops_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION is_weekly_ops_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_weekly_ops_admin() TO authenticated;

CREATE POLICY "weekly_ops_uploads_select_own"
  ON weekly_ops_uploads FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_uploads_insert_own"
  ON weekly_ops_uploads FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_uploads_update_own"
  ON weekly_ops_uploads FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin())
  WITH CHECK (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_uploads_delete_own"
  ON weekly_ops_uploads FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin());

CREATE POLICY "weekly_ops_rows_select_own"
  ON weekly_ops_rows FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_rows_insert_own"
  ON weekly_ops_rows FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_rows_update_own"
  ON weekly_ops_rows FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin())
  WITH CHECK (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_rows_delete_own"
  ON weekly_ops_rows FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin());

CREATE POLICY "weekly_ops_schedule_config_select_own"
  ON weekly_ops_schedule_config FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_schedule_config_insert_own"
  ON weekly_ops_schedule_config FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_schedule_config_update_own"
  ON weekly_ops_schedule_config FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin())
  WITH CHECK (owner_id = auth.uid() AND is_weekly_ops_admin());
CREATE POLICY "weekly_ops_schedule_config_delete_own"
  ON weekly_ops_schedule_config FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND is_weekly_ops_admin());
