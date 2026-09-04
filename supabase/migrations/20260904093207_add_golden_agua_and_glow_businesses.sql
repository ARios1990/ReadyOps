-- Two DFW businesses owned by the same operator as Golden Nail Roofing.

DO $$
DECLARE
  v_source_company_id uuid;
  v_source_location_id uuid;
  v_company_id uuid;
  v_location_id uuid;
  v_water_form jsonb := $json$
  [
    {"id":"appointment","title":"Appointment","fields":[
      {"key":"service_needed","type":"select","label":"Service Needed","required":true,"options":["Free In-Home Water Test","Whole-Home Filtration Estimate","Water Softener Estimate","Drinking Water / Reverse Osmosis Estimate"]}
    ]},
    {"id":"customer","title":"Customer Information","fields":[
      {"key":"full_name","type":"text","label":"Full Name","required":true},
      {"key":"phone_number","type":"phone","label":"Phone Number","required":true},
      {"key":"address","type":"address","label":"Street Address","required":true},
      {"key":"city","type":"text","label":"City","required":true},
      {"key":"state","type":"text","label":"State","required":true,"defaultValue":"TX"},
      {"key":"zip_code","type":"text","label":"ZIP Code","required":true},
      {"key":"email","type":"email","label":"Email","required":false},
      {"key":"language","type":"select","label":"Language","required":true,"options":["English","Spanish","Bilingual"]}
    ]},
    {"id":"water_qualifiers","title":"Pure Water Qualifiers","fields":[
      {"key":"homeowner","type":"select","label":"Are You the Homeowner?","required":true,"options":["Yes","No"]},
      {"key":"water_type","type":"select","label":"Water Type","required":true,"options":["City Water","Well Water","Not Sure"]},
      {"key":"water_issues","type":"multiselect","label":"Water Issues Noticed","required":true,"options":["Bad Taste","Bad Smell","Spots on Dishes or Faucets","Hard-Water Scale","Staining","Dry Skin or Hair","Other","None Noticed"]},
      {"key":"family_size","type":"number","label":"People Living in the Home","required":true},
      {"key":"water_line_appliances","type":"multiselect","label":"Appliances Connected to the Water Line","required":false,"options":["Refrigerator","Ice Maker","Dishwasher","Other","None"]},
      {"key":"prior_water_interest","type":"select","label":"Water Testing / Filtration History","required":true,"options":["Previously Tested","Previously Considered Filtration","Both","Neither"]},
      {"key":"open_to_water_test","type":"select","label":"Open to a Free In-Home Water Test This Week?","required":true,"options":["Yes","No","Needs Another Date"]},
      {"key":"decision_makers_available","type":"select","label":"All Decision Makers Available?","required":true,"options":["Yes","No","Not Sure"]}
    ]},
    {"id":"additional","title":"Additional Information","fields":[
      {"key":"notes","type":"textarea","label":"Water Concerns, Timing, and Appointment Notes","required":true}
    ]},
    {"id":"recording","title":"Appointment Recording","fields":[
      {"key":"recording_url","type":"recording","label":"Upload Appointment Recording","required":false}
    ]}
  ]
  $json$::jsonb;
  v_lighting_form jsonb := $json$
  [
    {"id":"appointment","title":"Appointment","fields":[
      {"key":"service_needed","type":"select","label":"Lighting Service","required":true,"options":["Permanent Exterior Lighting","C9 Seasonal Holiday Lighting","Both Permanent and C9 Lighting","Free Design / Estimate"]}
    ]},
    {"id":"customer","title":"Customer Information","fields":[
      {"key":"full_name","type":"text","label":"Full Name","required":true},
      {"key":"phone_number","type":"phone","label":"Phone Number","required":true},
      {"key":"address","type":"address","label":"Street Address","required":true},
      {"key":"city","type":"text","label":"City","required":true},
      {"key":"state","type":"text","label":"State","required":true,"defaultValue":"TX"},
      {"key":"zip_code","type":"text","label":"ZIP Code","required":true},
      {"key":"email","type":"email","label":"Email","required":false},
      {"key":"language","type":"select","label":"Language","required":true,"options":["English","Spanish","Bilingual"]}
    ]},
    {"id":"lighting_qualifiers","title":"Lighting Qualifiers","fields":[
      {"key":"homeowner","type":"select","label":"Homeowner","required":true,"options":["Yes","No"]},
      {"key":"decision_maker","type":"select","label":"Decision Maker","required":true,"options":["Yes","No","Shared Decision"]},
      {"key":"holiday_lighting_frequency","type":"select","label":"Normally Puts Up Holiday Lights?","required":true,"options":["Every Year","Some Years","Rarely","Never"]},
      {"key":"current_lighting_setup","type":"select","label":"Current Setup","required":true,"options":["DIY","Hires a Professional","Already Has Permanent Lighting","Does Not Decorate"]},
      {"key":"primary_lighting_use","type":"select","label":"Primary Use","required":true,"options":["Holidays","Warm-White Accent Lighting","Birthdays / Events","Game Days","Security / Visibility","A Little of Everything"]},
      {"key":"permanent_lighting_interest","type":"select","label":"Permanent Lighting Interest","required":true,"options":["Interested","Maybe / Wants Design","Not Interested"]},
      {"key":"consider_if_numbers_make_sense","type":"select","label":"Would Consider Installing if the Numbers Make Sense?","required":true,"options":["Yes","No","Needs to Discuss"]},
      {"key":"other_decision_maker_available","type":"select","label":"Other Decision Maker Available for Appointment?","required":true,"options":["Yes","No","Not Applicable","Not Sure"]},
      {"key":"home_stories","type":"select","label":"Home Stories","required":false,"options":["1 Story","1.5 Story","2 Stories","2.5 Stories","3+ Stories","Not Sure"]},
      {"key":"strong_lead_signals","type":"multiselect","label":"Strong Lead Signals","required":false,"options":["Pays for Seasonal Installation","Decorates Every Year","Two-Story / Difficult Roofline","Avoids Ladder Work","Accent-Lighting Interest","Smart-Home Interest","Recently Purchased / Renovated","Financing Interest","Higher-Value Property"]}
    ]},
    {"id":"additional","title":"Appointment Notes","fields":[
      {"key":"notes","type":"textarea","label":"Current Lighting, DIY vs. Hired, Intended Use, Decision Makers, and Appointment Details","required":true}
    ]},
    {"id":"recording","title":"Appointment Recording","fields":[
      {"key":"recording_url","type":"recording","label":"Upload Appointment Recording","required":false}
    ]}
  ]
  $json$::jsonb;
BEGIN
  SELECT company.id
  INTO v_source_company_id
  FROM public.roster_companies AS company
  WHERE company.name = 'Golden Nail Roofing';

  IF v_source_company_id IS NULL THEN
    RAISE EXCEPTION 'Golden Nail Roofing must exist before adding its related businesses';
  END IF;

  SELECT location.id
  INTO v_source_location_id
  FROM public.company_locations AS location
  WHERE location.company_id = v_source_company_id
    AND location.state = 'TX'
    AND location.location_label ILIKE '%DFW%'
  ORDER BY location.created_at
  LIMIT 1;

  IF v_source_location_id IS NULL THEN
    RAISE EXCEPTION 'Golden Nail Roofing DFW location is required';
  END IF;

  INSERT INTO public.roster_companies (
    name, state, contact_name, account_status, team_id, metro_tag,
    requirements_note, notes
  )
  SELECT
    'Golden Agua Systems', 'TX', source.contact_name, source.account_status,
    source.team_id, 'DFW',
    'DFW homeowners. City or well water. Record water issues, household size, connected appliances, and openness to a free in-home water test.',
    'Related business under the same owner as Golden Nail Roofing.'
  FROM public.roster_companies AS source
  WHERE source.id = v_source_company_id
  ON CONFLICT (name) DO UPDATE
  SET state = EXCLUDED.state,
      contact_name = EXCLUDED.contact_name,
      account_status = EXCLUDED.account_status,
      team_id = EXCLUDED.team_id,
      metro_tag = EXCLUDED.metro_tag,
      requirements_note = EXCLUDED.requirements_note,
      notes = EXCLUDED.notes
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_teams (company_id, team_id)
  SELECT v_company_id, source_team.team_id
  FROM public.company_teams AS source_team
  WHERE source_team.company_id = v_source_company_id
  ON CONFLICT (company_id, team_id) DO NOTHING;

  INSERT INTO public.company_portal_settings (
    company_id, public_slug, portal_enabled, allow_public_booking,
    company_access_enabled, timezone, requirements_short, requirements_detail,
    qualification_rules, form_mode, form_schema
  )
  VALUES (
    v_company_id, 'golden-agua-systems', true, true, true, 'America/Chicago',
    'Qualified lead: homeowner in DFW with city or well water, a documented water concern, and openness to a free in-home water test or estimate.',
    'Ask every Pure Water qualifier. Record household size, water-line appliances, prior testing or filtration interest, timing, and whether all decision makers can attend.',
    '{"minimum_roof_age":null,"minimum_sq_ft":null,"allowed_home_types":[],"allowed_roof_types":[],"allowed_languages":[],"contract_must_be_no":false,"block_disqualified":false,"homeowner_required":true,"water_issue_required":true,"water_test_interest_required":true}'::jsonb,
    'internal', v_water_form
  )
  ON CONFLICT (company_id) DO UPDATE
  SET public_slug = EXCLUDED.public_slug,
      portal_enabled = EXCLUDED.portal_enabled,
      allow_public_booking = EXCLUDED.allow_public_booking,
      company_access_enabled = EXCLUDED.company_access_enabled,
      timezone = EXCLUDED.timezone,
      requirements_short = EXCLUDED.requirements_short,
      requirements_detail = EXCLUDED.requirements_detail,
      qualification_rules = EXCLUDED.qualification_rules,
      form_mode = EXCLUDED.form_mode,
      form_schema = EXCLUDED.form_schema;

  INSERT INTO public.company_locations (
    company_id, location_label, state, metro_tag, sort_order, office_name,
    address, city, zip_code, service_cities, service_zips, phone, email,
    manager_name, timezone, available_days, start_time, end_time,
    slot_interval_minutes, max_per_hour, max_per_day, notes, active
  )
  SELECT
    v_company_id, 'DFW', 'TX', 'DFW', 0, source.office_name,
    source.address, source.city, source.zip_code, source.service_cities,
    source.service_zips, source.phone, source.email, source.manager_name,
    source.timezone, source.available_days, source.start_time, source.end_time,
    source.slot_interval_minutes, source.max_per_hour, source.max_per_day,
    'DFW service area', true
  FROM public.company_locations AS source
  WHERE source.id = v_source_location_id
  ON CONFLICT (company_id, location_label) DO UPDATE
  SET state = EXCLUDED.state,
      metro_tag = EXCLUDED.metro_tag,
      service_cities = EXCLUDED.service_cities,
      service_zips = EXCLUDED.service_zips,
      timezone = EXCLUDED.timezone,
      available_days = EXCLUDED.available_days,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      slot_interval_minutes = EXCLUDED.slot_interval_minutes,
      max_per_hour = EXCLUDED.max_per_hour,
      max_per_day = EXCLUDED.max_per_day,
      notes = EXCLUDED.notes,
      active = true
  RETURNING id INTO v_location_id;

  INSERT INTO public.company_schedule_rules (
    company_id, location_id, day_of_week, is_open, start_time, end_time,
    slot_minutes, max_per_slot, max_per_day
  )
  SELECT
    v_company_id, v_location_id, source.day_of_week, source.is_open,
    source.start_time, source.end_time, source.slot_minutes,
    source.max_per_slot, source.max_per_day
  FROM public.company_schedule_rules AS source
  WHERE source.company_id = v_source_company_id
    AND source.location_id = v_source_location_id
    AND NOT EXISTS (
      SELECT 1 FROM public.company_schedule_rules AS existing
      WHERE existing.company_id = v_company_id
        AND existing.location_id = v_location_id
        AND existing.day_of_week = source.day_of_week
    );

  INSERT INTO public.roster_companies (
    name, state, contact_name, account_status, team_id, metro_tag,
    requirements_note, notes
  )
  SELECT
    'Golden Glow Lighting', 'TX', source.contact_name, source.account_status,
    source.team_id, 'DFW',
    'DFW homeowners. C9 seasonal and permanent exterior lighting. Book a free design and estimate; record all five qualifiers and detailed notes.',
    'Related business under the same owner as Golden Nail Roofing.'
  FROM public.roster_companies AS source
  WHERE source.id = v_source_company_id
  ON CONFLICT (name) DO UPDATE
  SET state = EXCLUDED.state,
      contact_name = EXCLUDED.contact_name,
      account_status = EXCLUDED.account_status,
      team_id = EXCLUDED.team_id,
      metro_tag = EXCLUDED.metro_tag,
      requirements_note = EXCLUDED.requirements_note,
      notes = EXCLUDED.notes
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_teams (company_id, team_id)
  SELECT v_company_id, source_team.team_id
  FROM public.company_teams AS source_team
  WHERE source_team.company_id = v_source_company_id
  ON CONFLICT (company_id, team_id) DO NOTHING;

  INSERT INTO public.company_portal_settings (
    company_id, public_slug, portal_enabled, allow_public_booking,
    company_access_enabled, timezone, requirements_short, requirements_detail,
    qualification_rules, form_mode, form_schema
  )
  VALUES (
    v_company_id, 'golden-glow-lighting', true, true, true, 'America/Chicago',
    'Qualified lead: DFW homeowner who will consider C9 seasonal or permanent exterior lighting and agrees to a free design and estimate.',
    'Ask all five lighting qualifiers. Put holiday-light habits, DIY versus hired installation, intended use, decision-maker availability, strong lead signals, and the confirmed appointment in Notes.',
    '{"minimum_roof_age":null,"minimum_sq_ft":null,"allowed_home_types":[],"allowed_roof_types":[],"allowed_languages":[],"contract_must_be_no":false,"block_disqualified":false,"homeowner_required":true,"decision_maker_required":true,"permanent_lighting_interest_required":true}'::jsonb,
    'internal', v_lighting_form
  )
  ON CONFLICT (company_id) DO UPDATE
  SET public_slug = EXCLUDED.public_slug,
      portal_enabled = EXCLUDED.portal_enabled,
      allow_public_booking = EXCLUDED.allow_public_booking,
      company_access_enabled = EXCLUDED.company_access_enabled,
      timezone = EXCLUDED.timezone,
      requirements_short = EXCLUDED.requirements_short,
      requirements_detail = EXCLUDED.requirements_detail,
      qualification_rules = EXCLUDED.qualification_rules,
      form_mode = EXCLUDED.form_mode,
      form_schema = EXCLUDED.form_schema;

  INSERT INTO public.company_locations (
    company_id, location_label, state, metro_tag, sort_order, office_name,
    address, city, zip_code, service_cities, service_zips, phone, email,
    manager_name, timezone, available_days, start_time, end_time,
    slot_interval_minutes, max_per_hour, max_per_day, notes, active
  )
  SELECT
    v_company_id, 'DFW', 'TX', 'DFW', 0, source.office_name,
    source.address, source.city, source.zip_code, source.service_cities,
    source.service_zips, source.phone, source.email, source.manager_name,
    source.timezone, source.available_days, source.start_time, source.end_time,
    source.slot_interval_minutes, source.max_per_hour, source.max_per_day,
    'DFW service area', true
  FROM public.company_locations AS source
  WHERE source.id = v_source_location_id
  ON CONFLICT (company_id, location_label) DO UPDATE
  SET state = EXCLUDED.state,
      metro_tag = EXCLUDED.metro_tag,
      service_cities = EXCLUDED.service_cities,
      service_zips = EXCLUDED.service_zips,
      timezone = EXCLUDED.timezone,
      available_days = EXCLUDED.available_days,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      slot_interval_minutes = EXCLUDED.slot_interval_minutes,
      max_per_hour = EXCLUDED.max_per_hour,
      max_per_day = EXCLUDED.max_per_day,
      notes = EXCLUDED.notes,
      active = true
  RETURNING id INTO v_location_id;

  INSERT INTO public.company_schedule_rules (
    company_id, location_id, day_of_week, is_open, start_time, end_time,
    slot_minutes, max_per_slot, max_per_day
  )
  SELECT
    v_company_id, v_location_id, source.day_of_week, source.is_open,
    source.start_time, source.end_time, source.slot_minutes,
    source.max_per_slot, source.max_per_day
  FROM public.company_schedule_rules AS source
  WHERE source.company_id = v_source_company_id
    AND source.location_id = v_source_location_id
    AND NOT EXISTS (
      SELECT 1 FROM public.company_schedule_rules AS existing
      WHERE existing.company_id = v_company_id
        AND existing.location_id = v_location_id
        AND existing.day_of_week = source.day_of_week
    );
END;
$$;
