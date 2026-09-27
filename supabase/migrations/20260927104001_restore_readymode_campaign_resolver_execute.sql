-- Corrective to revoke_public_execute_on_internal_portal_helpers:
-- resolve_readymode_campaign is not an internal helper. The unauthenticated
-- /readymode route (src/ReadyModeCampaignRouter.tsx) calls it to map a dialer
-- campaign name onto the right company booking portal, so anon needs EXECUTE.

GRANT EXECUTE ON FUNCTION public.resolve_readymode_campaign(text) TO anon, authenticated;
