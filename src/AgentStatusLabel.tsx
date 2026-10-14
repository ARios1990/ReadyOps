import { normalizeLeadDisposition, normalizeLeadStatus } from './leadStatusPresentation';

const styles: Record<string, { label: string; color: string }> = {
  approved: { label: 'QC Approved', color: '#15803D' },
  qc_approved: { label: 'QC Approved', color: '#15803D' },
  denied: { label: 'QC Denied', color: '#DC2626' },
  qc_denied: { label: 'QC Denied', color: '#DC2626' },
  pending: { label: 'Pending', color: '#0284C7' },
  good: { label: 'Good', color: '#15803D' },
  bad: { label: 'Bad', color: '#DC2626' },
  no_show: { label: 'No Show', color: '#1F2937' },
  rescheduled: { label: 'Rescheduled', color: '#EA580C' },
  signed_contract: { label: 'Signed Contract', color: '#15803D' },
};

export function agentStatusStyle(status: string, kind: 'qc' | 'inspector') {
  const key = normalizeLeadStatus(status);
  const displayKey = kind === 'inspector' ? normalizeLeadDisposition(key) || key : key;
  if (styles[displayKey]) return styles[displayKey];
  const label = displayKey === 'manager_approved' ? 'Awaiting Final QC'
    : displayKey.split('_').map(word => word === 'qc' ? 'QC' : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return { label, color: '#374151' };
}

// Agent-only presentation: never changes the stored status or outcome logic.
export function AgentStatusLabel({ status, kind, className = '' }: {
  status: string; kind: 'qc' | 'inspector'; className?: string;
}) {
  const { label, color } = agentStatusStyle(status, kind);
  return <span className={`agent-status-label ${className}`.trim()} style={{ color, fontWeight: 700 }}>{label}</span>;
}
