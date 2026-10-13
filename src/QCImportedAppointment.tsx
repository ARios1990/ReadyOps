import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ImportDraft } from './recordingImport';
const BookingForm = lazy(() => import('./AgentBookingPortal').then(module => ({ default: module.AgentBookingPortal })));

type Company = { id: string; name: string; public_slug?: string };
type Agent = { id: string; name: string };
export function QCImportedAppointment({ draft, filename, companies, agents, initialCompanyId, initialAgentId, onBooked, onClose }: {
  draft: ImportDraft; filename: string; companies: Company[]; agents: Agent[];
  initialCompanyId: string; initialAgentId: string; onBooked: () => void; onClose: () => void;
}) {
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [agentId, setAgentId] = useState(initialAgentId);
  const [started, setStarted] = useState(false);
  const company = companies.find(item => item.id === companyId);
  const agent = agents.find(item => item.id === agentId);
  return createPortal(<div role="dialog" aria-modal="true" aria-labelledby="qc-new-appointment-title" className="fixed inset-0 z-[130] overflow-y-auto bg-slate-950/55 p-3 sm:p-6">
    <section className="mx-auto max-w-6xl rounded-2xl bg-white shadow-2xl">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-2xl border-b bg-white px-5 py-4"><div><h2 id="qc-new-appointment-title" className="font-bold">Create new appointment</h2><p className="break-all text-xs text-slate-500">{filename}</p></div><button onClick={onClose} aria-label="Close new appointment" className="rounded-lg p-2"><X size={18} /></button></header>
      {!started ? <div className="space-y-4 p-5"><p className="text-sm text-slate-600">Choose the company and agent, then review the imported details and select an available appointment time. Confirmation creates a new lead in Pending QC.</p><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Company<select aria-label="New appointment company" value={companyId} onChange={event => setCompanyId(event.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2.5"><option value="">Select company</option>{companies.map(item => <option key={item.id} value={item.id} disabled={!item.public_slug}>{item.name}{!item.public_slug ? ' — booking unavailable' : ''}</option>)}</select></label><label className="text-sm font-semibold">Agent<select aria-label="New appointment agent" value={agentId} onChange={event => setAgentId(event.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2.5"><option value="">Select agent</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><button disabled={!company?.public_slug || !agent} onClick={() => setStarted(true)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Open appointment form</button></div> : company?.public_slug && agent && <Suspense fallback={<p className="p-5">Loading appointment form…</p>}><BookingForm slug={company.public_slug} importedDraft={draft} bookingAgentName={agent.name} onBooked={onBooked} /></Suspense>}
    </section>
  </div>, document.body);
}
