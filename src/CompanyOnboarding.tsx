import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "./supabase";
import { rpcError } from "./portalUtils";

// The public onboarding RPC accepts company details only. Package pricing and
// payments are intentionally managed from the authenticated ReadyOps admin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
export function CompanyOnboarding({
  slug,
  token,
}: {
  slug: string;
  token: string;
}) {
  const [invite, setInvite] = useState<Obj | null>(null);
  const [form, setForm] = useState<Obj>({
    name: "",
    state: "",
    contact_name: "",
    phone: "",
    email: "",
    website: "",
    location: "",
    requirements: "",
  });
  const [result, setResult] = useState<Obj | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase.rpc(
        "get_company_onboarding_invite",
        { p_invite_slug: slug, p_invite_token: token },
      );
      if (e) setError(rpcError(e));
      else {
        setInvite(data as Obj);
        setForm((p) => ({
          ...p,
          name: (data as Obj)?.company_name_hint || "",
        }));
      }
      setLoading(false);
    })();
  }, [slug, token]);
  function set(key: string, value: string) {
    setForm((p: Obj) => ({ ...p, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.rpc(
      "submit_company_onboarding",
      { p_invite_slug: slug, p_invite_token: token, p_payload: form },
    );
    if (err) setError(rpcError(err));
    else setResult(data as Obj);
    setBusy(false);
  }
  if (loading)
    return (
      <Page>
        <Loader2 className="animate-spin text-blue-600" />
      </Page>
    );
  if (error && !invite)
    return (
      <Page>
        <p className="font-bold text-red-700">{error}</p>
      </Page>
    );
  if (result)
    return (
      <Page>
        <CheckCircle2 className="mx-auto text-emerald-600" size={42} />
        <h1 className="mt-3 text-2xl font-bold">Welcome to Ready Ops</h1>
        <p className="mt-2 text-sm text-slate-600">
          {result.company_name} has been added. Your Ready Ops administrator
          will finish any custom scheduling and qualification settings.
        </p>
      </Page>
    );
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <form
        onSubmit={submit}
        className="mx-auto max-w-3xl rounded-2xl border bg-white p-5 shadow-sm sm:p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-blue-600 p-3 text-white">
            <Building2 />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600">
              Ready Ops
            </p>
            <h1 className="text-2xl font-bold">Company Setup</h1>
            <p className="text-sm text-slate-500">
              Complete your company information. ReadyOps will configure your lead package.
            </p>
          </div>
        </div>
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company Name"
            value={form.name}
            onChange={(v) => set("name", v)}
            required
          />
          <Field
            label="State"
            value={form.state}
            onChange={(v) => set("state", v)}
          />
          <Field
            label="Contact Name"
            value={form.contact_name}
            onChange={(v) => set("contact_name", v)}
          />
          <Field
            label="Phone"
            value={form.phone}
            onChange={(v) => set("phone", v)}
          />
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(v) => set("email", v)}
          />
          <Field
            label="Website"
            value={form.website}
            onChange={(v) => set("website", v)}
          />
          <Field
            label="Primary Service Area"
            value={form.location}
            onChange={(v) => set("location", v)}
          />
          <div />
          <label className="sm:col-span-2 text-xs font-bold text-slate-500">
            Requirements
            <textarea
              value={form.requirements}
              onChange={(e) => set("requirements", e.target.value)}
              className="mt-1 min-h-24 w-full rounded-xl border p-3 text-sm"
              placeholder="Roof age, home type, language, square footage, scheduling rules..."
            />
          </label>
        </div>
        <button
          disabled={busy}
          className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50"
        >
          {busy ? "Creating Company..." : "Submit Company Setup"}
        </button>
      </form>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs font-bold text-slate-500">
      {label}
      <input
        required={required}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border p-3 text-sm text-slate-800"
      />
    </label>
  );
}
function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
        {children}
      </div>
    </div>
  );
}
