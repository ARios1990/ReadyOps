import { useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Loader2, Maximize2, RefreshCw, Save } from "lucide-react";
import { ClientLeadTemplate } from "./ClientLeadTemplate";
import { COMPANY_PORTAL_DISPOSITIONS, LeadStatusBadge } from "./LeadStatusControls";
import { leadStatusLabel, normalizeLeadDisposition } from "./leadStatusPresentation";
import { formatLeadAddress, formatTime } from "./portalUtils";
import type { Appointment, Representative } from "./CompanyPortal";

/** Accordion section with a title row and a round chevron toggle. */
export function CollapsibleSection({
  title,
  aside,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-200">
      <div className="flex items-center gap-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="group flex flex-1 items-center justify-between gap-3 text-left"
        >
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <span className="flex items-center gap-3">
            {aside}
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition group-hover:border-blue-400 group-hover:text-blue-600 ${open ? "rotate-180" : ""}`}
            >
              <ChevronDown size={14} />
            </span>
          </span>
        </button>
      </div>
      {open && <div className="pb-4">{children}</div>}
    </section>
  );
}

function currentStatusOf(appointment: Appointment): string {
  return (
    appointment.company_action ||
    appointment.canonical_status ||
    appointment.client_status ||
    appointment.status
  );
}

function serviceLabel(appointment: Appointment): string {
  const form = appointment.lead.form_data || {};
  const service = appointment.lead.service_needed || form.service_type;
  return typeof service === "string" && service.trim() ? service : "Service not listed";
}

/** Appointment list for a single day with a lead detail and update panel. */
export function CompanyDailyAppointments({
  appointments,
  representatives,
  busy,
  openLead,
  assignRep,
  updateAppointmentStatus,
  updateLeadOutcome,
  confirmLeadReceipt,
}: {
  appointments: Appointment[];
  representatives: Representative[];
  busy: boolean;
  openLead: (appointment: Appointment) => void;
  assignRep: (appointmentId: string, repId: string) => Promise<void>;
  updateAppointmentStatus: (appointmentId: string, status: string) => Promise<void>;
  updateLeadOutcome: (appointment: Appointment, clientStatus: string, notes?: string) => Promise<void>;
  confirmLeadReceipt: (appointment: Appointment) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    appointments.find((appointment) => appointment.id === selectedId) || appointments[0] || null;

  if (!appointments.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-10 text-center text-sm text-slate-500">
        No appointments match this day and filters.
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h3 className="text-lg font-bold text-slate-900">Appointments</h3>
          <span className="text-xs text-slate-500">Full address · Service · Start time</span>
        </div>
        <ul className="space-y-2">
          {appointments.map((appointment) => {
            const active = appointment.id === selected?.id;
            return (
              <li key={appointment.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(appointment.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"}`}
                >
                  <p className="text-xs font-semibold text-blue-600">{formatTime(appointment.start_time)}</p>
                  <p className="mt-0.5 font-bold text-slate-900">{appointment.lead.full_name}</p>
                  <p className="mt-1 text-sm text-slate-700">{formatLeadAddress(appointment.lead)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {serviceLabel(appointment)} · {appointment.representative_name || "Unassigned"}
                  </p>
                  <LeadStatusBadge value={currentStatusOf(appointment)} audience="client" className="mt-2" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {selected && (
        <AppointmentDetailPanel
          key={selected.id}
          appointment={selected}
          representatives={representatives}
          busy={busy}
          openLead={openLead}
          assignRep={assignRep}
          updateAppointmentStatus={updateAppointmentStatus}
          updateLeadOutcome={updateLeadOutcome}
          confirmLeadReceipt={confirmLeadReceipt}
        />
      )}
    </div>
  );
}

function AppointmentDetailPanel({
  appointment,
  representatives,
  busy,
  openLead,
  assignRep,
  updateAppointmentStatus,
  updateLeadOutcome,
  confirmLeadReceipt,
}: {
  appointment: Appointment;
  representatives: Representative[];
  busy: boolean;
  openLead: (appointment: Appointment) => void;
  assignRep: (appointmentId: string, repId: string) => Promise<void>;
  updateAppointmentStatus: (appointmentId: string, status: string) => Promise<void>;
  updateLeadOutcome: (appointment: Appointment, clientStatus: string, notes?: string) => Promise<void>;
  confirmLeadReceipt: (appointment: Appointment) => Promise<void>;
}) {
  const status = currentStatusOf(appointment);
  const [outcome, setOutcome] = useState<string>(normalizeLeadDisposition(status) || "pending");
  const [notes, setNotes] = useState(appointment.inspector_notes || "");
  const received = Boolean(appointment.client_received);
  const fieldClass =
    "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:opacity-60";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-bold text-slate-900">{appointment.lead.full_name}</h3>
          <p className="mt-1 text-xs text-slate-500">Complete lead template · Answered fields only</p>
        </div>
        <LeadStatusBadge value={status} audience="client" />
      </div>
      <p className="mt-1 text-sm">
        <span className="font-bold text-slate-900">Type of Service:</span>
        <span className="ml-6 text-slate-700">{serviceLabel(appointment)}</span>
      </p>

      <div className="mt-2">
        <ClientLeadTemplate
          lead={appointment.lead}
          appointment={appointment}
          showLabel={false}
          showCopySection={false}
          collapsibleSections
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-slate-500">
          Inspector
          <select
            aria-label={`Assign inspector for ${appointment.lead.full_name}`}
            value={appointment.representative_id || ""}
            disabled={busy}
            onChange={(event) => void assignRep(appointment.id, event.target.value)}
            className={fieldClass}
          >
            <option value="">Unassigned</option>
            {representatives
              .filter((rep) => rep.active || rep.id === appointment.representative_id)
              .map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name}
                  {rep.active ? "" : " (Inactive)"}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          Appointment status
          <select
            value={appointment.status}
            disabled={busy}
            onChange={(event) => void updateAppointmentStatus(appointment.id, event.target.value)}
            className={fieldClass}
          >
            <option value="confirmed">Confirmed</option>
            <option value="assigned">Assigned</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {received ? (
          <span className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-xs font-bold text-emerald-700">
            <CheckCircle2 size={14} /> Lead received
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmLeadReceipt(appointment)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
          >
            <CheckCircle2 size={14} /> Confirm lead received
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOutcome("rescheduled");
            void updateLeadOutcome(appointment, "rescheduled", notes);
          }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
        >
          <RefreshCw size={14} /> Reschedule
        </button>
      </div>

      <label className="mt-3 block text-xs text-slate-500">
        Lead outcome
        <select
          value={outcome}
          disabled={busy}
          onChange={(event) => setOutcome(event.target.value)}
          className={fieldClass}
        >
          {COMPANY_PORTAL_DISPOSITIONS.map((value) => (
            <option key={value} value={value}>
              {leadStatusLabel(value, "client")}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 border-t border-slate-200 pt-3">
        <h4 className="text-base font-bold text-slate-900">Inspector Notes of the Inspection</h4>
        <label className="mt-2 block text-xs text-slate-500">
          Inspection findings
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add inspection findings, damage observed, and follow-up recommendations..."
            className="mt-1 min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void updateLeadOutcome(appointment, outcome, notes)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Update
        </button>
        <button
          type="button"
          onClick={() => openLead(appointment)}
          className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
        >
          <Maximize2 size={12} /> Recording, weather & full view
        </button>
      </div>
    </section>
  );
}
