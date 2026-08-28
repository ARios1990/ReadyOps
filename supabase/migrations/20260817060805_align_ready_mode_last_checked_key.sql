-- Imported from the hosted ReadyOp Supabase migration history on 2026-08-28.
-- Schema only: no production table data is included.

create or replace function public.ready_mode_prefill_query()
returns text
language sql
immutable
set search_path to ''
as $$
  select 'agent=(User.Name)&first_name=(Profile.First Name)&last_name=(Profile.Last Name)&phone=(Profile.Phone Number)&address=(Profile.Address)&city=(Profile.City)&state=(Profile.State)&zip=(Profile.Zip Code)&email=(Profile.Email)&language=(Profile.Language)&services_needed=(Profile.Services Needed)&last_checked_on=(Profile.Last Checked On)&home_type=(Profile.Home Type)&roof_type=(Profile.Roof Type)&roof_age=(Profile.Roof Age)&stories=(Profile.Stories)&insurance=(Profile.Insurance)&insurance_name=(Profile.Insurance Name)&contract=(Profile.Contract)&home_value=(Profile.Home Value)&sq_ft=(Profile.SQ FT)&web_url=(Profile.Web Url)&notes=(Profile.Notes)&hail_size=(Profile.Size of Hail)&claim_filed=(Profile.File Claim)&visible_damage=(Profile.Visible Damage)&damage_type=(Profile.Damage Type)&additional_properties=(Profile.Add. Properties)&second_address=(Profile.2nd Address)'::text;
$$;
