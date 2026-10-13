import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Eye, EyeOff, FileAudio, Loader2, Sparkles } from 'lucide-react';
import { transcribeWithLocalWhisper } from './localWhisperClient';
import { cell, matchCallLog, normalizePhone, prepareDraft, type CallLogRow, type ImportDraft } from './recordingImport';

type Item = { id: string; file: File; rowIndex: number; status: string; draft?: ImportDraft; error?: string; submitted?: boolean };
type Props = { disabled: boolean; submittedPhone?: string; mode?: 'booking' | 'qc'; onCreate?: (draft: ImportDraft, filename: string) => void; onApply: (draft: ImportDraft, filename: string) => void };

export function RecordingCallLogImport({ disabled, submittedPhone, onApply, onCreate, mode = 'booking' }: Props) {
  const [rows, setRows] = useState<CallLogRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [csvName, setCsvName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState('');
  const [appliedId, setAppliedId] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!submittedPhone || !appliedId) return;
    setItems(current => current.map(item => item.id === appliedId && normalizePhone(String(item.draft?.values.phone_number || '')) === normalizePhone(submittedPhone) ? { ...item, submitted: true, status: 'Submitted to QC' } : item));
  }, [submittedPhone, appliedId]);

  async function loadCsv(file: File) {
    setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Call log must be smaller than 20 MB.');
      const { read, utils } = await import('xlsx');
      const workbook = read(await file.arrayBuffer(), { type: 'array', raw: true });
      const parsed = utils.sheet_to_json<CallLogRow>(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });
      if (!parsed.length || !Object.keys(parsed[0]).some(k => /^(phone|phonenumber)$/i.test(k.replace(/[^a-z]/gi, '')))) throw new Error('Use a ReadyMode call log with a Phone column.');
      setRows(parsed); setCsvName(file.name);
      setItems(current => current.map(item => { const matches = matchCallLog(item.file.name, parsed); return { ...item, rowIndex: matches.length === 1 ? parsed.indexOf(matches[0]) : -1, draft: undefined, status: 'Ready', submitted: false }; }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read call log.'); }
  }

  function addFiles(files: FileList) {
    const selected = Array.from(files);
    if (selected.length > 20) { setError('Prepare up to 20 recordings at a time.'); return; }
    setError(''); setAppliedId('');
    setItems(selected.map(file => { const matches = matchCallLog(file.name, rows); return { id: crypto.randomUUID(), file, rowIndex: matches.length === 1 ? rows.indexOf(matches[0]) : -1, status: matches.length > 1 ? 'Multiple calls match — choose the row' : 'Ready' }; }));
  }
  const update = (id: string, patch: Partial<Item>) => { if (alive.current) setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item)); };

  async function prepareAll() {
    setProcessing(true); setError('');
    try {
      for (const item of items) {
        if (!alive.current) break;
        if (item.rowIndex < 0 || item.submitted || item.draft) continue;
        let transcript = '', failure = '';
        try {
          if (item.file.size > 100 * 1024 * 1024) throw new Error('Recording exceeds 100 MB.');
          update(item.id, { status: 'Preparing recording…', error: '' });
          if (/\.txt$/i.test(item.file.name)) transcript = await item.file.text();
          else {
            const url = URL.createObjectURL(item.file);
            try { transcript = await transcribeWithLocalWhisper(url, language, message => update(item.id, { status: message })); }
            finally { URL.revokeObjectURL(url); }
          }
        } catch (e) { failure = e instanceof Error ? e.message : 'Unable to transcribe recording.'; }
        const draft = prepareDraft(rows[item.rowIndex], transcript);
        if (failure) draft.warnings.unshift('Recording could not be transcribed. These fields come from the call log only.');
        update(item.id, { draft, error: failure, status: transcript ? 'Ready to review' : 'Call log only — review needed' });
      }
    } finally { if (alive.current) setProcessing(false); }
  }
  const readyCount = items.filter(item => item.draft && !item.submitted).length;
  const locked = processing || disabled;
  return <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-950"><Sparkles className="text-indigo-600" size={20} /> Recording + call log</h2><p className="mt-1 text-sm text-slate-600">{mode === 'qc' ? 'Prepare recordings and call logs to fill QC leads or create new appointments.' : 'Upload once. Match calls, prepare forms, and review each appointment.'}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{readyCount} ready to review</span><button type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed} aria-controls="recording-call-log-panel" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">{collapsed ? <Eye size={13} /> : <EyeOff size={13} />}{collapsed ? 'Show' : 'Hide'}{collapsed ? <ChevronDown size={13} className="opacity-60" /> : <ChevronUp size={13} className="opacity-60" />}</button></div></div>
    <div id="recording-call-log-panel" hidden={collapsed}>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="rounded-xl border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-700">1. ReadyMode call log (.csv)<input aria-label="Upload call log CSV" type="file" accept=".csv" disabled={locked} onChange={e => { const f = e.target.files?.[0]; if (f) void loadCsv(f); }} className="mt-3 block w-full text-xs" />{csvName && <span className="mt-2 block text-xs font-normal text-emerald-700">{csvName} · {rows.length} rows</span>}</label>
      <label className="rounded-xl border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-700">2. Call recordings<input aria-label="Upload call recordings" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.txt" multiple disabled={locked} onChange={e => { if (e.target.files) addFiles(e.target.files); }} className="mt-3 block w-full text-xs" /><span className="mt-2 block text-xs font-normal text-slate-500">Up to 20 files. Names containing the phone number match automatically. A .txt transcript also works.</span></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><label className="text-xs font-semibold text-slate-600">Recording language<select aria-label="Recording language" disabled={locked} value={language} onChange={e => { setLanguage(e.target.value); setItems(current => current.map(item => item.submitted ? item : { ...item, draft: undefined, status: 'Ready' })); }} className="ml-2 rounded-lg border p-2"><option value="">Choose English or Spanish</option><option value="en">English only</option><option value="es">Spanish</option></select></label><button type="button" disabled={locked || !language || !rows.length || !items.some(i => i.rowIndex >= 0 && !i.draft && !i.submitted)} onClick={() => void prepareAll()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{processing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {processing ? 'Preparing forms…' : 'Prepare forms automatically'}</button></div>
    <p className="mt-3 text-xs text-slate-500">{mode === 'qc' ? 'Audio is transcribed in your browser. Review imported fields before saving the lead, and use Save Transcript to retain the recording transcript. Existing appointments are not rescheduled.' : 'Audio is transcribed in your browser. The first run downloads a speech model. Recordings are not attached to the booking; reviewed notes and the transcript go to QC when you submit.'}</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 space-y-3">{items.map(item => <article key={item.id} className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 break-all text-sm font-bold"><FileAudio size={16} />{item.file.name}</p><p role="status" className="mt-1 text-xs text-slate-600">{item.status}</p></div>{item.submitted && <CheckCircle2 className="text-emerald-600" size={20} />}</div>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Matched call log row<select aria-label={`Call log row for ${item.file.name}`} disabled={locked || item.submitted} value={item.rowIndex} onChange={e => update(item.id, { rowIndex: Number(e.target.value), draft: undefined, error: '', status: 'Ready' })} className="mt-1 w-full rounded-lg border p-2 text-sm"><option value={-1}>Choose a customer / call</option>{rows.map((row, index) => <option key={index} value={index}>{[cell(row, 'First Name'), cell(row, 'Last Name'), cell(row, 'Phone'), cell(row, 'Recording Start', 'Log Time')].filter(Boolean).join(' · ')}</option>)}</select></label>
      {item.error && <p role="alert" className="mt-2 text-xs text-red-700">{item.error}</p>}
      {item.draft && <><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><p><strong>{String(item.draft.values.full_name || 'Missing name')}</strong><br />{String(item.draft.values.phone_number || '')}</p><p>{String(item.draft.values.address || 'Missing address')}<br />Requested: {item.draft.requestedDate || 'Choose date'} · {item.draft.requestedTime || item.draft.timeRange || 'Choose time'}</p></div>{item.draft.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-7 text-xs text-amber-900">{item.draft.warnings.map(w => <li key={w}>{w}</li>)}</ul>}<details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold text-indigo-700">Recording notes and field sources</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{String(item.draft.values.recording_notes || 'No recording transcript available.')}</pre><p className="mt-2 text-slate-600">{Object.entries(item.draft.sources).map(([key, source]) => `${key.replace(/_/g, ' ')}: ${source}`).join(' · ')}</p></details><button type="button" disabled={locked || item.submitted} onClick={() => { setAppliedId(item.id); onApply(item.draft!, item.file.name); }} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{item.submitted ? 'Submitted to QC' : mode === 'qc' ? 'Find QC lead to fill' : appliedId === item.id ? 'Refill this booking form' : 'Fill booking form'}</button>{mode === 'qc' && onCreate && <button type="button" disabled={locked || item.submitted} onClick={() => { setAppliedId(item.id); onCreate(item.draft!, item.file.name); }} className="ml-2 mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Create new appointment</button>}</>}
    </article>)}</div>
    </div>
  </section>;
}
