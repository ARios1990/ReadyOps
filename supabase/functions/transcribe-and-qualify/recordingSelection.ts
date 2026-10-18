const PREFIX = 'storage://qc-recordings/';

export function selectRecordingInput(input: {
  leadId: string; savedRecordingUrl: string; requestedRecordingUrl: unknown;
  clientTranscript: string; savedTranscript: string; forceTranscription: boolean;
}) {
  const requested = typeof input.requestedRecordingUrl === 'string' ? input.requestedRecordingUrl.trim() : '';
  let recordingUrl = input.savedRecordingUrl.trim();
  if (requested && requested !== recordingUrl) {
    const path = requested.startsWith(PREFIX) ? requested.slice(PREFIX.length) : '';
    if (!path.startsWith(`${input.leadId}/`) || path.includes('..') || path.includes('\\')) {
      throw new Error('Save this recording URL to the lead first, or upload an audio file belonging to this lead.');
    }
    recordingUrl = requested;
  }
  const changed = recordingUrl !== input.savedRecordingUrl.trim();
  const transcript = recordingUrl && (input.forceTranscription || changed)
    ? '' : input.clientTranscript || input.savedTranscript;
  return { recordingUrl, transcript, changed };
}
