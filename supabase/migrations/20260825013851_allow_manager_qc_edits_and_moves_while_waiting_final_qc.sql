-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.qc_update_lead(uuid,jsonb)'::regprocedure)
  INTO v_definition;

  v_definition := replace(
    v_definition,
    E'  IF v_role = ''manager'' AND v_old.qc_status = ''manager_approved'' THEN\n    RAISE EXCEPTION ''This lead is already waiting for final QC'';\n  END IF;\n',
    ''
  );

  IF v_definition LIKE '%already waiting for final QC%' THEN
    RAISE EXCEPTION 'Could not remove manager-approved edit lock from qc_update_lead';
  END IF;

  EXECUTE v_definition;

  SELECT pg_get_functiondef('public.qc_move_lead(uuid,uuid,uuid,date,text,text)'::regprocedure)
  INTO v_definition;

  v_definition := replace(
    v_definition,
    E'  IF v_actor_type = ''manager'' AND v_lead.qc_status = ''manager_approved'' THEN\n    RAISE EXCEPTION ''This lead is already waiting for final QC'';\n  END IF;\n',
    ''
  );

  IF v_definition LIKE '%already waiting for final QC%' THEN
    RAISE EXCEPTION 'Could not remove manager-approved move lock from qc_move_lead';
  END IF;

  EXECUTE v_definition;
END
$migration$;
