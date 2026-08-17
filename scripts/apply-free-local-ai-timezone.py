from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing expected marker: {label}')
    return text.replace(old, new, 1)

# QC recording: prefer the free local Whisper worker, then fall back to browser speech recognition.
qc_path = Path('src/QCRecordingUpload.tsx')
qc = qc_path.read_text(encoding='utf-8')
qc = replace_once(
    qc,
    "import { supabase } from './supabase';",
    "import { supabase } from './supabase';\nimport { transcribeWithLocalWhisper } from './localWhisperClient';",
    'QC local Whisper import',
)
qc = replace_once(
    qc,
    """    const speechWindow = window as SpeechWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setError('This browser does not support recording transcription. Use current desktop Chrome/Edge or paste the transcript manually.');
      return;
    }

    setTranscribing(true);
    const lang = speechLanguage(language);
""",
    """    setTranscribing(true);
    try {
      setTranscriptStatus('Starting free local Whisper AI — no paid API...');
      const localTranscript = await transcribeWithLocalWhisper(playbackUrl, setTranscriptStatus);
      if (!localTranscript) throw new Error('Local Whisper did not return transcript text.');
      const localSummary = buildRuleBasedSummary(localTranscript);
      setTranscript(localTranscript);
      setSummary(localSummary);
      setTranscriptStatus('Local Whisper transcription complete. Saving to QC...');
      await saveTranscript(localTranscript, localSummary, 'local_whisper');
      setTranscribing(false);
      return;
    } catch (localError) {
      const detail = localError instanceof Error ? localError.message : 'Local Whisper failed.';
      setTranscriptStatus(`Local Whisper unavailable (${detail}). Trying browser speech fallback...`);
    }

    const speechWindow = window as SpeechWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setError('Free local Whisper could not run and this browser has no speech-recognition fallback. You can still paste the transcript manually.');
      setTranscribing(false);
      return;
    }

    const lang = speechLanguage(language);
""",
    'QC transcribe local-first block',
)
qc = replace_once(
    qc,
    "Uses supported browser/on-device speech recognition when available. No external LLM is used to summarize the call.",
    "Uses free local Whisper AI in your browser first (no per-minute API charge), then browser speech recognition as a fallback. The summary remains rule-based and does not use an LLM.",
    'QC transcript explanation',
)
qc = replace_once(
    qc,
    "{transcribing ? 'Transcribing…' : 'Transcribe Call'}",
    "{transcribing ? 'Transcribing…' : 'Free AI Transcribe'}",
    'QC transcribe button label',
)
qc_path.write_text(qc, encoding='utf-8')

# Location editor: auto-detect timezone from city/state/ZIP but keep manual override.
manager_path = Path('src/AdminSchedulingManager.tsx')
manager = manager_path.read_text(encoding='utf-8')
manager = replace_once(
    manager,
    "import { useScheduleStore } from './useScheduleStore';",
    "import { useScheduleStore } from './useScheduleStore';\nimport { inferUsTimeZone, READYOPS_TIME_ZONES } from './timeZoneUtils';",
    'timezone imports',
)
manager = replace_once(manager, "    timezone: 'America/Chicago',", "    timezone: '',", 'blank timezone')
manager = replace_once(
    manager,
    "  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);",
    "  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);\n  const [timezoneAuto, setTimezoneAuto] = useState(true);",
    'timezone auto state',
)
manager = replace_once(
    manager,
    """  function setLocationField<K extends keyof LocationDraft>(key: K, value: LocationDraft[K]) {
    setLocationDraft(current => ({ ...current, [key]: value }));
  }
""",
    """  function setLocationField<K extends keyof LocationDraft>(key: K, value: LocationDraft[K]) {
    setLocationDraft(current => ({ ...current, [key]: value }));
  }

  function setLocationGeoField(key: 'city' | 'state' | 'zip_code', value: string) {
    setTimezoneAuto(true);
    setLocationDraft(current => {
      const next = { ...current, [key]: value };
      const inferred = inferUsTimeZone(next.city, next.state, next.zip_code);
      return inferred ? { ...next, timezone: inferred } : next;
    });
  }
""",
    'geo field helper',
)
manager = replace_once(
    manager,
    "    setEditingLocationId(location.id);\n    setLocationDraft({",
    "    setEditingLocationId(location.id);\n    setTimezoneAuto(false);\n    setLocationDraft({",
    'preserve existing timezone',
)
manager = replace_once(
    manager,
    """  function startNewLocation() {
    setEditingLocationId(null);
    setLocationDraft(blankLocation());
""",
    """  function startNewLocation() {
    setEditingLocationId(null);
    setTimezoneAuto(true);
    setLocationDraft(blankLocation());
""",
    'new location timezone auto',
)
manager = replace_once(
    manager,
    "      timezone: locationDraft.timezone.trim() || 'America/Chicago',",
    "      timezone: locationDraft.timezone.trim() || inferUsTimeZone(locationDraft.city, locationDraft.state, locationDraft.zip_code) || 'America/Chicago',",
    'save inferred timezone',
)
manager = replace_once(
    manager,
    """                  <Field label="City" value={locationDraft.city} onChange={value => setLocationField('city', value)} />
                  <Field label="State" value={locationDraft.state} onChange={value => setLocationField('state', value)} placeholder="TX" />
                  <Field label="ZIP" value={locationDraft.zip_code} onChange={value => setLocationField('zip_code', value)} />
""",
    """                  <Field label="City" value={locationDraft.city} onChange={value => setLocationGeoField('city', value)} />
                  <Field label="State" value={locationDraft.state} onChange={value => setLocationGeoField('state', value)} placeholder="TX" />
                  <Field label="ZIP" value={locationDraft.zip_code} onChange={value => setLocationGeoField('zip_code', value)} />
""",
    'geo fields',
)
manager = replace_once(
    manager,
    """                  <label className="text-xs font-bold text-slate-600">
                    Time Zone
                    <select
                      value={locationDraft.timezone}
                      onChange={event => setLocationField('timezone', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="America/New_York">Eastern</option>
                      <option value="America/Chicago">Central</option>
                      <option value="America/Denver">Mountain</option>
                      <option value="America/Phoenix">Arizona</option>
                      <option value="America/Los_Angeles">Pacific</option>
                    </select>
                  </label>
""",
    """                  <label className="text-xs font-bold text-slate-600">
                    Time Zone {timezoneAuto ? <span className="font-semibold text-emerald-600">• Auto-detected</span> : <span className="font-semibold text-amber-600">• Manual override</span>}
                    <select
                      value={locationDraft.timezone}
                      onChange={event => { setTimezoneAuto(false); setLocationField('timezone', event.target.value); }}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      {!locationDraft.timezone && <option value="">Enter City / State / ZIP to auto-detect</option>}
                      {READYOPS_TIME_ZONES.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                    </select>
                    <span className="mt-1 block text-[10px] font-normal text-slate-400">ReadyOps fills this from the location. You can change it anytime if the service area crosses a time-zone boundary.</span>
                  </label>
""",
    'timezone selector',
)
manager_path.write_text(manager, encoding='utf-8')

# Booking portal: display the saved location timezone when a service area is selected.
portal_path = Path('src/AgentBookingPortal.tsx')
portal = portal_path.read_text(encoding='utf-8')
portal = replace_once(
    portal,
    "interface Location { id: string; label: string; state: string | null; }",
    "interface Location { id: string; label: string; state: string | null; timezone?: string | null; }",
    'booking location timezone type',
)
portal = replace_once(
    portal,
    """    const { data, error: rpcErr } = await supabase.rpc('get_public_booking_portal', {
      p_slug: slug,
      p_location_id: nextLocationId,
      p_start_date: startDate,
      p_end_date: endDate,
    });
""",
    """    const [{ data, error: rpcErr }, { data: locationTimezone }] = await Promise.all([
      supabase.rpc('get_public_booking_portal', {
        p_slug: slug,
        p_location_id: nextLocationId,
        p_start_date: startDate,
        p_end_date: endDate,
      }),
      supabase.rpc('get_public_location_timezone', { p_slug: slug, p_location_id: nextLocationId }),
    ]);
""",
    'booking timezone rpc',
)
portal = replace_once(
    portal,
    """        const result = normalizePublicPortalData(data);
        setPortal(result);
""",
    """        const result = normalizePublicPortalData(data);
        if (typeof locationTimezone === 'string' && locationTimezone) result.company.settings.timezone = locationTimezone;
        setPortal(result);
""",
    'apply booking timezone',
)
portal_path.write_text(portal, encoding='utf-8')

print('Applied free local Whisper and automatic timezone patch.')
