export type ComplianceCue = { label: string; excerpt: string; timestamp?: string; confidence: 'Low' | 'Medium'; explanation: string };
const rules: [string, RegExp, string][] = [
 ['DNC', /do not (?:call|contact|text)|don'?t (?:call|contact|text)|stop (?:calling|texting)|remove (?:me|my number)|no (?:me llame|llamen)|deje de llamar/i, 'Possible opt-out request. Confirm the speaker and record an internal opt-out immediately when verified.'],
 ['Legal Language', /attorney|lawyer|lawsuit|sue you|ftc|tcpa|abogado|demanda/i, 'Legal or regulatory words require contextual human review. They do not establish legal intent.'],
 ['Consent Review', /consent|permission|never agreed|did not agree|didn.t agree|autoriz|permiso/i, 'Review the basis and scope of consent.'],
 ['Sarcasm / Intent Review', /just joking|kidding|sarcas|broma|contradict/i, 'Possible joking or contradictory wording; do not infer dishonesty.'],
 ['Consent Review', /not interested|no thanks|don.t want|no me interesa|no gracias/i, 'Review refusal, repeated objections, and any agent pressure afterward.'],
 ['Consent Review', /what is this (?:for|about)|why are you|don.t understand|not sure|maybe|no entiendo/i, 'Appointment acceptance or purpose may be unclear.'],
];
export function transcriptComplianceCues(transcript: string): ComplianceCue[] {
 const cues: ComplianceCue[]=[];
 for(const line of transcript.split(/\n|(?<=[.!?])\s+/)) for(const [label,re,explanation] of rules) if(re.test(line)) {
   cues.push({label,excerpt:line.trim().slice(0,500),timestamp:line.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0],confidence:label==='DNC'?'Medium':'Low',explanation});
 }
 return cues.slice(0,30);
}
export function complianceRisk(cues: ComplianceCue[], restricted: boolean) {
 return cues.some(c=>c.label==='DNC') ? 'High-Risk Compliance Review' : restricted || cues.some(c=>c.label==='Legal Language') ? 'Compliance Concern' : cues.length ? 'Needs Review' : 'Normal';
}
