REVOKE ALL ON FUNCTION public.qc_delete_lead(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qc_delete_lead(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.qc_delete_lead(uuid,text) TO authenticated;
