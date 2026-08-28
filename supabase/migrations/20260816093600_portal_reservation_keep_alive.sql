-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_public_reservation(
  p_reservation_token uuid,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.appointment_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_res
  FROM public.appointment_reservations r
  WHERE r.reservation_token = p_reservation_token
  FOR UPDATE;

  IF v_res.id IS NULL OR v_res.session_id <> p_session_id THEN
    RAISE EXCEPTION 'Reservation was not found for this agent session';
  END IF;

  IF v_res.status <> 'active' OR v_res.expires_at <= now() THEN
    UPDATE public.appointment_reservations
    SET status = CASE WHEN status = 'active' THEN 'expired' ELSE status END
    WHERE id = v_res.id;
    RAISE EXCEPTION 'The reservation expired. Please select the time again.';
  END IF;

  UPDATE public.appointment_reservations
  SET expires_at = now() + interval '10 minutes'
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'id', v_res.id,
    'reservation_token', v_res.reservation_token,
    'appointment_date', v_res.appointment_date,
    'start_time', to_char(v_res.start_time, 'HH24:MI'),
    'end_time', to_char(v_res.end_time, 'HH24:MI'),
    'location_id', v_res.location_id,
    'last_action', v_res.last_action,
    'undo_deadline', v_res.undo_deadline,
    'expires_at', v_res.expires_at,
    'status', v_res.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_public_reservation(uuid,uuid) TO anon,authenticated;

COMMIT;
