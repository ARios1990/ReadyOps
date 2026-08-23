import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MapPin, Navigation, Phone, RefreshCw } from 'lucide-react';
import { supabase } from './supabase';
import { addDays, formatDateLong, formatTime, localDate, rpcError, startOfWeek } from './portalUtils';

interface RepLead { full_name: string; phone_number: string; address: string; city: string | null; state: string | null; zip_code: string | null; email: string | null; language: string | null; notes: string | null; form_data: Record<string, unknown>; }
interface RepAppointment { id: string; appointment_date: string; start_time: string; end_time: string; status: string; rep_status: string; attendance_status: string; inspection_status: string; sales_outcome: string; location_label: string | null; lead: RepLead; latest_checkin: { verified?: boolean; distance_m?: number; timing_status?: string; checked_in_at?: string } | null; timeline: Array<{ id: string; action: string; actor_name: string | null; created_at: string }>; }
interface RepPortalData { representative: { id: string; name: string; phone: string | null; email: string | null }; company: { id: string; name: string }; settings: { timezone: string; check_in_radius_m: number; check_in_before_minutes: number; check_in_after_minutes: number }; appointments: RepAppointment[]; }

export function RepresentativePortal({ token }: { token: string }) {
  const [data, setData] = useState<RepPortalData | null>(null);
  const [selected, setSelected] = useState<RepAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const startDate = localDate(addDays(startOfWeek(), -7));
  const endDate = localDate(addDays(startOfWeek(), 21));

  async function load() {
    setLoading(true); setError('');
    const { data: result, error: rpcErr } = await supabase.rpc('get_representative_portal', { p_access_token: token, p_start_date: startDate, p_end_date: endDate });
    if (rpcErr) { setError(rpcError(rpcErr)); setData(null); }
    else setData(result as RepPortalData);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [token]);

  async function action(appointmentId: string, actionName: string) {
    setBusy(true); setError('');
    const { error: rpcErr } = await supabase.rpc('representative_update_appointment', { p_access_token: token, p_appointment_id: appointmentId, p_action: actionName, p_note: null });
    if (rpcErr) setError(rpcError(rpcErr));
    else { setSuccess('Appointment updated.'); window.setTimeout(() => setSuccess(''), 2000); await load(); }
    setBusy(false);
  }

  async function checkIn(appointmentId: string) {
    if (!navigator.geolocation) { setError('Location services are not supported on this device.'); return; }
    setBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(async position => {
      const { data: result, error: rpcErr } = await supabase.rpc('representative_check_in', {
        p_access_token: token,
        p_appointment_id: appointmentId,
        p_latitude: position.coords.latitude,
        p_longitude: position.coords.longitude,
        p_accuracy_m: position.coords.accuracy,
        p_note: null,
      });
      if (rpcErr) setError(rpcError(rpcErr));
      else {
        const checkin = result as { verified: boolean; distance_m: number | null; timing_status: string };
        setSuccess(checkin.verified ? `GPS verified${checkin.distance_m != null ? ` • ${Math.round(checkin.distance_m)} m from property` : ''}.` : `Check-in recorded as unverified (${checkin.timing_status.replace(/_/g, ' ')}).`);
        window.setTimeout(() => setSuccess(''), 4000);
        await load();
      }
      setBusy(false);
    }, geoError => { setError(`Unable to get location: ${geoError.message}`); setBusy(false); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  if (loading && !data) return <State icon={<Loader2 className="animate-spin" />} title="Loading representative portal..." />;
  if (!data) return <State icon={<AlertTriangle />} title="Representative link unavailable" detail={error || 'This link may be invalid or disabled.'} />;

  const today = localDate(new Date());
  const sorted = [...data.appointments].sort((a, b) => `${a.appointment_date} ${a.start_time}`.localeCompare(`${b.appointment_date} ${b.start_time}`));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Representative Portal</p><h1 className="text-xl font-bold">{data.representative.name}</h1><p className="text-xs text-slate-500">{data.company.name}</p></div><button onClick={() => void load()} className="rounded-lg border border-slate-200 p-2 text-slate-600"><RefreshCw size={16} /></button></div></header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"><CheckCircle2 size={16} />{success}</div>}
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><strong>GPS check-in:</strong> verification radius {data.settings.check_in_radius_m} m. Location is requested only when you press Check In.</div>

        {sorted.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">No assigned appointments in this date window.</div> : sorted.map(appt => (
          <article key={appt.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${appt.appointment_date === today ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <button onClick={() => setSelected(appt)} className="text-left"><p className="text-xs font-bold text-blue-600">{formatDateLong(appt.appointment_date)} • {formatTime(appt.start_time)}</p><h2 className="mt-1 text-lg font-bold">{appt.lead.full_name}</h2><p className="text-sm text-slate-600">{appt.lead.address}{appt.lead.city ? `, ${appt.lead.city}` : ''}</p><div className="mt-2 flex flex-wrap gap-2 text-[11px]"><Badge text={appt.rep_status} /><Badge text={appt.attendance_status} good={appt.attendance_status === 'verified_show'} /><Badge text={appt.sales_outcome} good={appt.sales_outcome === 'signed_contract'} /></div></button>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-xl"><a href={`tel:${appt.lead.phone_number}`} className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"><Phone size={13} /> Call</a><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appt.lead.address)}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"><MapPin size={13} /> Map</a><button disabled={busy} onClick={() => void action(appt.id, 'en_route')} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white"><Navigation size={13} className="inline mr-1" /> En Route</button><button disabled={busy} onClick={() => void checkIn(appt.id)} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">Check In</button><button disabled={busy} onClick={() => void action(appt.id, 'inspection_started')} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Start Inspection</button><button disabled={busy} onClick={() => void action(appt.id, 'inspection_completed')} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Complete</button><button disabled={busy} onClick={() => void action(appt.id, 'homeowner_no_show')} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">No Show</button><button disabled={busy} onClick={() => void action(appt.id, 'signed_contract')} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Signed Contract</button></div>
            </div>
          </article>
        ))}
      </main>

      {selected && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4" onClick={() => setSelected(null)}><div className="mx-auto my-8 max-w-3xl rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-xs font-bold text-blue-600">Lead Details</p><h2 className="text-xl font-bold">{selected.lead.full_name}</h2></div><button onClick={() => setSelected(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">Close</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Detail label="Phone" value={selected.lead.phone_number} /><Detail label="Address" value={[selected.lead.address, selected.lead.city, selected.lead.state, selected.lead.zip_code].filter(Boolean).join(', ')} /><Detail label="Email" value={selected.lead.email} /><Detail label="Language" value={selected.lead.language} /></div><h3 className="mt-6 mb-2 font-bold">Lead Template</h3><div className="grid gap-2 sm:grid-cols-2">{Object.entries(selected.lead.form_data || {}).map(([key, value]) => <Detail key={key} label={key.replace(/_/g, ' ')} value={Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)} />)}</div>{selected.lead.notes && <div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Notes</p><p className="mt-1 whitespace-pre-line text-sm">{selected.lead.notes}</p></div>}</div></div>}
    </div>
  );
}

function Badge({ text, good = false }: { text: string; good?: boolean }) { return <span className={`rounded-full px-2 py-1 font-bold uppercase ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{text.replace(/_/g, ' ')}</span>; }
function Detail({ label, value }: { label: string; value: unknown }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-medium">{value == null || value === '' ? '—' : String(value)}</p></div>; }
function State({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string }) { return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">{icon}</div><h1 className="font-bold">{title}</h1>{detail && <p className="mt-2 text-sm text-slate-500">{detail}</p>}</div></div>; }
