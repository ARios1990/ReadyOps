import type { PortalFormSection } from "./DynamicLeadForm";

export type ServiceTemplate = {
  id: string;
  name: string;
  template_title: string;
  active: boolean;
  enabled?: boolean;
  form_schema: PortalFormSection[];
  qualification_rules: { fields?: QualificationRule[]; [key: string]: unknown };
};
export type QualificationRule = {
  key: string;
  operator: "equals" | "one_of" | "min" | "max";
  value: unknown;
};

const customer: PortalFormSection = {
  id: "customer",
  title: "Customer Information",
  fields: [
    { key: "full_name", label: "Customer Name", type: "text", required: true },
    {
      key: "phone_number",
      label: "Phone Number",
      type: "phone",
      required: true,
    },
    { key: "address", label: "Address", type: "address", required: true },
    { key: "city", label: "City", type: "text" },
    { key: "state", label: "State", type: "text" },
    { key: "zip_code", label: "ZIP Code", type: "text" },
    { key: "email", label: "Customer Email", type: "email" },
    {
      key: "language",
      label: "Language",
      type: "select",
      options: ["English", "Spanish", "Other"],
    },
    {
      key: "service_needed",
      label: "Service Requested",
      type: "text",
      required: true,
    },
  ],
};
const notes: PortalFormSection = {
  id: "additional",
  title: "Additional Information",
  fields: [
    { key: "notes", label: "Appointment Notes", type: "textarea" },
    {
      key: "recording_url",
      label: "Call Recording (QC only)",
      type: "recording",
    },
  ],
};
const field = (
  key: string,
  label: string,
  type = "text",
  options?: string[],
) => ({ key, label, type, options });
const yesNo = (key: string, label: string) =>
  field(key, label, "select", ["Yes", "No", "Unknown"]);

export const DEFAULT_SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    id: "roofing",
    name: "Roofing",
    template_title: "Roof Inspection",
    active: true,
    qualification_rules: {},
    form_schema: [
      customer,
      {
        id: "service",
        title: "Roofing Qualifiers & Property Details",
        fields: [
          yesNo(
            "homeowner_authority",
            "Are you the homeowner or authorized decision-maker?",
          ),
          field("roof_age", "Roof Age"),
          field("roof_type", "Roof Type", "select", [
            "Shingle",
            "Metal",
            "Tile",
            "Flat",
            "Other",
          ]),
          field("last_checked_on", "Last Roof Inspection"),
          field("visible_damage", "Visible Roof Damage"),
          field("damage_type", "Damage Type"),
          field("hail_size", "Hail Size"),
          field("storm_date", "Storm Date", "date"),
          yesNo("contract", "Signed with another contractor?"),
          field("insurance_name", "Insurance Carrier"),
          field("stories", "Stories", "number"),
          field("home_type", "Home Type"),
          field("home_value", "Home Value", "currency"),
          field("sq_ft", "Square Footage", "number"),
          field("web_url", "Property Link", "url"),
        ],
      },
      notes,
    ],
  },
  {
    id: "permanent_exterior_lighting",
    name: "Permanent Exterior Lighting",
    template_title: "Exterior Lighting Appointment",
    active: true,
    qualification_rules: {},
    form_schema: [
      customer,
      {
        id: "service",
        title: "Lighting Qualifiers & Design",
        fields: [
          yesNo("homeowner_authority", "Authorized property decision-maker?"),
          field("lighting_type", "Lighting Type", "select", [
            "Permanent Exterior Lighting",
            "Seasonal Holiday Lighting",
            "Both",
          ]),
          field("lighting_areas", "Areas to Light", "multiselect", [
            "Roofline",
            "Patio",
            "Landscape",
            "Other",
          ]),
          field("stories", "Stories", "number"),
          field("lighting_length", "Estimated Linear Feet", "number"),
          field("power_access", "Available Power Access"),
          field("budget", "Budget", "currency"),
          field("project_timeline", "Desired Installation Timeline"),
        ],
      },
      notes,
    ],
  },
  {
    id: "tree_service",
    name: "Tree Service",
    template_title: "Tree Service Appointment",
    active: true,
    qualification_rules: {},
    form_schema: [
      customer,
      {
        id: "service",
        title: "Tree Service Qualifiers",
        fields: [
          yesNo("homeowner_authority", "Authorized property decision-maker?"),
          field("tree_work", "Work Requested", "select", [
            "Trimming",
            "Removal",
            "Stump Grinding",
            "Storm Cleanup",
            "Other",
          ]),
          field("tree_count", "Number of Trees", "number"),
          field("tree_size", "Approximate Tree Size"),
          yesNo("hazard_near_structure", "Near structures or utility lines?"),
          field("site_access", "Site Access"),
          field("project_timeline", "Desired Work Timeline"),
        ],
      },
      notes,
    ],
  },
  {
    id: "solar",
    name: "Solar",
    template_title: "Solar Appointment",
    active: true,
    qualification_rules: {},
    form_schema: [
      customer,
      {
        id: "service",
        title: "Solar Qualifiers",
        fields: [
          yesNo("homeowner_authority", "Are you the homeowner?"),
          field("monthly_electric_bill", "Monthly Electric Bill", "currency"),
          field("utility_provider", "Utility Provider"),
          field("roof_condition", "Roof Condition"),
          yesNo("existing_solar", "Existing solar system?"),
          field("shade_conditions", "Roof Shading"),
          field("solar_interest", "Solar Goals"),
          field("project_timeline", "Project Timeline"),
        ],
      },
      notes,
    ],
  },
  {
    id: "pdr",
    name: "PDR",
    template_title: "Paintless Dent Repair Appointment",
    active: true,
    qualification_rules: {},
    form_schema: [
      customer,
      {
        id: "service",
        title: "PDR Qualifiers & Vehicle Details",
        fields: [
          yesNo(
            "vehicle_authority",
            "Vehicle owner or authorized decision-maker?",
          ),
          field("vehicle_year", "Vehicle Year", "number"),
          field("vehicle_make", "Vehicle Make"),
          field("vehicle_model", "Vehicle Model"),
          field("dent_location", "Dent Location"),
          field("damage_cause", "Damage Cause", "select", [
            "Hail",
            "Door Ding",
            "Other",
          ]),
          yesNo("paint_damage", "Paint damage present?"),
          field("insurance_name", "Insurance Carrier"),
          field("claim_status", "Claim Status"),
        ],
      },
      notes,
    ],
  },
  {
    id: "home_improvement",
    name: "Home Improvement",
    template_title: "Home Improvement Appointment",
    active: true,
    qualification_rules: {},
    form_schema: [
      customer,
      {
        id: "service",
        title: "Home Improvement Qualifiers",
        fields: [
          yesNo("homeowner_authority", "Authorized property decision-maker?"),
          field("project_type", "Project Type"),
          field("project_scope", "Project Scope", "textarea"),
          field("budget", "Project Budget", "currency"),
          field("project_timeline", "Project Timeline"),
          field("decision_makers", "Decision-makers Attending"),
          yesNo("contract", "Signed with another contractor?"),
        ],
      },
      notes,
    ],
  },
  {
    id: "water_treatment",
    name: "Water Treatment",
    template_title: "Water Treatment Appointment",
    active: true,
    qualification_rules: {},
    form_schema: [
      customer,
      {
        id: "service",
        title: "Water Treatment Qualifiers",
        fields: [
          yesNo("homeowner_authority", "Are you the homeowner?"),
          field("water_source", "Water Source", "select", [
            "City",
            "Well",
            "Other",
          ]),
          field("water_concerns", "Water Concerns", "textarea"),
          field("existing_system", "Existing Treatment System"),
          field("household_size", "Household Size", "number"),
        ],
      },
      notes,
    ],
  },
];

export function inferServiceType(value: unknown): string {
  const text = String(value || "").toLowerCase();
  if (/(^|[^a-z])(lights?|lighting)([^a-z]|$)/.test(text))
    return "permanent_exterior_lighting";
  if (/(^|[^a-z])(tree|stump)([^a-z]|$)/.test(text)) return "tree_service";
  if (/(^|[^a-z])solar([^a-z]|$)/.test(text)) return "solar";
  if (
    /(^|[^a-z])(pdr|dents?|paintless)([^a-z]|$)|vehicle_(year|make|model)/.test(
      text,
    )
  )
    return "pdr";
  if (/(^|[^a-z])(water|filtration)([^a-z]|$)/.test(text))
    return "water_treatment";
  if (/home[ _]improvement|remodel|project_type/.test(text))
    return "home_improvement";
  return "roofing";
}

export function visibleTemplateFields(
  schema: PortalFormSection[],
  values?: Record<string, unknown>,
) {
  return schema.flatMap((section) =>
    section.fields.filter(
      (f) =>
        f.mode !== "hidden" &&
        (!values ||
          !f.showWhen?.field ||
          values[f.showWhen.field] === f.showWhen.equals),
    ),
  );
}

export function switchServiceValues(
  values: Record<string, unknown>,
  previous: ServiceTemplate | undefined,
  next: ServiceTemplate,
) {
  const customerKeys = new Set(
    customer.fields
      .map((f) => f.key)
      .concat([
        "notes",
        "recording_url",
        "lead_type",
        "property_latitude",
        "property_longitude",
      ]),
  );
  const previousKeys = new Set(
    previous?.form_schema.flatMap((s) => s.fields.map((f) => f.key)) || [],
  );
  const kept = Object.fromEntries(
    Object.entries(values).filter(
      ([key]) =>
        customerKeys.has(key) ||
        (!previousKeys.has(key) && key.startsWith("_source")),
    ),
  );
  // Never carry another service's answers, hidden values or qualifiers forward.
  return {
    ...kept,
    service_type: next.id,
    service_needed: next.name,
    _universal_template: true,
  };
}

export function buildUniversalLeadTemplate(
  template: Pick<ServiceTemplate, "name" | "template_title" | "form_schema">,
  values: Record<string, unknown>,
): string {
  const format = (value: unknown) =>
    Array.isArray(value) ? value.join(", ") : String(value ?? "").trim() || "—";
  return [
    `**${template.template_title}**`,
    `Service Type: ${template.name}`,
    `Appointment: ${format(values.appointment_date)} ${format(values.appointment_time)} ${format(values.timezone)}`,
    ...template.form_schema.flatMap((section) => [
      `\n**${section.title}**`,
      ...section.fields
        .filter(
          (f) =>
            f.mode !== "hidden" &&
            f.type !== "recording" &&
            (!f.showWhen?.field ||
              values[f.showWhen.field] === f.showWhen.equals),
        )
        .map((f) => `${f.label}: ${format(values[f.key])}`),
    ]),
  ].join("\n");
}
