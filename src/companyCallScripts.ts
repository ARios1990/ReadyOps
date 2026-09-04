import type { ScriptBlock } from "./leadTypes";

export interface CompanyCallScript {
  label: string;
  shortLabel: string;
  tagline: string;
  listSource: string;
  badgeTone: string;
  script: {
    opener: ScriptBlock;
    qualify: ScriptBlock;
    objections: ScriptBlock;
    close: ScriptBlock;
  };
  disqualifiers: string[];
  complianceNotes: string[];
}

const GOLDEN_AGUA: CompanyCallScript = {
  label: "Golden Agua Systems",
  shortLabel: "Water",
  tagline:
    "Create interest, qualify the homeowner, and book a free in-home water test or system estimate.",
  listSource: "DFW homeowner water-filtration campaign.",
  badgeTone: "border-cyan-200 bg-cyan-50 text-cyan-800",
  script: {
    opener: {
      heading: "Opening and hook",
      lines: [
        "Hi, is this {{homeowner_name}}? Hey {{homeowner_name}}, I'm {{agent_name}} with {{company_name}}. We're in your area offering free in-home water tests and estimates for water-filtration systems.",
        "Have you noticed any bad taste, odor, staining, or spots on dishes and faucets from your water?",
      ],
    },
    qualify: {
      heading: "Qualify and explain",
      lines: [
        "Are you the homeowner?",
        "Do you have city water or well water?",
        "What water issues have you noticed: bad taste, smell, staining, or spots on dishes and faucets?",
        "How many people live in the home?",
        "Do you have a refrigerator or ice maker connected to the water line?",
        "Have you ever had your water tested or considered a filtration system before?",
        "Would you be open to a free in-home water test or system estimate this week?",
        "Our systems are designed to reduce common contaminants and improve taste throughout the home. The specialist will test your water and recommend the right option for your family.",
      ],
    },
    objections: {
      heading: "Handle objections",
      lines: [
        "NOT INTERESTED: I understand. The water test is free and gives you clear information about what is in your home's water, with no obligation to buy.",
        "IT COSTS TOO MUCH: The specialist will size the system for your home and explain the exact price and available options. The test and estimate are free.",
        "OUR WATER IS FINE: That's great. A quick test can still confirm the quality and show whether chlorine, hardness, or other common issues are present.",
        "NEED TO TALK TO MY SPOUSE: Absolutely. Let's choose a time when both decision makers can be there for the results and estimate.",
      ],
    },
    close: {
      heading: "Call to action and close",
      lines: [
        "Would {{day_option_one}} around {{time_option_one}} or {{day_option_two}} around {{time_option_two}} work better for the free in-home water test?",
        "Perfect, I have you down for {{appointment_date}} at {{appointment_time}} at {{address}}. The specialist will test the water, review the results, and provide a system estimate.",
        "Please make sure all homeowners or decision makers are available. If now is not the right time, may we follow up in a few days?",
      ],
    },
  },
  disqualifiers: [
    "Renter without the property owner's installation approval",
    "Outside the DFW service area",
    "Not open to a free water test or estimate",
    "No homeowner or authorized decision maker can attend",
  ],
  complianceNotes: [
    "Do not promise that a system removes every contaminant; the water test and selected equipment determine performance.",
    "Do not guarantee a specific utility-bill savings amount.",
    "Describe offers accurately and do not create false urgency.",
  ],
};

const GOLDEN_GLOW: CompanyCallScript = {
  label: "Golden Glow Lighting",
  shortLabel: "Lighting",
  tagline:
    "Create interest, qualify the homeowner, and book the free design and estimate. Sell the appointment, not the system.",
  listSource: "DFW C9 and permanent exterior-lighting campaign.",
  badgeTone: "border-amber-200 bg-amber-50 text-amber-800",
  script: {
    opener: {
      heading: "Opener",
      lines: [
        "Hi, is this {{homeowner_name}}? Hey {{homeowner_name}}, this is {{agent_name}} with {{company_name}}. We're currently doing free estimates in your area for permanent exterior lighting systems—the lighting that stays installed along the roofline so you don't have to put up and take down holiday lights every year. Have you seen those permanent color-changing lights on homes before?",
        "IF YES: Perfect, that's exactly what I'm talking about. They're useful year-round for holidays, warm-white accent lighting, birthdays, and game days. Would you be open to seeing a free custom design and estimate for your home?",
        "IF NO / NOT SURE: They're LED lights installed in a low-profile track along the roof edge. During the day they blend in, and at night you control colors, brightness, patterns, and schedules from your phone. Would you be open to a free design and estimate?",
      ],
    },
    qualify: {
      heading: "Ask all five qualifying questions",
      lines: [
        "Are you the homeowner there?",
        "Do you normally put up Christmas or holiday lights? Record the answer in Notes.",
        "Do you put them up yourself, or hire someone? Record the answer in Notes.",
        "What would you use permanent lighting for most—holidays, accent lighting, or a little of everything?",
        "If the numbers made sense, is this something you'd consider installing?",
        "MATCH THE PITCH: Hires an installer—install once instead of paying every season. DIY—no ladder work, storage, tangled strands, or yearly setup. Does not decorate—warm-white architectural accent lighting. Smart-home interest—phone controls, schedules, zones, colors, and patterns. New or renovated home—permanent exterior upgrade.",
      ],
    },
    objections: {
      heading: "Objections",
      lines: [
        "NOT INTERESTED: Totally understand. Have you seen permanent lighting before, or is it just not something you've looked into? The design and estimate are free, so you can see what it looks like and costs, then decide.",
        "HOW MUCH IS IT?: It depends on the length and design of the roofline. They measure the property first, then provide the exact price. The design and quote are free.",
        "I HAVE LIGHTS: Most people we speak with do. The difference is these stay permanently installed—nothing to take down, store, or replace.",
        "I DON'T DECORATE: That's fine. Many homeowners use warm white around the roofline as accent lighting and change colors only when they want.",
        "SEND ME INFO: Absolutely. Since the design depends on the house, we can also have them put together the free design. Are you usually more available in the afternoon or evening?",
        "TALK TO MY SPOUSE: Of course. Since this is an exterior home improvement, it works best if you both see the design and pricing together. What day are you both usually available?",
      ],
    },
    close: {
      heading: "Close with two times, then confirm",
      lines: [
        "We have somebody working in your area {{day_option_one}}. They'll look at the roofline, show you the design options, and give you the exact quote. Would {{time_option_one}} or {{time_option_two}} work better?",
        "Never ask only: Would you like an appointment?",
        "Perfect, I have you down for {{appointment_date}} at {{appointment_time}} at {{address}}. The specialist will show you the permanent-lighting options and prepare the custom quote. Will the other decision maker also be available?",
        "In Notes, call out professional seasonal-lighting spend, yearly decorating, a difficult or two-story roofline, ladder concerns, accent-lighting or smart-home interest, a recent purchase or renovation, financing interest, and higher-value properties.",
      ],
    },
  },
  disqualifiers: [
    "Not the homeowner and no authorized decision maker can attend",
    "Outside the DFW service area",
    "No interest in either C9 seasonal lighting or permanent exterior lighting",
    "Will not consider installation even if the design and price make sense",
  ],
  complianceNotes: [
    "Do not quote a price before the roofline is measured and designed.",
    "Do not promise savings, financing approval, installation dates, or product features that have not been confirmed.",
    "Book a free design and estimate; do not pressure the homeowner to buy on the call.",
  ],
};

const COMPANY_CALL_SCRIPTS: Record<string, CompanyCallScript> = {
  "golden-agua-systems": GOLDEN_AGUA,
  "golden-glow-lighting": GOLDEN_GLOW,
};

export function getCompanyCallScript(slug?: string | null): CompanyCallScript | null {
  return slug ? COMPANY_CALL_SCRIPTS[slug] || null : null;
}
