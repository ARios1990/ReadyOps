import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { ClipboardCopy, ExternalLink, FileText, Headphones, Loader2, RefreshCw, Save, Sparkles, UploadCloud } from 'lucide-react';
import { supabase } from './supabase';
import { transcribeWithLocalWhisper } from './localWhisperClient';

const BUCKET = 'qc-recordings';
const STORAGE_PREFIX = `storage://${BUCKET}/`;
const MAX_BYTES = 100 * 1024 * 1024;

type TranscriptRow = {
  transcript: string | null;
  summary: string | null;
  language: string | null;
  method: string | null;
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
};

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

function cleanSentence(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 240 ? `${clean.slice(0, 237)}...` : clean;
}

function transcriptSentences(transcript: string): string[] {
  const normalized = transcript.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks = normalized.match(/[^.!?]+[.!?]?/g)?.map(cleanSentence).filter(Boolean) || [];
  if (chunks.length > 1) return chunks;
  const softChunks = normalized
    .split(/\b(?:okay|alright|so|and then|also|by the way)\b/gi)
    .map(cleanSentence)
    .filter(part => part.length >= 12);
  return softChunks.length > 1 ? softChunks : chunks;
}

function firstMatchingSentence(sentences: string[], pattern: RegExp): string {
  return sentences.find(sentence => pattern.test(sentence)) || '';
}

function buildRuleBasedSummary(transcript: string): string {
  const sentences = transcriptSentences(transcript);
  if (!sentences.length) return '';

  const appointment = firstMatchingSentence(sentences, /\b(appointment|schedule|scheduled|available|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))\b/i);
  const roof = firstMatchingSentence(sentences, /\b(roof|shingle|shingles|tile|metal|flat roof|slate|years? old)\b/i);
  const damage = firstMatchingSentence(sentences, /\b(damage|damaged|hail|wind|leak|leaking|missing shingle|missing shingles|storm|dent|dented)\b/i);
  const insurance = firstMatchingSentence(sentences, /\b(insurance|insured|claim|adjuster|deductible)\b/i);
  const intent = firstMatchingSentence(sentences, /\b(estimate|inspection|second opinion|reroof|re-roof|replace|replacement|interested|check the roof|look at the roof|wants? to)\b/i);

  const lines: string[] = [];
  if (appointment) lines.push(`Appointment: ${appointment}`);
  if (roof) lines.push(`Roof: ${roof}`);
  if (damage) lines.push(`Damage/Storm: ${damage}`);
  if (insurance) lines.push(`Insurance/Claim: ${insurance}`);
  if (intent) lines.push(`Homeowner Intent: ${intent}`);

  if (!lines.length) {
    return `Call Notes: ${sentences.slice(0, 2).join(' ')}`;
  }
  return lines.join('\n');
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
}: {
  leadId: string;
  value: string;
  shared: boolean;
  language?: string | null;
  onChange: (value: string) => void;
  onShareChange: (value: boolean) => void;
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
        .select('transcript,summary,language,method')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (!active) return;
      if (loadError) {
        setTranscriptStatus('Transcript storage is temporarily unavailable.');
        return;
      }
      const row = data as TranscriptRow | null;
      setTranscript(row?.transcript || '');
      setSummary(row?.summary || '');
      setTranscriptStatus(row?.transcript ? `Saved transcript • ${row.method || 'manual'}` : '');
    }
    void loadTranscript();
    return () => { active = false; };
  }, [leadId]);

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
      language: speechLanguage(language),
      method,
      updated_by: userData.user?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lead_id' });
    if (saveError) setTranscriptStatus(`Could not save transcript: ${saveError.message}`);
    else setTranscriptStatus('Transcript and summary saved to QC.');
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
      const localTranscript = await transcribeWithLocalWhisper(playbackUrl, language, setTranscriptStatus);
      if (!localTranscript) throw new Error('Local Whisper did not return transcript text.');
      const localSummary = buildRuleBasedSummary(localTranscript);
      setTranscript(localTranscript);
      setSummary(localSummary);
      setTranscriptStatus('Local Whisper transcription complete. Saving to QC...');
      await saveTranscript(localTranscript, localSummary, 'local_whisper');
      setTranscribing(false);
      return;
    } catch (localError) {
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

  async function transcribeAndQualify() {
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
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const response = data as QualifyResponse | null;
      if (invokeError) throw new Error(await functionErrorMessage(invokeError, response));
      if (response?.error) throw new Error(response.error);
      if (!response) throw new Error('The AI function returned an empty response.');
      const result = normalizeQualifyResult(response);
      if (result.transcript) setTranscript(result.transcript);
      if (result.summary) setSummary(result.summary);
      setAiResult(result);
    } catch (qualifyError) {
      setAiError(qualifyError instanceof Error ? qualifyError.message : 'Unable to transcribe and qualify this call.');
    } finally {
      setAiQualifying(false);
    }
  }

  function rebuildSummary() {
    const nextSummary = buildRuleBasedSummary(transcript);
    setSummary(nextSummary);
    setTranscriptStatus(nextSummary ? 'Rule-based summary rebuilt. Click Save Transcript.' : 'Add transcript text before building a summary.');
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-2"><Headphones size={16} className="text-blue-700"/><h3 className="font-bold text-blue-950">Appointment Recording</h3></div>
      <p className="mt-1 text-xs text-slate-500">Upload the ReadyMode call recording here. MP3, WAV, M4A, WebM and OGG are supported up to 100 MB.</p>

      <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-white px-4 py-4 text-sm font-bold text-blue-700 hover:bg-blue-50">
        {uploading ? <Loader2 size={17} className="animate-spin"/> : <UploadCloud size={17}/>} {uploading ? 'Uploading recording…' : 'Upload Recording'}
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
          disabled={uploading}
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
        onChange={event => onChange(event.target.value.trim())}
        placeholder="Paste ReadyMode recording URL or upload a file above"
        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-slate-700"
      />

      {value.startsWith(STORAGE_PREFIX) && <p className="mt-2 break-all text-[10px] font-semibold text-blue-700">Private upload attached.</p>}
      {playbackUrl && <><audio controls preload="metadata" src={playbackUrl} className="mt-3 w-full"/><a href={playbackUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700"><ExternalLink size={12}/> Open audio</a></>}
      {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><FileText size={16} className="text-slate-700"/><div><h4 className="text-sm font-black text-slate-900">Call Transcript</h4><p className="text-[11px] text-slate-500">Authorized QC reviewers only • {speechLanguage(language)}</p></div></div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!playbackUrl || transcribing} onClick={() => void transcribeRecording()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {transcribing ? <Loader2 size={13} className="animate-spin"/> : <Headphones size={13}/>} {transcribing ? 'Transcribing…' : 'Free AI Transcribe'}
            </button>
            <button type="button" disabled={aiQualifying || (!playbackUrl && !transcript.trim())} onClick={() => void transcribeAndQualify()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {aiQualifying ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>} {aiQualifying ? 'Transcribing & Qualifying…' : 'AI Transcribe & Qualify'}
            </button>
          </div>
        </div>
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
        <p className="mt-2 text-[11px] text-slate-500">Free AI Transcribe runs local Whisper in supported browsers with no per-minute API charge. AI Transcribe &amp; Qualify reuses the transcript when available, otherwise uses secured OpenAI transcription, then evaluates the call against company requirements.</p>
        <textarea value={transcript} onChange={event => setTranscript(event.target.value)} placeholder="Transcript will appear here, or paste/type it manually." className="mt-3 min-h-36 w-full rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-800"/>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={rebuildSummary} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw size={12}/> Build Rule Summary</button>
          <button type="button" disabled={savingTranscript} onClick={() => void saveTranscript()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingTranscript ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>} Save Transcript</button>
          <button type="button" disabled={!transcript} onClick={() => void navigator.clipboard.writeText(transcript)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"><ClipboardCopy size={12}/> Copy Transcript</button>
        </div>

        <label className="mt-4 block text-[10px] font-black uppercase tracking-wide text-slate-500">Rule-Based Call Summary — No LLM</label>
        <textarea value={summary} onChange={event => setSummary(event.target.value)} placeholder="Appointment, roof, damage, insurance/claim, and homeowner intent are extracted from the transcript using fixed rules." className="mt-1 min-h-28 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-800"/>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" disabled={!summary} onClick={() => void navigator.clipboard.writeText(summary)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"><ClipboardCopy size={12}/> Copy Summary</button>
          {transcriptStatus && <span className="text-[11px] font-semibold text-slate-500">{transcriptStatus}</span>}
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-white p-3 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={shared} onChange={event => onShareChange(event.target.checked)} className="mt-0.5"/>
        <span>Share recording with company after QC approval.<span className="mt-1 block font-normal text-slate-500">Off by default. If unchecked, the company and representative cannot see the audio. The QC transcript and rule summary remain internal.</span></span>
      </label>
    </div>
  );
}
