import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  DEFAULT_SERVICE_TEMPLATES,
  type ServiceTemplate,
  type QualificationRule,
} from "./serviceTemplates";
import type { PortalFormField } from "./DynamicLeadForm";

type Company = { id: string; name: string };
export function AdminServiceTemplates() {
  const [services, setServices] = useState<ServiceTemplate[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState("");
  const [serviceId, setServiceId] = useState("roofing");
  const [draft, setDraft] = useState<ServiceTemplate | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newId, setNewId] = useState("");
  async function load() {
    setBusy(true);
    setMessage("");
    const [s, c] = await Promise.all([
      supabase.from("lead_service_templates").select("*").order("name"),
      supabase.from("roster_companies").select("id,name").order("name"),
    ]);
    if (s.error || c.error) setMessage((s.error || c.error)!.message);
    else {
      setServices(s.data as ServiceTemplate[]);
      setCompanies(c.data || []);
    }
    setBusy(false);
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const base = services.find((s) => s.id === serviceId);
    setDraft(null);
    if (!base) return;
    if (!scope) {
      setDraft(structuredClone(base));
      return;
    }
    setBusy(true);
    supabase
      .from("company_service_templates")
      .select("*")
      .eq("company_id", scope)
      .eq("service_id", serviceId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setMessage(error.message);
        else
          setDraft(
            structuredClone(
              data
                ? {
                    ...base,
                    form_schema: data.form_schema,
                    qualification_rules: data.qualification_rules,
                    template_title: data.template_title,
                    enabled: data.enabled,
                  }
                : { ...base, enabled: true },
            ),
          );
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, serviceId, services]);
  function changeField(
    sectionId: string,
    key: string,
    patch: Partial<PortalFormField>,
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      form_schema: draft.form_schema.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              fields: section.fields.map((f) =>
                f.key === key ? { ...f, ...patch } : f,
              ),
            }
          : section,
      ),
    });
  }
  function changeRule(key: string, answer: string) {
    if (!draft) return;
    const rules = (draft.qualification_rules.fields || []).filter(
      (r) => r.key !== key,
    );
    if (answer.trim())
      rules.push({
        key,
        operator: "equals",
        value: answer.trim(),
      } as QualificationRule);
    setDraft({
      ...draft,
      qualification_rules: { ...draft.qualification_rules, fields: rules },
    });
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage("");
    const common = {
      form_schema: draft.form_schema,
      qualification_rules: draft.qualification_rules,
      template_title: draft.template_title,
    };
    const { error } = scope
      ? await supabase
          .from("company_service_templates")
          .upsert({
            ...common,
            company_id: scope,
            service_id: draft.id,
            enabled: draft.enabled !== false,
          })
      : await supabase
          .from("lead_service_templates")
          .update({ ...common, name: draft.name, active: draft.active })
          .eq("id", draft.id);
    setBusy(false);
    setMessage(
      error
        ? error.message
        : "Template saved. New leads use this configuration; existing lead snapshots stay unchanged.",
    );
    if (!error && !scope)
      setServices((current) =>
        current.map((s) => (s.id === draft.id ? draft : s)),
      );
  }
  async function addService() {
    const id = newId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,59}$/.test(id) || !newName.trim()) {
      setMessage(
        "Enter a unique service key (lowercase letters, numbers, underscores) and name.",
      );
      return;
    }
    setBusy(true);
    const base = structuredClone(
      DEFAULT_SERVICE_TEMPLATES.find((s) => s.id === "home_improvement")!,
    );
    const { error } = await supabase
      .from("lead_service_templates")
      .insert({
        ...base,
        id,
        name: newName.trim(),
        template_title: `${newName.trim()} Appointment`,
      });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    setNewId("");
    setNewName("");
    setScope("");
    setServiceId(id);
    await load();
  }
  const input = "rounded-lg border border-slate-300 bg-white p-2 text-sm";
  return (
    <section className="space-y-4">
      <div className="readyops-ref-page-header">
        <h2>Universal Lead Templates & Qualifiers</h2>
        <button
          disabled={busy || !draft}
          onClick={() => void save()}
          className="readyops-ref-primary"
        >
          {busy ? "Working…" : "Save Template"}
        </button>
      </div>
      {message && (
        <p role="status" className="rounded-lg border bg-white p-3 text-sm">
          {message}
        </p>
      )}
      <div className="readyops-ref-card flex flex-wrap gap-4 p-4">
        <label className="text-sm font-bold">
          Configuration scope
          <select
            aria-label="Template scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className={`ml-2 ${input}`}
          >
            <option value="">Global service defaults</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-bold">
          Service
          <select
            aria-label="Template service"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className={`ml-2 ${input}`}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {draft && (
        <div className="readyops-ref-card space-y-4 p-4">
          <div className="flex flex-wrap gap-4">
            <label>
              Template title
              <input
                value={draft.template_title}
                onChange={(e) =>
                  setDraft({ ...draft, template_title: e.target.value })
                }
                className={`ml-2 ${input}`}
              />
            </label>
            {!scope && (
              <label>
                Service name
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={`ml-2 ${input}`}
                />
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={scope ? draft.enabled !== false : draft.active}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    ...(scope
                      ? { enabled: e.target.checked }
                      : { active: e.target.checked }),
                  })
                }
              />
              {scope ? "Enabled for this company" : "Active service"}
            </label>
          </div>
          <p className="text-xs text-slate-600">
            Company saves override this service only. Leave “Qualifying answer”
            blank for collection only. A configured answer must match to
            qualify; hidden fields are not evaluated. Customer name, phone,
            address and requested service stay required.
          </p>
          {draft.form_schema.map((section) => (
            <section
              key={section.id}
              className="space-y-2 rounded-xl border p-3"
            >
              <h3 className="font-bold">{section.title}</h3>
              {section.fields.map((f) => (
                <div
                  key={f.key}
                  className="grid items-center gap-2 sm:grid-cols-5"
                >
                  <div>
                    <span className="block font-mono text-xs">{f.key}</span>
                    <input
                      aria-label={`${f.key} label`}
                      value={f.label}
                      onChange={(e) =>
                        changeField(section.id, f.key, {
                          label: e.target.value,
                        })
                      }
                      className={`w-full ${input}`}
                    />
                  </div>
                  <select
                    aria-label={`${f.key} type`}
                    value={f.type}
                    onChange={(e) =>
                      changeField(section.id, f.key, { type: e.target.value })
                    }
                    className={input}
                  >
                    {[
                      "text",
                      "textarea",
                      "select",
                      "multiselect",
                      "number",
                      "currency",
                      "phone",
                      "email",
                      "address",
                      "date",
                      "time",
                      "url",
                      "recording",
                    ].map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                  <select
                    aria-label={`${f.key} visibility`}
                    disabled={[
                      "full_name",
                      "phone_number",
                      "address",
                      "service_needed",
                    ].includes(f.key)}
                    value={f.mode || (f.required ? "required" : "optional")}
                    onChange={(e) =>
                      changeField(section.id, f.key, {
                        mode: e.target.value as PortalFormField["mode"],
                      })
                    }
                    className={input}
                  >
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                    <option value="hidden">Hidden</option>
                  </select>
                  <input
                    aria-label={`${f.key} options`}
                    placeholder="Options, separated by commas"
                    value={(f.options || []).join(", ")}
                    onChange={(e) =>
                      changeField(section.id, f.key, {
                        options: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className={input}
                  />
                  <input
                    aria-label={`${f.key} qualifying answer`}
                    placeholder="Qualifying answer (optional)"
                    value={String(
                      draft.qualification_rules.fields?.find(
                        (r) => r.key === f.key,
                      )?.value || "",
                    )}
                    onChange={(e) => changeRule(f.key, e.target.value)}
                    className={input}
                  />
                </div>
              ))}
              <button
                onClick={() => {
                  const key = `custom_${Date.now()}`;
                  setDraft({
                    ...draft,
                    form_schema: draft.form_schema.map((s) =>
                      s.id === section.id
                        ? {
                            ...s,
                            fields: [
                              ...s.fields,
                              {
                                key,
                                label: "New Question",
                                type: "text",
                                mode: "optional",
                              },
                            ],
                          }
                        : s,
                    ),
                  });
                }}
                className="rounded-lg border px-3 py-2 text-xs font-bold"
              >
                Add Field / Question
              </button>
            </section>
          ))}
          {scope && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const { error } = await supabase
                  .from("company_service_templates")
                  .delete()
                  .eq("company_id", scope)
                  .eq("service_id", serviceId);
                if (error) setMessage(error.message);
                else {
                  setDraft(
                    structuredClone({
                      ...services.find((s) => s.id === serviceId)!,
                      enabled: true,
                    }),
                  );
                  setMessage(
                    "Company override removed; this service uses global defaults.",
                  );
                }
                setBusy(false);
              }}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              Reset company override to global defaults
            </button>
          )}
        </div>
      )}
      <div className="readyops-ref-card flex flex-wrap items-end gap-3 p-4">
        <h3 className="w-full font-bold">Add a Future Service</h3>
        <input
          aria-label="New service name"
          placeholder="Service name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className={input}
        />
        <input
          aria-label="New service key"
          placeholder="Unique key, e.g. pool_service"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          className={input}
        />
        <button
          disabled={busy}
          onClick={() => void addService()}
          className="readyops-ref-primary"
        >
          Add Service
        </button>
      </div>
    </section>
  );
}
