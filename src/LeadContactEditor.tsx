import { useState } from 'react';
import { supabase } from './supabase';
import { rpcError } from './portalUtils';

export function LeadContactEditor({ appointmentId, token, companyId, representative = false, phone, email, onSaved }: {
  appointmentId: string; token: string; companyId?: string; representative?: boolean;
  phone?: string | null; email?: string | null; onSaved?: (phone: string, email: string) => void;
}) {
  const [draftPhone, setPhone] = useState(phone || '');
  const [draftEmail, setEmail] = useState(email || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('portal_update_lead_contact', {
      p_appointment_id: appointmentId, p_access_token: token, p_company_id: companyId || null,
      p_representative: representative, p_phone: draftPhone, p_email: draftEmail,
    });
    setBusy(false);
    if (error) setMessage(rpcError(error));
    else { setMessage('Contact information saved.'); onSaved?.(draftPhone.trim(), draftEmail.trim()); }
  }
  return <form className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label className="text-xs font-bold">Phone Number<input type="tel" required value={draftPhone} onChange={event => setPhone(event.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 font-normal" /></label>
    <label className="text-xs font-bold">Email<input type="email" value={draftEmail} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 font-normal" /></label>
    <div className="flex items-center gap-2 sm:col-span-2"><button disabled={busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">{busy ? 'Saving…' : 'Save Contact'}</button><span role="status" className="text-xs">{message}</span></div>
  </form>;
}
