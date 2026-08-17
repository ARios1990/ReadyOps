-- portal_slot_is_blocked is an internal implementation detail. Public clients
-- use get_public_booking_portal and the reservation RPCs, which invoke this
-- helper as their SECURITY DEFINER owner.

REVOKE EXECUTE ON FUNCTION public.portal_slot_is_blocked(
  uuid, uuid, date, time without time zone, time without time zone
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.portal_slot_is_blocked(
  uuid, uuid, date, time without time zone, time without time zone
) TO service_role;
