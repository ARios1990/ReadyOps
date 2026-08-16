import { FormEvent } from 'react';
import { shouldShowField } from './portalUtils';

export interface PortalFormField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  defaultValue?: unknown;
  showWhen?: { field?: string; equals?: unknown };
}

export interface PortalFormSection {
  id: string;
  title: string;
  fields: PortalFormField[];
}

interface Props {
  schema: PortalFormSection[];
  values: Record<string, unknown>;
  disabled?: boolean;
  submitLabel?: string;
  onChange: (key: string, value: unknown) => void;
  onSubmit: () => void;
}

export function DynamicLeadForm({ schema, values, disabled = false, submitLabel = 'Confirm Appointment', onChange, onSubmit }: Props) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {schema.map(section => (
        <section key={section.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 mb-4">{section.title}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.fields.filter(field => shouldShowField(field.showWhen, values)).map(field => (
              <Field key={field.key} field={field} value={values[field.key] ?? field.defaultValue ?? ''} disabled={disabled} onChange={onChange} />
            ))}
          </div>
        </section>
      ))}
      <button
        type="submit"
        disabled={disabled}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}

function Field({ field, value, disabled, onChange }: { field: PortalFormField; value: unknown; disabled: boolean; onChange: (key: string, value: unknown) => void }) {
  const common = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';
  const label = <label className="mb-1.5 block text-xs font-semibold text-slate-600">{field.label}{field.required ? ' *' : ''}</label>;
  const isWide = field.type === 'textarea' || field.type === 'address' || field.type === 'multiselect';

  if (field.type === 'textarea') {
    return <div className={isWide ? 'sm:col-span-2' : ''}>{label}<textarea required={field.required} disabled={disabled} className={`${common} min-h-24`} value={String(value ?? '')} onChange={e => onChange(field.key, e.target.value)} /></div>;
  }

  if (field.type === 'select') {
    return <div>{label}<select required={field.required} disabled={disabled} className={common} value={String(value ?? '')} onChange={e => onChange(field.key, e.target.value)}><option value="">Select...</option>{(field.options || []).map(option => <option key={option} value={option}>{option}</option>)}</select></div>;
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="sm:col-span-2">
        {label}
        <div className="grid gap-2 sm:grid-cols-2 rounded-xl border border-slate-200 p-3">
          {(field.options || []).map(option => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" disabled={disabled} checked={selected.includes(option)} onChange={e => onChange(field.key, e.target.checked ? [...selected, option] : selected.filter(item => item !== option))} />
              {option}
            </label>
          ))}
        </div>
      </div>
    );
  }

  const inputType = field.type === 'phone' ? 'tel'
    : field.type === 'email' ? 'email'
      : field.type === 'url' ? 'url'
        : field.type === 'number' || field.type === 'currency' ? 'number'
          : field.type === 'date' ? 'date'
            : field.type === 'time' ? 'time'
              : 'text';

  return (
    <div className={isWide ? 'sm:col-span-2' : ''}>
      {label}
      <input required={field.required} disabled={disabled} type={inputType} step={field.type === 'currency' ? '0.01' : undefined} className={common} value={String(value ?? '')} onChange={e => onChange(field.key, e.target.value)} />
    </div>
  );
}
