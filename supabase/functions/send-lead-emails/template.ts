type Snapshot = Record<string, unknown>;
const text = (value: unknown) =>
  Array.isArray(value) ? value.join(", ") : String(value ?? "").trim() || "—";
export const escapeHtml = (value: unknown) =>
  text(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function renderLeadEmail(snapshot: Snapshot) {
  const rows: [string, unknown][] = [
    ["Customer", snapshot.customer_name],
    ["Phone", snapshot.phone_number],
    ["Address", snapshot.address],
    [
      "Appointment",
      `${text(snapshot.appointment_date)} at ${text(snapshot.appointment_time)} (${text(snapshot.timezone)})`,
    ],
    ["Service Requested", snapshot.service_requested],
    ["Agent", snapshot.agent],
    ["Notes", snapshot.notes],
  ];
  const service = snapshot.service_template as
    | {
        template_title?: string;
        form_schema?: {
          title: string;
          fields: {
            key: string;
            label: string;
            type: string;
            mode?: string;
            showWhen?: { field?: string; equals?: unknown };
          }[];
        }[];
      }
    | undefined;
  const data = (snapshot.form_data || {}) as Snapshot;
  const core = new Set([
    "full_name",
    "phone_number",
    "address",
    "city",
    "state",
    "zip_code",
    "service_needed",
    "notes",
    "recording_url",
  ]);
  const details =
    service?.form_schema?.flatMap((section) =>
      section.fields
        .filter(
          (f) =>
            f.mode !== "hidden" &&
            f.type !== "recording" &&
            !core.has(f.key) &&
            (!f.showWhen?.field ||
              data[f.showWhen.field] === f.showWhen.equals),
        )
        .map((f) => [f.label, data[f.key]] as [string, unknown]),
    ) || [];
  const allRows = rows.concat(details);
  const subject =
    `ReadyOps: ${text(snapshot.lead_code)} — ${text(snapshot.service_requested)} appointment`
      .replace(/[\r\n]/g, " ")
      .slice(0, 200);
  const plain = [
    `Masters Ready Services / ReadyOps`,
    `New lead for ${text(snapshot.company_name)}`,
    `Lead: ${text(snapshot.lead_code)}`,
    ...allRows.map(([label, value]) => `${label}: ${text(value)}`),
    "",
    "This lead was QC-approved and sent to your company. Please review the appointment in your ReadyOps client portal.",
    "Masters Ready Services • ReadyOps Client Operations",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#10243a"><div style="max-width:640px;margin:24px auto;background:white;border:1px solid #dbe4ef;border-radius:12px;overflow:hidden"><div style="background:#071b30;padding:28px;color:white"><div style="font-size:26px;font-weight:bold">ReadyOps</div><div style="font-size:13px;margin-top:6px;color:#bfdbfe">Masters Ready Services</div></div><div style="padding:28px"><h1 style="font-size:22px;margin:0 0 8px">New Client Lead</h1><p style="color:#52677d">${escapeHtml(snapshot.company_name)} • Lead ${escapeHtml(snapshot.lead_code)}</p><h2 style="font-size:16px;color:#2563eb">${escapeHtml(service?.template_title || snapshot.service_requested)}</h2><table style="width:100%;border-collapse:collapse">${allRows.map(([label, value]) => `<tr><th style="width:35%;padding:12px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:left;font-size:13px">${escapeHtml(label)}</th><td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;font-size:14px;white-space:pre-wrap;word-break:break-word">${escapeHtml(value)}</td></tr>`).join("")}</table><p style="font-size:13px;line-height:1.6;color:#52677d">This lead was QC-approved and sent to your company. Please review the appointment in your ReadyOps client portal.</p></div><div style="background:#f8fafc;padding:20px;text-align:center;font-size:12px;color:#64748b">Masters Ready Services / ReadyOps<br>Client Operations &amp; Appointment Coordination</div></div></body></html>`;
  return { subject, text: plain, html };
}
