import { useEffect, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { CheckCircle2, ClipboardCopy, ExternalLink, FileText, Headphones, HelpCircle, Loader2, RefreshCw, Save, Sparkles, UploadCloud, XCircle } from 'lucide-react';
import { supabase } from './supabase';
import { transcribeWithLocalWhisper } from './localWhisperClient';
import { getLane } from './leadTypes';
import { recordingNotes } from './recordingImport';
import {transcriptKey,type RecordingVerification,type VerifiedDraft} from '../supabase/functions/_shared/recordingVerification';
import {RecordingVerificationWorkspace,type AppointmentSummaryDraft} from './RecordingVerificationWorkspace';

const BUCKET = 'qc-recordings';
const STORAGE_PREFIX = `storage://${BUCKET}/`;
const MAX_BYTES = 100 * 1024 * 1024;

// The six required qualifiers a homeowner call must confirm before ReadyOps
// treats the appointment as qualified. Mirrors supabase/functions/transcribe-and-qualify.
const QUALIFIER_FIELDS: { key: QualifierKey; label: string }[] = [
  { key: 'appointment_confirmed', label: 'Appointment date & time confirmed' },
  { key: 'homeowner_authority', label: 'Homeowner / decision-maker' },
  { key: 'address_confirmed', label: 'Complete address confirmed' },
  { key: 'roof_age_or_damage', label: 'Roof age or qualifying damage' },
  { key: 'payment_ready', label: 'Payment readiness' },
  { key: 'no_existing_contract', label: 'No existing signed contract' },
];
type QualifierKey =
  | 'appointment_confirmed'
  | 'homeowner_authority'
  | 'address_confirmed'
  | 'roof_age_or_damage'
  | 'payment_ready'
  | 'no_existing_contract';
type QualifierValue = 'yes' | 'no' | 'unknown';

type Assessment = {
  recording_verification?: RecordingVerification;
  qualifiers?: Partial<Record<QualifierKey, QualifierValue>>;
  evidence?: Partial<Record<QualifierKey, string>>;
  optional_details?: {
    insurance_company?: string;
    roof_type?: string;
    stories?: string;
    damage_type?: string;
    last_inspection_date?: string;
  };
  payment_path?: 'cash' | 'financing' | 'insurance' | 'unknown';
  lead_type?: string;
  roof_age_damage_override?: boolean;
  genuine_call?: 'yes' | 'no' | 'uncertain';
  confidence?: 'high' | 'medium' | 'low';
  reasons?: string[];
  summary?: string;
} | null;

type TranscriptRow = {
  transcript: string | null;
  summary: string | null;
  language: string | null;
  method: string | null;
  assessment: Assessment;
};

type QualifyVerdict = 'qualified' | 'not-qualified' | 'needs-review';

type QualifyResult = {
  transcript?: string;
  summary?: string;
  qualified: QualifyVerdict;
  confidence?: number | string;
  reasons?: string[];
  error?: string;
};

type QualifyResponse = Omit<QualifyResult, 'qualified' | 'confidence'> & {
  qualified?: boolean | QualifyVerdict | null;
  qualification_status?: string | null;
  confidence?: number | string | null;
  assessment?: Assessment;
};

function qualifierIcon(value?: QualifierValue) {
  if (value === 'yes') return <CheckCircle2 size={13} className="text-green-600" />;
  if (value === 'no') return <XCircle size={13} className="text-red-600" />;
  return <HelpCircle size={13} className="text-amber-600" />;
}

function qualifierTone(value?: QualifierValue): string {
  if (value === 'yes') return 'border-green-200 bg-green-50 text-green-800';
  if (value === 'no') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}


type SpeechAlternativeLike = { transcript: string; confidence?: number };
type SpeechResultLike = { isFinal: boolean; length: number; [index: number]: SpeechAlternativeLike };
type SpeechResultListLike = { length: number; [index: number]: SpeechResultLike };
type SpeechResultEventLike = { resultIndex: number; results: SpeechResultListLike };
type SpeechErrorEventLike = { error: string; message?: string };

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechRecognitionConstructor = {
  new (): BrowserSpeechRecognition;
  available?: (options: { langs: string[]; processLocally: boolean; quality?: 'dictation' | 'command' }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean; quality?: 'dictation' | 'command' }) => Promise<boolean>;
};

type SpeechWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

type CapturableAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function storagePath(value: string): string | null {
  return value.startsWith(STORAGE_PREFIX) ? value.slice(STORAGE_PREFIX.length) : null;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

function normalizeQualifyResult(result: QualifyResponse): QualifyResult {
  const responseStatus = typeof result.qualified === 'string' ? result.qualified : '';
  const storedStatus = (result.qualification_status || '').replace(/_/g, '-');
  const status = responseStatus || storedStatus;
  const qualified: QualifyVerdict = result.qualified === true || status === 'qualified'
    ? 'qualified'
    : result.qualified === false || status === 'not-qualified'
    ? 'not-qualified'
    : 'needs-review';

  return {
    transcript: result.transcript,
    summary: result.summary,
    qualified,
    confidence: result.confidence ?? undefined,
    reasons: result.reasons,
    error: result.error,
  };
}

async function functionErrorMessage(error: unknown, response: QualifyResponse | null): Promise<string> {
  if (response?.error) return response.error;
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json() as { error?: unknown };
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
    } catch {
      // Fall through to the SDK message when the function did not return JSON.
    }
  }
  return error instanceof Error ? error.message : 'Unable to transcribe and qualify this call.';
}

function confidenceLabel(confidence?: number | string): string {
  if (typeof confidence === 'number') {
    const percent = confidence <= 1 ? confidence * 100 : confidence;
    return `${Math.round(percent)}%`;
  }
  if (typeof confidence === 'string' && confidence.trim()) {
    const clean = confidence.trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return '';
}

function speechLanguage(language?: string | null): string {
  const normalized = (language || '').trim().toLowerCase();
  if (normalized.startsWith('es') || normalized.includes('spanish') || normalized.includes('español')) return 'es-MX';
  return 'en-US';
}

function buildRuleBasedSummary(transcript: string): string {
  return recordingNotes(transcript);
}

async function waitForAudio(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Unable to load the recording for transcription.')); };
    const cleanup = () => {
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onError);
    };
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.load();
  });
}

export function QCRecordingUpload({
  leadId,
  value,
  shared,
  language,
  onChange,
  onShareChange,
  appointmentDate,
  appointmentTime,
  appointmentTimezone,
  leadType,
  leadForm,
  onRecordingNotesChange,
  importedTranscript,
  onVerification,
  onSummaryDraftChange,
  onVerificationStale,
  onRecordingContextChange,
}: {
  leadId: string;
  value: string;
  shared: boolean;
  language?: string | null;
  onChange: (value: string) => void;
  onShareChange: (value: boolean) => void;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  appointmentTimezone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  homeownerName?: string | null;
  leadType?: string | null;
  leadForm?: Record<string, unknown>;
  onRecordingNotesChange?: (value: string) => void;
  importedTranscript?: string;
  onVerification?: (verification:RecordingVerification)=>void;
  onSummaryDraftChange?: (draft:AppointmentSummaryDraft)=>void;
  onVerificationStale?: ()=>void;
  onRecordingContextChange?: (context:Record<string,unknown>)=>void;
}) {
  const [uploading, setUploading] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState('');
  const [aiQualifying, setAiQualifying] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<QualifyResult | null>(null);
  const [assessment, setAssessment] = useState<Assessment>(null);
  const currentRecording = useRef({ leadId, value });
  currentRecording.current = { leadId, value };
  const previousRecording = useRef({ leadId, value });
  const analyzed=useRef(new Set<string>());
  const manualTranscript=useRef(false);
  const analysisGeneration=useRef(0);
  const recordingContext=(leadForm?._qc_recording_context||{}) as Record<string,unknown>;
  const recordingContextKey=JSON.stringify(recordingContext);
  const applied=useRef('');
  const verificationCallback=useRef(onVerification);verificationCallback.current=onVerification;
  const reviewDraft=leadForm?._qc_recording_review as VerifiedDraft|undefined;
  const currentVerification=assessment?.recording_verification?.version===4?assessment.recording_verification:undefined;
  useEffect(()=>{
    if(!currentVerification||currentVerification.lead_id!==leadId||currentVerification.recording_url!==value||currentVerification.transcript_key!==transcriptKey(transcript))return;
    const key=`${leadId}|${value}|${JSON.stringify(currentVerification)}`;
    if(applied.current===key)return;
    applied.current=key;verificationCallback.current?.(currentVerification);
  },[currentVerification,leadId,value,transcript]);
  useEffect(()=>{
    if(!onVerification||!transcript.trim()||transcribing||aiQualifying||savingTranscript)return;
    if(currentVerification?.recording_url===value&&currentVerification.transcript_key===transcriptKey(transcript))return;
    const key=`${leadId}|${value}|${transcriptKey(transcript)}|${recordingContextKey}`;
    if(analyzed.current.has(key))return;
    const timer=window.setTimeout(()=>{
      analyzed.current.add(key);
      void transcribeAndQualify(true,Boolean(value)&&currentVerification?.recording_url!==value&&!manualTranscript.current);
    },900);
    return ()=>window.clearTimeout(timer);
    // The analysis is bound to the exact lead, audio and transcript above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[leadId,value,transcript,recordingContextKey,transcribing,aiQualifying,savingTranscript,currentVerification,Boolean(onVerification)]);
  useEffect(() => {
    const previous = previousRecording.current;
    previousRecording.current = { leadId, value };
    if (previous.leadId === leadId && previous.value === value) return;
    manualTranscript.current=false;
    setTranscript(''); setSummary(''); setAssessment(null); setAiResult(null); setAiError('');
    setTranscriptStatus(previous.leadId === leadId ? 'Recording replaced. Transcribe the current audio to generate a new transcript.' : '');
  }, [leadId, value]);


  useEffect(() => {
    let active = true;
    async function resolvePlayback() {
      setPlaybackUrl('');
      setError('');
      if (!value) return;
      const path = storagePath(value);
      if (!path) {
        setPlaybackUrl(value);
        return;
      }
      const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      if (!active) return;
      if (signedError || !data?.signedUrl) setError(signedError?.message || 'Unable to load recording.');
      else setPlaybackUrl(data.signedUrl);
    }
    void resolvePlayback();
    return () => { active = false; };
  }, [value]);

  useEffect(() => {
    let active = true;
    async function loadTranscript() {
      const { data, error: loadError } = await supabase
        .from('qc_lead_transcripts')
        .select('transcript,summary,language,method,assessment')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (!active || currentRecording.current.leadId !== leadId || currentRecording.current.value !== value) return;
      if (loadError) {
        setTranscriptStatus('Transcript storage is temporarily unavailable.');
        return;
      }
      const row = data as TranscriptRow | null;
      setTranscript(importedTranscript || row?.transcript || '');
      const savedNotes = row?.method === 'booking-local-whisper' || row?.method === 'manual' ? row.summary : '';
      setSummary(String(leadForm?.recording_notes || (importedTranscript ? recordingNotes(importedTranscript) : savedNotes || recordingNotes(row?.transcript || ''))));
      setAssessment(row?.assessment || null);
      setTranscriptStatus(importedTranscript ? 'Imported transcript — review and Save Transcript to keep it.' : row?.transcript ? `Saved transcript • ${row.method || 'manual'}` : '');
    }
    void loadTranscript();
    return () => { active = false; };
  }, [leadId, importedTranscript]);

  async function upload(file: File) {
    setError('');
    if (file.size > MAX_BYTES) {
      setError('Recording is too large. Maximum file size is 100 MB.');
      return;
    }
    setUploading(true);
    const path = `${leadId}/${Date.now()}-${safeName(file.name || 'recording')}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) setError(uploadError.message);
    else onChange(`${STORAGE_PREFIX}${path}`);
    setUploading(false);
  }

  async function saveTranscript(nextTranscript = transcript, nextSummary = summary, method = 'manual') {
    setSavingTranscript(true);
    setTranscriptStatus('Saving transcript...');
    const { data: userData } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from('qc_lead_transcripts').upsert({
      lead_id: leadId,
      transcript: nextTranscript.trim(),
      summary: nextSummary.trim(),
      language: assessment?.recording_verification?.observations.find(o=>o.field==='language'&&o.certainty==='confirmed')?.value||null,
      method,
      updated_by: userData.user?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lead_id' });
    if (saveError) setTranscriptStatus(`Could not save transcript: ${saveError.message}`);
    else { setTranscriptStatus('Transcript and recording notes saved to QC.'); onRecordingNotesChange?.(nextSummary.trim()); }
    setSavingTranscript(false);
  }

  async function ensureLocalSpeechPack(ctor: BrowserSpeechRecognitionConstructor, lang: string): Promise<void> {
    if (!ctor.available) return;
    const options = { langs: [lang], processLocally: true, quality: 'dictation' as const };
    const availability = await ctor.available(options);
    if (availability === 'available') return;
    if ((availability === 'downloadable' || availability === 'downloading') && ctor.install) {
      setTranscriptStatus(availability === 'downloading' ? 'Waiting for the on-device language pack...' : 'Installing the on-device language pack...');
      const installed = await ctor.install(options);
      if (installed) return;
    }
    throw new Error(`On-device speech recognition is not available for ${lang} in this browser. You can still paste the transcript manually.`);
  }

  async function transcribeRecording() {
    const source = { leadId, value };
    const isCurrent = () => currentRecording.current.leadId === source.leadId && currentRecording.current.value === source.value;
    setError('');
    setTranscriptStatus('');
    if (!playbackUrl) {
      setError('Attach a recording before transcribing the call.');
      return;
    }

    setTranscribing(true);
    let localFailureDetail = '';
    try {
      setTranscriptStatus('Starting free local Whisper AI — no paid API...');
      const localTranscript = await transcribeWithLocalWhisper(playbackUrl, 'auto', setTranscriptStatus);
      if (!isCurrent()) { setTranscribing(false); return; }
      if (!localTranscript) throw new Error('Local Whisper did not return transcript text.');
      const localSummary = buildRuleBasedSummary(localTranscript);
      setTranscript(localTranscript);
      setSummary(localSummary);
      setTranscriptStatus('Local Whisper transcription complete. Saving to QC...');
      await saveTranscript(localTranscript, localSummary, 'local_whisper_auto');
      setTranscribing(false);
      return;
    } catch (localError) {
      if (!isCurrent()) { setTranscribing(false); return; }
      localFailureDetail = localError instanceof Error ? localError.message : 'Local Whisper failed.';
      setTranscriptStatus(`Local Whisper unavailable (${localFailureDetail}). Trying browser speech fallback...`);
    }

    const speechWindow = window as SpeechWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setError(`Local Whisper could not run: ${localFailureDetail || 'unknown browser error'} This browser has no on-device speech fallback. Use AI Transcribe & Qualify for the OpenAI server fallback.`);
      setTranscribing(false);
      return;
    }

    const lang = speechLanguage(language);
    try {
      await ensureLocalSpeechPack(SpeechCtor, lang);
      const audio = new Audio(playbackUrl) as CapturableAudio;
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.volume = 0.01;
      await waitForAudio(audio);

      const stream = audio.captureStream?.() || audio.mozCaptureStream?.();
      if (!stream) throw new Error('This browser cannot send an uploaded audio track to speech recognition. Paste the transcript manually instead.');
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('No audio track was found in this recording.');

      const recognition = new SpeechCtor();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.processLocally = true;

      const finalTranscript = await new Promise<string>((resolve, reject) => {
        const parts: string[] = [];
        let settled = false;

        recognition.onresult = event => {
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            if (!result?.isFinal || !result[0]?.transcript) continue;
            parts.push(result[0].transcript.trim());
            setTranscript(parts.join(' ').trim());
          }
        };
        recognition.onerror = event => {
          if (settled) return;
          settled = true;
          audio.pause();
          track.stop();
          reject(new Error(event.message || `Speech recognition error: ${event.error}`));
        };
        recognition.onend = () => {
          if (settled) return;
          settled = true;
          audio.pause();
          track.stop();
          resolve(parts.join(' ').replace(/\s+/g, ' ').trim());
        };
        audio.addEventListener('ended', () => {
          window.setTimeout(() => recognition.stop(), 250);
        }, { once: true });

        void audio.play().then(() => recognition.start(track)).catch(reason => {
          if (settled) return;
          settled = true;
          track.stop();
          reject(reason instanceof Error ? reason : new Error('Unable to play the recording for transcription.'));
        });
      });

      if (!isCurrent()) return;
      if (!finalTranscript) throw new Error('No speech was recognized in the recording. You can paste or type the transcript manually.');
      const nextSummary = buildRuleBasedSummary(finalTranscript);
      setTranscript(finalTranscript);
      setSummary(nextSummary);
      setTranscriptStatus('Transcription complete. Saving to QC...');
      await saveTranscript(finalTranscript, nextSummary, 'browser_on_device');
    } catch (transcriptionError) {
      setError(transcriptionError instanceof Error ? transcriptionError.message : 'Unable to transcribe this recording.');
    } finally {
      setTranscribing(false);
    }
  }

  async function transcribeAndQualify(verifyOnly=false,refreshAudio=true) {
    const source = { leadId, value };
    const generation=++analysisGeneration.current;
    setAiError('');
    setAiResult(null);
    setAiQualifying(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error('Your ReadyOps session expired. Sign in again, then retry AI Transcribe & Qualify.');
      }
      const { data, error: invokeError } = await supabase.functions.invoke('transcribe-and-qualify', {
        body: {
          lead_id: leadId,
          recording_url: value || undefined,
          transcript: transcript.trim() || undefined,
          force_transcription: refreshAudio&&Boolean(value),
          verify_only: verifyOnly,
          recording_context:{...recordingContext,recording_url:value,timezone:recordingContext.timezone||appointmentTimezone||''},
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const response = data as QualifyResponse | null;
      if (currentRecording.current.leadId !== source.leadId || currentRecording.current.value !== source.value||analysisGeneration.current!==generation) return;
      if (invokeError) throw new Error(await functionErrorMessage(invokeError, response));
      if (response?.error) throw new Error(response.error);
      if (!response) throw new Error('The AI function returned an empty response.');
      const result = normalizeQualifyResult(response);
      if (result.transcript) setTranscript(result.transcript);
      if (result.transcript) setSummary(recordingNotes(result.transcript));
      setAiResult(result);
      setAssessment(response.assessment || null);
    } catch (qualifyError) {
      setAiError(qualifyError instanceof Error ? qualifyError.message : 'Unable to transcribe and qualify this call.');
    } finally {
      setAiQualifying(false);
    }
  }

  function rebuildSummary() {
    const nextSummary = buildRuleBasedSummary(transcript);
    setSummary(nextSummary);
    setTranscriptStatus(nextSummary ? 'Recording passages selected. Click Save Transcript.' : 'Add transcript text before building a summary.');
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-2"><Headphones size={16} className="text-blue-700"/><h3 className="font-bold text-blue-950">Appointment Recording</h3></div>
      <p className="mt-1 text-xs text-slate-500">Upload the ReadyMode call recording here. MP3, WAV, M4A, WebM and OGG are supported up to 100 MB.</p>
      {onRecordingContextChange&&<details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Recording date for relative appointment references</summary><p className="mt-1">Use the actual call date and property timezone when known. An older call’s “tomorrow” is never calculated from today or the upload date.</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{[['recorded_at','Actual call date','date'],['timezone','Property timezone','text']].map(([key,label,type])=><label key={key}>{label}<input aria-label={label} type={type} value={String(recordingContext.recording_url===value?recordingContext[key]|| (key==='timezone'?appointmentTimezone||'':''):key==='timezone'?appointmentTimezone||'':'')} onChange={event=>{manualTranscript.current=true;analyzed.current.clear();analysisGeneration.current++;setAssessment(null);onVerificationStale?.();onRecordingContextChange({...recordingContext,recording_url:value,[key]:event.target.value,timezone:key==='timezone'?event.target.value:recordingContext.timezone||appointmentTimezone||''});}} className="mt-1 w-full rounded border border-blue-200 bg-white p-2"/></label>)}</div></details>}

      <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-white px-4 py-4 text-sm font-bold text-blue-700 hover:bg-blue-50">
        {uploading ? <Loader2 size={17} className="animate-spin"/> : <UploadCloud size={17}/>} {uploading ? 'Uploading recording…' : 'Upload Recording'}
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
          disabled={uploading || transcribing || aiQualifying}
          className="hidden"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = '';
          }}
        />
      </label>

      <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Recording URL (optional fallback)</label>
      <input
        value={value.startsWith(STORAGE_PREFIX) ? '' : value}
        disabled={uploading || transcribing || aiQualifying}
        onChange={event => onChange(event.target.value.trim())}
        placeholder="Paste ReadyMode recording URL or upload a file above"
        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-slate-700"
      />

      {value.startsWith(STORAGE_PREFIX) && <p className="mt-2 break-all text-[10px] font-semibold text-blue-700">Private upload attached.</p>}
      {playbackUrl && <><audio controls preload="metadata" src={playbackUrl} className="mt-3 w-full"/><a href={playbackUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700"><ExternalLink size={12}/> Open audio</a></>}
      {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><FileText size={16} className="text-slate-700"/><div><h4 className="text-sm font-black text-slate-900">Call Transcript</h4><p className="text-[11px] text-slate-500">Authorized QC reviewers only • Customer preference: {language || 'Not verified'}</p></div></div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!playbackUrl || transcribing} onClick={() => void transcribeRecording()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {transcribing ? <Loader2 size={13} className="animate-spin"/> : <Headphones size={13}/>} {transcribing ? 'Transcribing…' : 'Free AI Transcribe'}
            </button>
            {onVerification&&<button type="button" disabled={aiQualifying||!playbackUrl} onClick={()=>void transcribeAndQualify(true,true)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Verify Current Recording</button>}
            <button type="button" disabled={aiQualifying || (!playbackUrl && !transcript.trim())} onClick={() => void transcribeAndQualify()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {aiQualifying ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>} {aiQualifying ? 'Transcribing & Qualifying…' : 'AI Transcribe & Qualify'}
            </button>
          </div>
        </div>
        {reviewDraft?.verification.lead_id===leadId&&reviewDraft.verification.recording_url===value&&reviewDraft.verification.transcript_key===transcriptKey(transcript)&&onVerification&&<RecordingVerificationWorkspace
          leadId={leadId} review={reviewDraft} values={{...leadForm,appointment_date:leadForm?.appointment_date||appointmentDate,appointment_time:leadForm?.appointment_time||appointmentTime}}
          savedDraft={leadForm?._qc_summary_draft as AppointmentSummaryDraft|undefined}
          onDraftChange={onSummaryDraftChange} onRegenerate={()=>void transcribeAndQualify(true,false)} busy={aiQualifying}/>}
        {aiError && <p className="mt-2 text-xs font-semibold text-red-700">{aiError}</p>}
        {aiResult && (
          <div className="mt-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${
              aiResult.qualified === 'qualified'
                ? 'bg-green-100 text-green-800'
                : aiResult.qualified === 'not-qualified'
                ? 'bg-red-100 text-red-800'
                : 'bg-amber-100 text-amber-800'
            }`}>
              {aiResult.qualified.replace('-', ' ')}
              {confidenceLabel(aiResult.confidence) && <span className="font-bold">• {confidenceLabel(aiResult.confidence)}</span>}
            </span>
            {aiResult.reasons && aiResult.reasons.length > 0 && (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-slate-600">
                {aiResult.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
              </ul>
            )}
          </div>
        )}
        {assessment && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <h5 className="text-[10px] font-black uppercase tracking-wide text-slate-500">Six-Qualifier Assessment</h5>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {QUALIFIER_FIELDS.map(field => {
                const qualifierValue = assessment.qualifiers?.[field.key];
                const evidenceText = assessment.evidence?.[field.key];
                return (
                  <div key={field.key} className={`flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${qualifierTone(qualifierValue)}`} title={evidenceText || undefined}>
                    {qualifierIcon(qualifierValue)}
                    <span>
                      <span className="font-bold">{(qualifierValue || 'unknown').toUpperCase()}</span> — {field.label}
                      {evidenceText && <span className="mt-0.5 block font-normal italic text-slate-500">“{evidenceText}”</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${getLane(leadType ?? assessment.lead_type).badgeTone}`}>{getLane(leadType ?? assessment.lead_type).shortLabel}</span>
              {assessment.payment_path && assessment.payment_path !== 'unknown' && <span>Payment path: <span className="font-bold">{assessment.payment_path}</span></span>}
              {assessment.genuine_call && <span>Call intent: <span className="font-bold">{assessment.genuine_call === 'yes' ? 'genuine' : assessment.genuine_call}</span></span>}
              {assessment.roof_age_damage_override && <span className="font-bold text-amber-700">Roof-age requirement overridden by reported damage</span>}
            </div>

            {assessment.summary && (
              <div className="mt-3">
                <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Short Summary</label>
                <p className="mt-1 rounded-lg border border-slate-200 bg-white p-2.5 text-xs leading-5 text-slate-800">{assessment.summary}</p>
              </div>
            )}


          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">Free AI Transcribe runs local Whisper in supported browsers with no per-minute API charge. AI Transcribe &amp; Qualify transcribes the currently selected recording, then evaluates the call against company requirements. Without audio, it uses the pasted or saved transcript.</p>
        <textarea value={transcript} onChange={event => {manualTranscript.current=true;analyzed.current.clear();analysisGeneration.current++;setTranscript(event.target.value);setAssessment(null);onVerificationStale?.();}} placeholder="Transcript will appear here, or paste/type it manually." className="mt-3 min-h-36 w-full rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-800"/>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={rebuildSummary} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw size={12}/> Use recording passages</button>
          <button type="button" disabled={savingTranscript} onClick={() => void saveTranscript()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingTranscript ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>} Save Transcript</button>
          <button type="button" disabled={!transcript} onClick={() => void navigator.clipboard.writeText(transcript)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"><ClipboardCopy size={12}/> Copy Transcript</button>
        </div>

        <p className="mt-2 text-[10px] font-semibold text-slate-400">{transcriptStatus}</p>
      </div>

      <label className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-white p-3 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={shared} onChange={event => onShareChange(event.target.checked)} className="mt-0.5"/>
        <span>Share recording with company after QC approval.<span className="mt-1 block font-normal text-slate-500">Off by default. If unchecked, the company and representative cannot see the audio. The full QC transcript remains internal.</span></span>
      </label>
    </div>
  );
}
