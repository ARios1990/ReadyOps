import type { PortalFormField, PortalFormSection } from './DynamicLeadForm';

export const HOME_TYPES = ['Single Family Home', 'Town Home', 'Multifamily Home', 'Commercial', 'Mobile Home', 'Other'];
export const ROOF_TYPES = ['Shingle', 'Metal', 'Tile', 'Flat', 'Wood', 'Other'];
export const INSURERS = ['State Farm', 'Allstate', 'Farmers Insurance', 'USAA', 'Liberty Mutual', 'Nationwide', 'Progressive', 'Travelers', 'American Family Insurance', 'GEICO', 'Auto-Owners Insurance', 'Erie Insurance', 'The Hartford', 'Amica', 'Safeco', 'Mercury Insurance', 'Homesite', 'Hippo', 'Lemonade', 'Nationwide Private Client', 'Other', 'Unknown / Not Sure'];
const choices: Record<string, string[]> = { home_type: HOME_TYPES, roof_type: ROOF_TYPES, insurance_name: INSURERS, stories: ['1', '1.5', '2', '2.5', '3'], homeowner_authority: ['Homeowner', 'Authorized decision-maker', 'Neither', 'Unsure'], visitor_authority: ['Homeowner', 'Authorized decision-maker', 'Neither', 'Unsure'], visible_damage: ['Yes', 'Not Sure', 'Minimal', 'None reported'], claim_filed: ['Yes', 'No', 'Unsure'], claim_status: ['Awaiting inspection', 'Awaiting a decision', 'Approved', 'Partially approved', 'Denied', 'Unsure'], approved_work: ['Repair', 'Replacement', 'Other', 'Unsure'], insurance: ['Yes', 'No', 'Unsure'], contract: ['Yes', 'No', 'Unsure'], additional_properties: ['Yes', 'No'], project_category: ['Windows', 'Doors', 'Siding', 'Gutters', 'Kitchen / Bathroom', 'Flooring', 'Exterior / Other Services'] };
export function qualifier(key: string, label: string): PortalFormField { return { key, label, type: choices[key] ? 'select' : 'text', options: choices[key], allowOther: ['home_type', 'roof_type', 'insurance_name'].includes(key) }; }
export function answer(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  const raw = value === 'Other' && ['home_type', 'roof_type', 'insurance_name'].includes(key) ? values[key + '_other'] : value;
  const text = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim();
  return /^\(profile\.[^)]+\)/i.test(text) ? '' : text;
}
export function differentVisitor(values: Record<string, unknown>) {
  const visitor = answer(values, 'meeting_name').toLowerCase().replace(/\s+/g, ' ');
  const contact = answer(values, 'full_name').toLowerCase().replace(/\s+/g, ' ');
  return Boolean(visitor && visitor !== contact && !['me', 'myself', 'same person'].includes(visitor));
}
export function qualifierVisible(field: PortalFormField, values: Record<string, unknown>) {
  if (field.key === 'visitor_authority' && !differentVisitor(values)) return false;
  if (['claim_status', 'approved_work', 'claim_number'].includes(field.key) && answer(values, 'claim_filed') !== 'Yes') return false;
  if (field.key === 'approved_work' && !['Approved', 'Partially approved'].includes(answer(values, 'claim_status'))) return false;
  if (field.key === 'second_address' && answer(values, 'additional_properties') !== 'Yes') return false;
  return field.mode !== 'hidden' && (!field.showWhen?.field || values[field.showWhen.field] === field.showWhen.equals);
}
export const NOTES_ONLY = new Set(['meeting_name', 'visitor_authority', 'access_instructions', 'hail_size', 'claim_filed', 'claim_status', 'approved_work']);
export function appointmentLabel(values: Record<string, unknown>) {
  const date = answer(values, 'appointment_date'); const time = answer(values, 'appointment_time');
  let day = date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date + 'T12:00:00'));
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  const clock = match ? `${Number(match[1]) % 12 || 12}:${match[2]} ${Number(match[1]) >= 12 ? 'PM' : 'AM'}` : time;
  return [day, clock].filter(Boolean).join(' · ');
}
export function automaticNotes(service: string, values: Record<string, unknown>) {
  const get = (key: string) => answer(values, key); const sentences: string[] = [];
  const name = get('full_name'); const authority = get('homeowner_authority');
  const role = authority === 'Homeowner' ? ', the homeowner,' : authority === 'Authorized decision-maker' ? ', an authorized decision-maker,' : authority === 'Yes' ? ', the homeowner or authorized decision-maker,' : '';
  const need = get('service_needed');
  sentences.push(name ? `Spoke with ${name}${role} about ${service.toLowerCase()}${need ? ` (${need.toLowerCase()})` : ''}.` : `Service requested: ${service}${need ? ` (${need})` : ''}.`);
  if (/roof/i.test(service)) {
    const age = get('roof_age'); const type = get('roof_type');
    const roof = [age ? (/^\d+$/.test(age) ? `${age}-year-old` : `approximately ${age} years old`) : '', type.toLowerCase(), 'roof'].filter(Boolean).join(' ');
    if (age || type || get('damage_type')) sentences.push(`They reported a ${roof}${get('damage_type') ? ` with ${get('damage_type')}` : ''}.`);
    else if (get('visible_damage')) sentences.push(`Visible damage: ${get('visible_damage')}.`);
    if (get('hail_size')) sentences.push(`Reported hail size: ${get('hail_size')}.`);
    if (get('claim_filed') === 'No') sentences.push('No insurance claim has been filed.');
    if (get('claim_filed') === 'Yes') sentences.push(`An insurance claim has been filed${get('claim_status') ? `; status: ${get('claim_status').toLowerCase()}` : ''}${['Approved', 'Partially approved'].includes(get('claim_status')) && get('approved_work') ? ` for ${get('approved_work').toLowerCase()}` : ''}.`);
    if (get('claim_filed') === 'Unsure') sentences.push('They are unsure whether a claim has been filed.');
    if (get('contract') === 'No') sentences.push('They have not signed with another roofer.');
    if (get('contract') === 'Yes') sentences.push('They have signed with another roofer.');
  } else {
    const details = ['project_category', 'project_scope', 'tree_work', 'tree_count', 'tree_size', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'dent_location', 'monthly_electric_bill', 'utility_provider', 'project_timeline'].filter(key => get(key)).map(key => `${key.replace(/_/g, ' ')}: ${get(key)}`);
    if (details.length) sentences.push(details.join('; ') + '.');
  }
  const visitor = get('meeting_name'); const date = appointmentLabel(values);
  if (visitor) { const attendingRole = differentVisitor(values) ? get('visitor_authority') : authority; const description = attendingRole === 'Homeowner' ? ', a homeowner,' : attendingRole === 'Authorized decision-maker' ? ', an authorized decision-maker,' : ''; sentences.push(`${differentVisitor(values) ? visitor : name || visitor}${description} will meet the inspector${date ? ` on ${date}` : ''}.`); if (attendingRole === 'Neither') sentences.push('The attendee is not a homeowner or authorized decision-maker.'); }
  else if (date) sentences.push(`Appointment: ${date}.`);
  if (get('access_instructions')) sentences.push(`Visit instructions: ${get('access_instructions').replace(/[.!?]+$/, '')}.`);
  if (get('notes')) sentences.push(get('notes'));
  return sentences.join(' ');
}
export function updateQualifierSchema(schema: PortalFormSection[], serviceId: string): PortalFormSection[] {
  const next = schema.map(section => ({ ...section, fields: section.fields.filter(f => f.key !== 'storm_date').map(f => choices[f.key] ? { ...f, ...qualifier(f.key, f.label) } : f) }));
  if (serviceId === 'roofing') {
    const fields = next.find(s => s.id === 'service')?.fields;
    if (fields) { const additions = [['insurance', 'Insurance'], ['visible_damage', 'Visible Damage'], ['claim_filed', 'Claim Filed'], ['claim_status', 'Claim Status'], ['approved_work', 'Approved Work'], ['additional_properties', 'Additional Properties'], ['second_address', '2nd Address']]; additions.forEach(([key, label]) => { if (!fields.some(f => f.key === key)) fields.push(qualifier(key, label)); }); }
    if (!next.some(s => s.id === 'appointment_visit')) next.splice(next.length - 1, 0, { id: 'appointment_visit', title: 'Appointment Visit', fields: [qualifier('meeting_name', 'Who will meet the roofing representative?'), qualifier('visitor_authority', 'Is this person a homeowner or authorized decision-maker?'), qualifier('access_instructions', 'Access instructions / pets / gate code')] });
  }
  const add = (title: string, pairs: string[][]) => { const keys = new Set(next.flatMap(s => s.fields.map(f => f.key))); const fields = pairs.filter(([key]) => !keys.has(key)).map(([key, label]) => qualifier(key, label)); if (fields.length) next.splice(next.length - 1, 0, { id: 'approved_' + title.replace(/\W/g, '_'), title, fields }); };
  if (serviceId === 'permanent_exterior_lighting') add('Project Information', [['home_type','Home Type'],['decision_makers','Decision Maker'],['additional_properties','Additional Properties'],['web_url','Zillow / Property Link'],['estimate','Estimate']]);
  if (serviceId === 'tree_service') add('Project Information', [['ready_if_estimate_works','Ready to Proceed if Estimate Works']]);
  if (serviceId === 'pdr') add('Damage & Insurance Information', [['hail_damage','Hail Damage'],['damage_severity','Damage Severity'],['vehicle_drivable','Vehicle Drivable'],['insurance','Insurance'],['claim_filed','Claim Filed'],['claim_number','Claim Number'],['free_inspection','Free Inspection / Estimate']]);
  if (serviceId === 'solar') add('Solar Qualifiers', [['home_type','Property Type'],['roof_type','Roof Type'],['roof_age','Roof Age'],['energy_usage','Energy Usage'],['current_system_size','Current System Size'],['credit_range','Credit Range'],['payment_method','Cash / Financing'],['decision_makers_available','All Decision-Makers Available'],['estimate_interest','Estimate Interest'],['ownership','Ownership'],['sun_exposure','Sun Exposure']]);
  if (serviceId === 'home_improvement') { add('Project Category', [['project_category','Project Category']]); const keys = new Set(next.flatMap(s => s.fields.map(f => f.key))); HOME_IMPROVEMENT_SECTIONS.forEach(section => { const fields = section.fields.filter(f => !keys.has(f.key)); fields.forEach(f => keys.add(f.key)); if (fields.length) next.splice(next.length - 1, 0, { ...section, fields }); }); }
  return next;
}

const HOME_IMPROVEMENT_SECTIONS: PortalFormSection[] = [
  {
    "id": "hi_customer_property",
    "title": "Customer / Property",
    "fields": [
      {
        "key": "home_type",
        "label": "Property Type",
        "type": "text"
      },
      {
        "key": "years_at_property",
        "label": "Years at Property",
        "type": "text"
      },
      {
        "key": "other_decision_makers",
        "label": "Other Decision-Makers",
        "type": "text"
      },
      {
        "key": "decision_makers_available_for_appointment",
        "label": "Decision-Makers Available for Appointment",
        "type": "text"
      }
    ]
  },
  {
    "id": "hi_project_details",
    "title": "Project Details",
    "fields": [
      {
        "key": "project_type",
        "label": "Project Type",
        "type": "text"
      },
      {
        "key": "project_area",
        "label": "Project Area",
        "type": "text"
      },
      {
        "key": "repair_replacement_remodel_upgrade",
        "label": "Repair / Replacement / Remodel / Upgrade",
        "type": "text"
      },
      {
        "key": "project_issue",
        "label": "Main Issue",
        "type": "text"
      },
      {
        "key": "how_long_has_issue_existed",
        "label": "How Long Has Issue Existed",
        "type": "text"
      },
      {
        "key": "current_condition",
        "label": "Current Condition",
        "type": "text"
      },
      {
        "key": "reason_for_project",
        "label": "Reason for Project",
        "type": "text"
      },
      {
        "key": "previous_repairs_completed",
        "label": "Previous Repairs Completed",
        "type": "text"
      },
      {
        "key": "contract",
        "label": "Currently Working With Another Contractor",
        "type": "text"
      },
      {
        "key": "currently_taking_bids",
        "label": "Currently Taking Bids",
        "type": "text"
      }
    ]
  },
  {
    "id": "hi_windows",
    "title": "Windows",
    "fields": [
      {
        "key": "hi_windows_number_of_windows",
        "label": "Number of Windows",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_repair_or_replacement",
        "label": "Repair or Replacement",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_window_type",
        "label": "Window Type",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_current_window_age",
        "label": "Current Window Age",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_main_window_issue",
        "label": "Main Window Issue",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_drafts_leaks",
        "label": "Drafts / Leaks",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_broken_or_cracked_glass",
        "label": "Broken or Cracked Glass",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_hard_to_open_or_close",
        "label": "Hard to Open or Close",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_energy_efficiency_concern",
        "label": "Energy Efficiency Concern",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      },
      {
        "key": "hi_windows_full_home_or_partial_replacement",
        "label": "Full Home or Partial Replacement",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Windows"
        }
      }
    ]
  },
  {
    "id": "hi_doors",
    "title": "Doors",
    "fields": [
      {
        "key": "hi_doors_number_of_doors",
        "label": "Number of Doors",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_repair_or_replacement",
        "label": "Repair or Replacement",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_door_type",
        "label": "Door Type",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_exterior_or_interior",
        "label": "Exterior or Interior",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_front_back_patio_sliding_door",
        "label": "Front / Back / Patio / Sliding Door",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_door_age",
        "label": "Door Age",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_main_door_issue",
        "label": "Main Door Issue",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_drafts_leaks",
        "label": "Drafts / Leaks",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_damaged_frame",
        "label": "Damaged Frame",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      },
      {
        "key": "hi_doors_security_concern",
        "label": "Security Concern",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Doors"
        }
      }
    ]
  },
  {
    "id": "hi_siding",
    "title": "Siding",
    "fields": [
      {
        "key": "hi_siding_siding_type",
        "label": "Siding Type",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Siding"
        }
      },
      {
        "key": "hi_siding_area_needing_work",
        "label": "Area Needing Work",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Siding"
        }
      },
      {
        "key": "hi_siding_repair_or_full_replacement",
        "label": "Repair or Full Replacement",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Siding"
        }
      },
      {
        "key": "hi_siding_cracked_loose_missing_siding",
        "label": "Cracked / Loose / Missing Siding",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Siding"
        }
      },
      {
        "key": "hi_siding_storm_damage",
        "label": "Storm Damage",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Siding"
        }
      },
      {
        "key": "hi_siding_water_damage",
        "label": "Water Damage",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Siding"
        }
      },
      {
        "key": "hi_siding_approximate_siding_age",
        "label": "Approximate Siding Age",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Siding"
        }
      }
    ]
  },
  {
    "id": "hi_gutters",
    "title": "Gutters",
    "fields": [
      {
        "key": "hi_gutters_repair_or_replacement",
        "label": "Repair or Replacement",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Gutters"
        }
      },
      {
        "key": "hi_gutters_full_home_or_section",
        "label": "Full Home or Section",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Gutters"
        }
      },
      {
        "key": "hi_gutters_leaking_gutters",
        "label": "Leaking Gutters",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Gutters"
        }
      },
      {
        "key": "hi_gutters_sagging_gutters",
        "label": "Sagging Gutters",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Gutters"
        }
      },
      {
        "key": "hi_gutters_missing_gutters",
        "label": "Missing Gutters",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Gutters"
        }
      },
      {
        "key": "hi_gutters_downspout_issues",
        "label": "Downspout Issues",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Gutters"
        }
      },
      {
        "key": "hi_gutters_gutter_guards_needed",
        "label": "Gutter Guards Needed",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Gutters"
        }
      }
    ]
  },
  {
    "id": "hi_kitchen_bathroom",
    "title": "Kitchen / Bathroom",
    "fields": [
      {
        "key": "hi_kitchen_bathroom_kitchen_or_bathroom",
        "label": "Kitchen or Bathroom",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_full_remodel_or_partial_remodel",
        "label": "Full Remodel or Partial Remodel",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_cabinets",
        "label": "Cabinets",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_countertops",
        "label": "Countertops",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_flooring",
        "label": "Flooring",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_sink_fixtures",
        "label": "Sink / Fixtures",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_shower_tub",
        "label": "Shower / Tub",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_plumbing_work_needed",
        "label": "Plumbing Work Needed",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      },
      {
        "key": "hi_kitchen_bathroom_electrical_work_needed",
        "label": "Electrical Work Needed",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Kitchen / Bathroom"
        }
      }
    ]
  },
  {
    "id": "hi_flooring",
    "title": "Flooring",
    "fields": [
      {
        "key": "hi_flooring_flooring_type_needed",
        "label": "Flooring Type Needed",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Flooring"
        }
      },
      {
        "key": "hi_flooring_rooms_areas",
        "label": "Rooms / Areas",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Flooring"
        }
      },
      {
        "key": "hi_flooring_approximate_sq_ft",
        "label": "Approximate SQ FT",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Flooring"
        }
      },
      {
        "key": "hi_flooring_current_flooring",
        "label": "Current Flooring",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Flooring"
        }
      },
      {
        "key": "hi_flooring_repair_or_replacement",
        "label": "Repair or Replacement",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Flooring"
        }
      },
      {
        "key": "hi_flooring_water_damage",
        "label": "Water Damage",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Flooring"
        }
      }
    ]
  },
  {
    "id": "hi_exterior_other_services",
    "title": "Exterior / Other Services",
    "fields": [
      {
        "key": "hi_exterior_other_services_painting",
        "label": "Painting",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_fencing",
        "label": "Fencing",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_deck_patio",
        "label": "Deck / Patio",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_concrete",
        "label": "Concrete",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_drywall",
        "label": "Drywall",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_roofing",
        "label": "Roofing",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_electrical",
        "label": "Electrical",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_plumbing",
        "label": "Plumbing",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_hvac",
        "label": "HVAC",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      },
      {
        "key": "hi_exterior_other_services_other_project",
        "label": "Other Project",
        "type": "text",
        "showWhen": {
          "field": "project_category",
          "equals": "Exterior / Other Services"
        }
      }
    ]
  },
  {
    "id": "hi_timeline",
    "title": "Timeline",
    "fields": [
      {
        "key": "project_timeline",
        "label": "When Do You Want to Start",
        "type": "text"
      },
      {
        "key": "urgent_repair",
        "label": "Urgent Repair",
        "type": "text"
      },
      {
        "key": "target_completion_date",
        "label": "Target Completion Date",
        "type": "text"
      },
      {
        "key": "ready_to_start_if_estimate_works",
        "label": "Ready to Start if Estimate Works",
        "type": "text"
      }
    ]
  },
  {
    "id": "hi_budget_financing",
    "title": "Budget / Financing",
    "fields": [
      {
        "key": "budget",
        "label": "Budget Range",
        "type": "text"
      },
      {
        "key": "payment_method",
        "label": "Paying Cash or Financing",
        "type": "text"
      },
      {
        "key": "interested_in_financing",
        "label": "Interested in Financing",
        "type": "text"
      },
      {
        "key": "monthly_payment_preference",
        "label": "Monthly Payment Preference",
        "type": "text"
      },
      {
        "key": "insurance_claim_involved",
        "label": "Insurance Claim Involved",
        "type": "text"
      }
    ]
  },
  {
    "id": "hi_appointment_qualification",
    "title": "Appointment Qualification",
    "fields": [
      {
        "key": "interested_in_free_estimate",
        "label": "Interested in Free Estimate",
        "type": "text"
      },
      {
        "key": "all_decision_makers_present",
        "label": "All Decision-Makers Present",
        "type": "text"
      },
      {
        "key": "best_contact_method",
        "label": "Best Contact Method",
        "type": "text"
      }
    ]
  },
  {
    "id": "hi_agent_notes",
    "title": "Agent Notes",
    "fields": [
      {
        "key": "customer_main_concern",
        "label": "Customer Main Concern",
        "type": "text"
      },
      {
        "key": "important_details",
        "label": "Important Details",
        "type": "text"
      },
      {
        "key": "special_instructions",
        "label": "Special Instructions",
        "type": "text"
      }
    ]
  }
];
