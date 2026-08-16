BEGIN;

CREATE OR REPLACE FUNCTION public.portal_normalize_form_schema(p_schema jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_section jsonb;
  v_fields jsonb;
  v_field jsonb;
BEGIN
  FOR v_section IN
    SELECT value FROM jsonb_array_elements(coalesce(p_schema, '[]'::jsonb))
  LOOP
    v_fields := '[]'::jsonb;

    FOR v_field IN
      SELECT value FROM jsonb_array_elements(coalesce(v_section->'fields', '[]'::jsonb))
    LOOP
      -- Service Needed already identifies a drone inspection, so do not ask twice.
      IF v_field->>'key' = 'drone_approved' THEN
        CONTINUE;
      END IF;

      IF v_field->>'key' = 'stories' THEN
        v_field := jsonb_set(
          v_field,
          '{options}',
          '["1 Story","1.5 Story","2 Stories","2.5 Story","3+ Stories"]'::jsonb,
          true
        );
      ELSIF v_field->>'key' = 'language' THEN
        v_field := jsonb_set(
          v_field,
          '{options}',
          '["English","Spanish","Bilingual"]'::jsonb,
          true
        );
      END IF;

      v_fields := v_fields || jsonb_build_array(v_field);
    END LOOP;

    v_section := jsonb_set(v_section, '{fields}', v_fields, true);
    v_result := v_result || jsonb_build_array(v_section);
  END LOOP;

  RETURN v_result;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.portal_default_form_schema_legacy()') IS NULL THEN
    ALTER FUNCTION public.portal_default_form_schema() RENAME TO portal_default_form_schema_legacy;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_default_form_schema()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.portal_normalize_form_schema(public.portal_default_form_schema_legacy());
$$;

ALTER TABLE public.company_portal_settings
  ALTER COLUMN form_schema SET DEFAULT public.portal_default_form_schema();

UPDATE public.company_portal_settings
SET form_schema = public.portal_normalize_form_schema(form_schema),
    updated_at = now();

COMMIT;
