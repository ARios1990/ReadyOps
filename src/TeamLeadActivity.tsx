import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { LeadEmailHistory } from "./LeadEmailHistory";
type Row = {
  id: string;
  lead_code: string;
  full_name: string;
  agent_name: string;
  qc_status: string;
  service_needed: string;
  portal_appointments: {
    appointment_date: string;
    start_time: string;
    client_status: string;
    company_visible_at: string | null;
  }[];
};
export function TeamLeadActivity() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("portal_leads")
      .select(
        "id,lead_code,full_name,agent_name,qc_status,service_needed,portal_appointments(appointment_date,start_time,client_status,company_visible_at)",
      )
      .order("created_at", { ascending: false })
      .range(page * 50, page * 50 + 49)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        setError(loadError?.message || "");
        setRows((data || []) as Row[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="font-bold">Team Leads & Appointments</h2>
      <p className="text-xs text-slate-500">
        Database permissions limit these records to agents in your assigned
        team.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th>Lead</th>
              <th>Customer</th>
              <th>Agent</th>
              <th>Service</th>
              <th>Appointment</th>
              <th>QC</th>
              <th>Client Outcome</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ap = row.portal_appointments[0];
              return (
                <tr key={row.id} className="border-b">
                  <td className="py-3">{row.lead_code}</td>
                  <td>{row.full_name}</td>
                  <td>{row.agent_name}</td>
                  <td>{row.service_needed}</td>
                  <td>
                    {ap ? `${ap.appointment_date} ${ap.start_time}` : "—"}
                  </td>
                  <td>{row.qc_status}</td>
                  <td>{ap?.client_status || "—"}</td>
                  <td>
                    <button
                      onClick={() =>
                        setSelected((current) =>
                          current === row.id ? "" : row.id,
                        )
                      }
                      className="rounded border px-2 py-1"
                    >
                      Email History
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {loading && <p>Loading team leads…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-slate-500">No team leads on this page.</p>
      )}
      <div className="flex gap-2">
        <button
          disabled={page === 0 || loading}
          onClick={() => setPage((p) => p - 1)}
          className="rounded border px-3 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          disabled={rows.length < 50 || loading}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
      {selected && <LeadEmailHistory leadId={selected} />}
    </section>
  );
}
