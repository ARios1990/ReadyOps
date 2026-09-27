-- F4-F7 and F9: these are internal helpers for the public booking portal, not
-- portal entry points. Functions created in the `public` schema get EXECUTE to
-- PUBLIC by default, so every one of them was reachable unauthenticated at
-- /rest/v1/rpc/<name>. The portal RPCs that call them are SECURITY DEFINER and
-- run as the owner, so they keep working after this revoke.

-- F4: forged / flooded audit entries for any company.
REVOKE EXECUTE ON FUNCTION public.portal_write_audit(uuid, text, uuid, text, text, text, uuid, jsonb, jsonb, jsonb) FROM public, anon, authenticated;

-- F5: mass expiry of pending booking holds.
REVOKE EXECUTE ON FUNCTION public.portal_expire_reservations() FROM public, anon, authenticated;

-- F6: forced lead-code issuance on an arbitrary lead.
REVOKE EXECUTE ON FUNCTION public.portal_finalize_lead_code(uuid) FROM public, anon, authenticated;

-- F7: arbitrary package completion.
REVOKE EXECUTE ON FUNCTION public.portal_complete_package_if_filled(uuid) FROM public, anon, authenticated;

-- F9: read-only internal helpers leaking tenant scheduling and delivery detail.
REVOKE EXECUTE ON FUNCTION public.portal_active_package(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_active_package_for_location(uuid, uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_find_rule(uuid, uuid, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_slot_is_blocked(uuid, uuid, date, time without time zone, time without time zone) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_validate_slot(uuid, uuid, date, time without time zone, boolean) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_assert_slot_capacity(uuid, uuid, date, time without time zone, uuid, uuid, boolean) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_slot_statuses(uuid, uuid, date) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_resolve_agent_id(text, jsonb) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_resolve_company_access(uuid, uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_actor_type_for_management(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_actor_name_for_management() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.readyops_delivered_lead_count(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_readymode_campaign(text) FROM public, anon, authenticated;
