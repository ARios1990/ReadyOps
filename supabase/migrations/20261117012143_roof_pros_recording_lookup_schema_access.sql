-- The server already has EXECUTE on the recording resolver and SELECT on its
-- source tables. SECURITY INVOKER also requires USAGE on the helper's schema.
-- Without it, even a lead with no recording fails before returning NULL.
grant usage on schema private to service_role;
