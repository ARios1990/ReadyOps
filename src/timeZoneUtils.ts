const EASTERN_STATES = new Set(['CT','DE','DC','GA','ME','MD','MA','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV']);
const CENTRAL_STATES = new Set(['AL','AR','IL','IA','LA','MN','MS','MO','OK','WI']);
const MOUNTAIN_STATES = new Set(['CO','MT','NM','UT','WY']);
const PACIFIC_STATES = new Set(['CA','NV','WA']);

const CITY_OVERRIDES: Array<[RegExp, string, string]> = [
  [/\b(el paso|socorro|horizon city)\b/i, 'TX', 'America/Denver'],
  [/\b(chattanooga|knoxville|gatlinburg|johnson city|kingsport|bristol)\b/i, 'TN', 'America/New_York'],
  [/\b(nashville|memphis|clarksville|jackson)\b/i, 'TN', 'America/Chicago'],
  [/\b(pensacola|panama city|destin|fort walton beach|tallahassee)\b/i, 'FL', 'America/Chicago'],
  [/\b(miami|orlando|tampa|jacksonville|fort lauderdale|west palm beach)\b/i, 'FL', 'America/New_York'],
  [/\b(louisville|bowling green|owensboro|paducah)\b/i, 'KY', 'America/Chicago'],
  [/\b(lexington|frankfort|covington)\b/i, 'KY', 'America/New_York'],
  [/\b(gary|hammond|east chicago|evansville)\b/i, 'IN', 'America/Chicago'],
  [/\b(indianapolis|fort wayne|south bend|bloomington)\b/i, 'IN', 'America/Indiana/Indianapolis'],
  [/\b(boise|idaho falls|pocatello|twin falls)\b/i, 'ID', 'America/Boise'],
  [/\b(coeur d'alene|lewiston|moscow)\b/i, 'ID', 'America/Los_Angeles'],
  [/\b(medford|portland|eugene|salem|bend)\b/i, 'OR', 'America/Los_Angeles'],
  [/\b(ontario|malheur)\b/i, 'OR', 'America/Boise'],
  [/\b(rapid city|spearfish|sturgis)\b/i, 'SD', 'America/Denver'],
  [/\b(sioux falls|aberdeen|brookings)\b/i, 'SD', 'America/Chicago'],
  [/\b(dickinson|williston|medora)\b/i, 'ND', 'America/Denver'],
  [/\b(fargo|bismarck|grand forks|minot)\b/i, 'ND', 'America/Chicago'],
  [/\b(scottsbluff|alliance|sidney)\b/i, 'NE', 'America/Denver'],
  [/\b(omaha|lincoln|grand island)\b/i, 'NE', 'America/Chicago'],
  [/\b(dodge city|garden city|goodland)\b/i, 'KS', 'America/Denver'],
  [/\b(wichita|topeka|kansas city)\b/i, 'KS', 'America/Chicago'],
];

export const READYOPS_TIME_ZONES = [
  { value: 'America/New_York', label: 'Eastern — America/New_York' },
  { value: 'America/Detroit', label: 'Eastern (Michigan) — America/Detroit' },
  { value: 'America/Indiana/Indianapolis', label: 'Eastern (Indiana) — America/Indiana/Indianapolis' },
  { value: 'America/Chicago', label: 'Central — America/Chicago' },
  { value: 'America/Denver', label: 'Mountain — America/Denver' },
  { value: 'America/Boise', label: 'Mountain (Idaho) — America/Boise' },
  { value: 'America/Phoenix', label: 'Arizona — America/Phoenix' },
  { value: 'America/Los_Angeles', label: 'Pacific — America/Los_Angeles' },
  { value: 'America/Anchorage', label: 'Alaska — America/Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii — Pacific/Honolulu' },
  { value: 'America/Puerto_Rico', label: 'Puerto Rico / Atlantic — America/Puerto_Rico' },
] as const;

export function inferUsTimeZone(city: string, state: string, zipCode = ''): string {
  const normalizedState = state.trim().toUpperCase();
  const normalizedCity = city.trim();
  const zip = zipCode.replace(/\D/g, '').slice(0, 5);

  for (const [pattern, targetState, zone] of CITY_OVERRIDES) {
    if (normalizedState === targetState && pattern.test(normalizedCity)) return zone;
  }

  if (normalizedState === 'TX' && zip.startsWith('799')) return 'America/Denver';
  if (normalizedState === 'FL' && /^(324|325)/.test(zip)) return 'America/Chicago';
  if (normalizedState === 'AZ') return 'America/Phoenix';
  if (normalizedState === 'AK') return 'America/Anchorage';
  if (normalizedState === 'HI') return 'Pacific/Honolulu';
  if (normalizedState === 'PR') return 'America/Puerto_Rico';
  if (normalizedState === 'MI') return 'America/Detroit';
  if (normalizedState === 'IN') return 'America/Indiana/Indianapolis';
  if (normalizedState === 'TN') return 'America/Chicago';
  if (normalizedState === 'KY') return 'America/New_York';
  if (normalizedState === 'FL') return 'America/New_York';
  if (normalizedState === 'ID') return 'America/Boise';
  if (normalizedState === 'OR') return 'America/Los_Angeles';
  if (normalizedState === 'ND' || normalizedState === 'SD' || normalizedState === 'NE' || normalizedState === 'KS') return 'America/Chicago';
  if (EASTERN_STATES.has(normalizedState)) return 'America/New_York';
  if (CENTRAL_STATES.has(normalizedState) || normalizedState === 'TX') return 'America/Chicago';
  if (MOUNTAIN_STATES.has(normalizedState)) return 'America/Denver';
  if (PACIFIC_STATES.has(normalizedState)) return 'America/Los_Angeles';
  return '';
}
