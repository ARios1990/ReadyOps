/*
# Harden search_path on user_presence updated_at trigger

## Summary
The trigger function `public.user_presence_set_updated_at` was created without a
locked search_path, which the Supabase linter flags as a warning. This
migration pins its search_path to `public`.

## Changes
1. Recreate `public.user_presence_set_updated_at` with `SET search_path = public`.
*/

CREATE OR REPLACE FUNCTION public.user_presence_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
