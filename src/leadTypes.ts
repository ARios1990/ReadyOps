// ---------------------------------------------------------------------------
// Cold-call lead lanes
// ---------------------------------------------------------------------------
// Roofing cold calls split into three lanes. The lane is set by the list the
// agent is dialing, and it drives three things: the script the agent reads, the
// qualifiers QC scores against, and how the AI writes the note to the inspector.
//
// Getting the lane wrong is what produced inspector notes claiming storm damage
// on calls where no damage was ever mentioned, so the lane is explicit rather
// than inferred from the transcript.
// ---------------------------------------------------------------------------

export const LEAD_TYPES = ['storm', 'retail', 'retail_convertible'] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export const DEFAULT_LEAD_TYPE: LeadType = 'retail';

/** The six qualifiers ReadyOps scores on every call. */
export const CORE_QUALIFIERS = [
  'appointment_confirmed',
  'homeowner_authority',
  'address_confirmed',
  'roof_age_or_damage',
  'payment_ready',
  'no_existing_contract',
] as const;
export type CoreQualifier = (typeof CORE_QUALIFIERS)[number];

/**
 * How a qualifier is treated in a given lane.
 *  required  - must be YES or the lead fails QC
 *  expected  - should be captured; UNKNOWN drops confidence but does not fail
 *  optional  - nice to have, never counts against the agent
 *  n_a       - not asked in this lane; UNKNOWN here is correct, not a gap
 */
export type QualifierWeight = 'required' | 'expected' | 'optional' | 'n_a';

export interface ScriptBlock {
  heading: string;
  lines: string[];
}

export interface LeadLane {
  id: LeadType;
  label: string;
  shortLabel: string;
  /** One line an agent or QC reviewer can read to know they picked right. */
  tagline: string;
  /** What list feeds this lane. */
  listSource: string;
  badgeTone: string;
  qualifierWeights: Record<CoreQualifier, QualifierWeight>;
  /** Extra fields this lane must capture beyond the core six. */
  requiredFields: string[];
  /** Fields the agent should NOT ask for in this lane. */
  suppressedFields: string[];
  script: {
    opener: ScriptBlock;
    qualify: ScriptBlock;
    objections: ScriptBlock;
    close: ScriptBlock;
  };
  disqualifiers: string[];
  complianceNotes: string[];
  /** Framing handed to the inspector so they arrive with the right expectation. */
  inspectorFraming: string;
}

// ---------------------------------------------------------------------------

const STORM: LeadLane = {
  id: 'storm',
  label: 'Storm / Insurance Restoration',
  shortLabel: 'Storm',
  tagline: 'A verified hail or wind event drives the call. Carrier pays, homeowner pays the deductible.',
  listSource: 'Hail and wind ZIPs inside the claim window (storm-date lists, hail maps).',
  badgeTone: 'border-sky-200 bg-sky-50 text-sky-800',
  qualifierWeights: {
    appointment_confirmed: 'required',
    homeowner_authority: 'required',
    address_confirmed: 'required',
    roof_age_or_damage: 'required',
    payment_ready: 'required',
    no_existing_contract: 'required',
  },
  requiredFields: ['storm_date', 'visible_damage', 'insurance_name', 'claim_filed'],
  suppressedFields: [],
  script: {
    opener: {
      heading: 'Opener',
      lines: [
        'Hi, is this {{homeowner_name}}? This is {{agent_name}} with {{company_name}}, we are a local roofing contractor here in {{city}}.',
        'The reason for my call is the storm that came through {{city}} on {{storm_date}} — we have been out on {{street_name}} and the streets around you working on roofs that took hail.',
        'We are doing free damage inspections in the neighborhood this week. Do you have a quick minute?',
      ],
    },
    qualify: {
      heading: 'Qualify — ask in this order',
      lines: [
        '1. Has anyone been up on your roof since the storm to check it?',
        '2. Have you noticed anything yourself — granules in the gutters, dings on the gutters or vents, any spots on the ceiling?',
        '3. And you own the home, correct? Is there anyone else on the deed who would want to be there?',
        '4. Let me confirm the address — {{address}}, is that right?',
        '5. Have you already filed a claim on this storm, or is this the first look?',
        '6. Who do you have your homeowner\'s insurance through?',
        '7. Are you currently signed with another roofing company for this storm?',
      ],
    },
    objections: {
      heading: 'Objections',
      lines: [
        '"I already had someone look at it." → Great — did they give you anything in writing, or are you signed with them? If it is just a look, a second set of eyes costs you nothing.',
        '"My roof looks fine." → That is usually the case from the ground. Hail bruising does not show until it starts leaking, and by then the claim window is often closed. That is the whole reason we inspect.',
        '"I do not want my rates to go up." → I cannot speak for your carrier on rates. What I can tell you is we document what is there and you decide whether to file. Nothing gets sent to anyone without you.',
        '"How much is this going to cost me?" → The inspection is free. If there is damage, this goes through your insurance and your out-of-pocket is your deductible. I cannot tell you more than that until someone is on the roof.',
        '"I am busy." → Totally fair. The inspection takes about 20 minutes and you do not need to be on the roof with us. Would mornings or afternoons be easier this week?',
      ],
    },
    close: {
      heading: 'Close and confirm',
      lines: [
        'I have {{day}} at {{time}} — does that work? Our inspector will be out about 20 minutes.',
        'Recap back to them: name, address, day, time, carrier.',
        'Let them know: "He will walk the roof, take photos, and go over what he finds with you before he leaves."',
      ],
    },
  },
  disqualifiers: [
    'Not the homeowner or not on the deed',
    'Renter, or landlord not on the call',
    'Already signed a contract with another roofer for this storm',
    'Property outside the storm footprint or outside the service area',
    'Claim already settled and roof already replaced',
    'Asks to be removed from the list — mark DNC immediately',
  ],
  complianceNotes: [
    'Never promise the claim will be approved or that the roof will be "free."',
    'Never offer to cover, absorb, waive, or rebate the deductible. In Texas this is prohibited under Insurance Code Ch. 707 — confirm your client\'s own policy language before scripting anything about deductibles.',
    'Agents do not negotiate, adjust, or interpret the claim. Route all carrier questions to the homeowner and their adjuster.',
    'Do not tell the homeowner they "definitely have damage" before anyone has inspected the roof.',
  ],
  inspectorFraming: 'Storm lead. Homeowner is expecting a damage inspection tied to a specific weather event. Document hail or wind indicators with photos and be ready to discuss the claim process.',
};

const RETAIL: LeadLane = {
  id: 'retail',
  label: 'Retail (Homeowner Pays)',
  shortLabel: 'Retail',
  tagline: 'Age, wear, or a leak drives the call. Homeowner pays cash or finances.',
  listSource: 'Roof-age and home-age lists. No storm event attached.',
  badgeTone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  qualifierWeights: {
    appointment_confirmed: 'required',
    homeowner_authority: 'required',
    address_confirmed: 'required',
    roof_age_or_damage: 'required',
    payment_ready: 'expected',
    no_existing_contract: 'required',
  },
  requiredFields: ['roof_age', 'roof_type', 'last_checked_on'],
  suppressedFields: ['storm_date', 'hail_size', 'claim_filed', 'insurance_name'],
  script: {
    opener: {
      heading: 'Opener',
      lines: [
        'Hi, is this {{homeowner_name}}? This is {{agent_name}} with {{company_name}}, we are a local roofing company here in {{city}}.',
        'I am calling because we are doing free roof check-ups in {{neighborhood}} this week — it takes about 10 minutes and there is no cost and no obligation.',
        'Do you have a quick second?',
      ],
    },
    qualify: {
      heading: 'Qualify — ask in this order',
      lines: [
        '1. Roughly how old is the roof on the house? Was it there when you moved in?',
        '2. Has anyone ever been up to inspect it, or is this the original roof?',
        '3. Do you know what it is — shingle, metal, tile?',
        '4. Any issues you have noticed — leaks, missing shingles, stains on a ceiling?',
        '5. And you are the homeowner, correct? Anyone else who would want to be there for it?',
        '6. Let me confirm the address — {{address}}, is that right?',
        '7. Are you working with another roofing company right now, or would we be your first look?',
      ],
    },
    objections: {
      heading: 'Objections',
      lines: [
        '"My roof is fine." → That is good to hear, and honestly most are until they are not. This is a 10-minute check so you know how much life you have left in it. No cost either way.',
        '"I am not interested." → No problem at all. Can I ask — is it that the roof is newer, or just not something you are thinking about right now?',
        '"How much does a roof cost?" → It depends entirely on size and material, and I would be guessing over the phone. That is what the inspection is for — you get real numbers, not a range.',
        '"Are you going to try to sell me a roof?" → Not on this visit. He inspects, shows you photos, and tells you what he sees. If it has years left, he will tell you that.',
        '"Just send me some information." → I can do that. What usually helps more is the 10-minute look, because then the information is about your roof instead of roofs in general. What does your week look like?',
        '"I cannot afford it." → Understood, and nothing about the inspection costs anything. Knowing where the roof stands actually helps you plan instead of getting surprised by a leak.',
      ],
    },
    close: {
      heading: 'Close and confirm',
      lines: [
        'We have someone in your area {{day}} — would {{time_option_a}} or {{time_option_b}} be better?',
        'Recap back to them: name, address, day, time.',
        'Set the expectation: "It is about 10 to 15 minutes, you do not need to do anything, and he will walk you through what he finds before he leaves."',
      ],
    },
  },
  disqualifiers: [
    'Not the homeowner, or a renter',
    'Roof replaced within the last {{minimum_roof_age}} years with no known issues',
    'Already signed with another roofing company',
    'Outside the service area',
    'Home is listed for sale and the seller will not authorize work',
    'Asks to be removed from the list — mark DNC immediately',
  ],
  complianceNotes: [
    'Do not mention insurance, claims, or carriers on a retail call. There is no event to claim against and it confuses the appointment.',
    'Do not quote a price, a range, or a "typical cost" over the phone.',
    'Do not tell the homeowner they need a new roof before anyone has looked at it.',
  ],
  inspectorFraming: 'Retail lead booked for an age and condition inspection, not a storm claim. Lead with photos and condition, not urgency.',
};

const RETAIL_CONVERTIBLE: LeadLane = {
  id: 'retail_convertible',
  label: 'Retail — Possible Claim',
  shortLabel: 'Retail → Claim',
  tagline: 'Retail pitch on roof age, in hail country. Converts to a claim only if the inspector finds storm damage.',
  listSource: 'Roof-age lists inside historically hail-prone ZIPs. No confirmed event on this property.',
  badgeTone: 'border-amber-200 bg-amber-50 text-amber-800',
  qualifierWeights: {
    appointment_confirmed: 'required',
    homeowner_authority: 'required',
    address_confirmed: 'required',
    roof_age_or_damage: 'required',
    payment_ready: 'optional',
    no_existing_contract: 'required',
  },
  requiredFields: ['roof_age', 'roof_type', 'last_checked_on', 'insurance_name'],
  suppressedFields: ['storm_date', 'hail_size', 'claim_filed'],
  script: {
    opener: {
      heading: 'Opener — retail framing, do not lead with insurance',
      lines: [
        'Hi, is this {{homeowner_name}}? This is {{agent_name}} with {{company_name}}, a local roofing company here in {{city}}.',
        'We are out doing free 10-minute roof check-ups in {{neighborhood}} this week — no cost, no obligation.',
        'Do you have a quick second?',
      ],
    },
    qualify: {
      heading: 'Qualify — carrier question goes LAST, after the appointment is set',
      lines: [
        '1. About how old is the roof? Was it on the house when you bought it?',
        '2. Has it ever been inspected, or is it original?',
        '3. Shingle, metal, or tile?',
        '4. Anything you have noticed — leaks, stains, missing shingles?',
        '5. You are the homeowner, correct?',
        '6. Confirming the address — {{address}}?',
        '7. Are you signed with any other roofing company right now?',
        '--- Lock the appointment here, THEN ask: ---',
        '8. "Last thing so I can get the file set up — who do you have your homeowner\'s insurance through?"',
        'Ask it open-ended. Never feed a carrier name ("Is that Allstate?") — you will get a wrong answer you have to correct later.',
      ],
    },
    objections: {
      heading: 'Objections',
      lines: [
        'Use the retail objection set. Do not reach for insurance to save a call.',
        '"Why do you need my insurance?" → Just for the file. If the inspector finds storm damage up there it is worth knowing who to point you to, but this visit is a condition check either way.',
        '"Is insurance going to pay for this?" → I honestly cannot say — nobody has been on the roof yet. If he finds storm damage he will walk you through the options then.',
        '"My roof is fine." → Most look fine from the driveway. Ten minutes tells you how much life is left in it.',
      ],
    },
    close: {
      heading: 'Close and confirm',
      lines: [
        'We have someone out {{day}} — is {{time_option_a}} or {{time_option_b}} better?',
        'Recap: name, address, day, time, carrier.',
        'Set the expectation honestly: "It is a short condition check. If he sees storm damage he will tell you, but he is not coming out to file anything."',
      ],
    },
  },
  disqualifiers: [
    'Not the homeowner, or a renter',
    'Roof replaced within the last {{minimum_roof_age}} years with no known issues',
    'Already signed with another roofing company',
    'No homeowner\'s insurance at all — route to the retail lane instead',
    'Outside the service area',
    'Asks to be removed from the list — mark DNC immediately',
  ],
  complianceNotes: [
    'This is a retail appointment that may convert. Never present it to the homeowner as an insurance or storm call.',
    'Never imply a claim will be filed, approved, or paid before an inspection has happened.',
    'Never discuss covering, waiving, or rebating a deductible. In Texas that is prohibited under Insurance Code Ch. 707 — use your client\'s own approved language.',
    'The carrier question is for the file only. If the agent uses it to sell the appointment, the lane is being run wrong.',
  ],
  inspectorFraming: 'Retail lead in storm territory. The homeowner was NOT sold on insurance — treat this as an age and condition inspection first. If storm damage is present, introduce the claim path on site; do not assume the homeowner is expecting it.',
};

// ---------------------------------------------------------------------------

export const LEAD_LANES: Record<LeadType, LeadLane> = {
  storm: STORM,
  retail: RETAIL,
  retail_convertible: RETAIL_CONVERTIBLE,
};

export const LEAD_TYPE_OPTIONS = LEAD_TYPES.map(id => ({
  value: id,
  label: LEAD_LANES[id].label,
}));

/** Accepts anything a ReadyMode campaign or an older lead record might carry. */
export function normalizeLeadType(value: unknown): LeadType {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return DEFAULT_LEAD_TYPE;
  if ((LEAD_TYPES as readonly string[]).includes(raw)) return raw as LeadType;
  if (raw.includes('convert') || raw.includes('hybrid') || raw === 'retail_claim') return 'retail_convertible';
  if (raw.startsWith('storm') || raw.includes('hail') || raw.includes('wind') || raw.includes('insurance') || raw.includes('restoration')) return 'storm';
  if (raw.startsWith('retail') || raw.includes('age') || raw.includes('cash')) return 'retail';
  return DEFAULT_LEAD_TYPE;
}

export function getLane(value: unknown): LeadLane {
  return LEAD_LANES[normalizeLeadType(value)];
}

/** True when UNKNOWN on this qualifier should NOT count against the lead. */
export function qualifierIsExcused(leadType: unknown, qualifier: CoreQualifier): boolean {
  const weight = getLane(leadType).qualifierWeights[qualifier];
  return weight === 'optional' || weight === 'n_a';
}

/** Fields the agent should not be asked for in this lane. */
export function fieldIsSuppressed(leadType: unknown, fieldKey: string): boolean {
  return getLane(leadType).suppressedFields.includes(fieldKey);
}

/** Fills {{tokens}} in script lines from whatever context is available. */
export function renderScriptLine(line: string, context: Record<string, unknown>): string {
  return line.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = context[key];
    if (value === undefined || value === null || String(value).trim() === '') return match;
    return String(value);
  });
}

