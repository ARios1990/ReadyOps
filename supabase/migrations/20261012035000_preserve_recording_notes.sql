-- Preserve reviewed recording notes through the same service-form filter as
-- edited notes. The full transcript remains in the private QC transcript table.
DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('private.apply_universal_lead_template()'::regprocedure);
  IF position('or (key=''summary_notes'' and exists' in definition)=0 THEN
    RAISE EXCEPTION 'Unexpected service form filter version';
  END IF;
  definition := replace(definition, 'or (key=''summary_notes'' and exists', 'or (key in (''summary_notes'',''recording_notes'') and exists');
  EXECUTE definition;
END;
$migration$;
