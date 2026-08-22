import { FormEvent, useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { shouldShowField, getPortalSessionId } from './portalUtils';
import { supabase } from './supabase';

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
  recordingUploadSlug?: string;
  onChange: (key: string, value: unknown) => void;
  onSubmit: () => void;
}

export function DynamicLeadForm({ schema, values, disabled = false, submitLabel = 'Confirm Appointment', recordingUploadSlug, onChange, onSubmit }: Props) {
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
              <Field key={field.key} field={field} value={values[field.key] ?? field.defaultValue ?? ''} disabled={disabled} recordingUploadSlug={recordingUploadSlug} onChange={onChange} />
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

function Field({ field, value, disabled, recordingUploadSlug, onChange }: { field: PortalFormField; value: unknown; disabled: boolean; recordingUploadSlug?: string; onChange: (key: string, value: unknown) => void }) {
  const common = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';
  const label = <label className="mb-1.5 block text-xs font-semibold text-slate-600">{field.label}{field.required ? ' *' : ''}</label>;
  const isWide = field.type === 'textarea' || field.type === 'address' || field.type === 'multiselect' || field.type === 'recording';

  if (field.type === 'recording') {
    return <RecordingField field={field} value={value} disabled={disabled} recordingUploadSlug={recordingUploadSlug} onChange={onChange} />;
  }

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

function RecordingField({ field, value, disabled, recordingUploadSlug, onChange }: { field: PortalFormField; value: unknown; disabled: boolean; recordingUploadSlug?: string; onChange: (key: string, value: unknown) => void }) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const attached = typeof value === 'string' && value.trim().length > 0;

  async function uploadRecording(file: File) {
    setUploading(true);
    setStatus('Authorizing upload...');
    setError('');
    try {
      const sessionId = getPortalSessionId();
      const parts = window.location.pathname.split('/').filter(Boolean);
      const slug = recordingUploadSlug || (parts[0] === 'book' ? decodeURIComponent(parts[1] || '') : '');
      if (!slug) throw new Error('Company form link is missing its company slug.');

      const { data, error: tokenError } = await supabase.functions.invoke('agent-recording-upload-token', {
        body: { session_id: sessionId, slug, filename: file.name || 'recording.mp3' },
      });
      if (tokenError || data?.error) throw new Error(data?.error || tokenError?.message || 'Unable to authorize upload.');
      if (!data?.path || !data?.token || !data?.recording_url) throw new Error('Upload authorization was incomplete.');

      setStatus('Uploading recording...');
      const { error: uploadError } = await supabase.storage.from('qc-recordings').uploadToSignedUrl(data.path, data.token, file, {
        contentType: file.type || 'application/octet-stream',
      });
      if (uploadError) throw uploadError;

      onChange(field.key, data.recording_url);
      setStatus('Recording attached. It will be sent to QC with this appointment.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload recording.');
      setStatus('');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="sm:col-span-2">
      <label className="mb-1.5 block text-xs font-semibold text-slate-600">{field.label}{field.required ? ' *' : ''}</label>
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
        <p className="text-xs text-slate-600">Upload the ReadyMode appointment recording before submitting. The audio goes to QC only and is not shared with the company unless QC approves sharing.</p>
        <label className={`mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${disabled || uploading ? 'cursor-not-allowed bg-slate-200 text-slate-500' : 'cursor-pointer bg-blue-600 text-white hover:bg-blue-700'}`}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          {uploading ? 'Uploading...' : attached ? 'Replace Recording' : 'Upload Recording'}
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
            disabled={disabled || uploading}
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void uploadRecording(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
        {attached && <span className="ml-2 text-xs font-bold text-emerald-700">Recording attached ✓</span>}
        {status && <p className="mt-2 text-xs font-semibold text-blue-700">{status}</p>}
        {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
      </div>
    </div>
  );
}
