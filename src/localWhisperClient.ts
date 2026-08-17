let worker: Worker | null = null;
let activeReject: ((reason?: unknown) => void) | null = null;

type WorkerMessage = {
  type: 'progress' | 'result' | 'error';
  message?: string;
  text?: string;
};

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./localWhisperWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function transcribeWithLocalWhisper(audioUrl: string, onProgress?: (message: string) => void): Promise<string> {
  const whisperWorker = getWorker();
  if (activeReject) activeReject(new Error('A newer transcription request replaced the previous request.'));

  return new Promise<string>((resolve, reject) => {
    activeReject = reject;

    const cleanup = () => {
      whisperWorker.removeEventListener('message', onMessage);
      whisperWorker.removeEventListener('error', onWorkerError);
      if (activeReject === reject) activeReject = null;
    };

    const onMessage = (event: MessageEvent<WorkerMessage>) => {
      const payload = event.data;
      if (payload?.type === 'progress') {
        if (payload.message) onProgress?.(payload.message);
        return;
      }
      if (payload?.type === 'result') {
        cleanup();
        resolve(String(payload.text || '').trim());
        return;
      }
      if (payload?.type === 'error') {
        cleanup();
        reject(new Error(payload.message || 'Local Whisper transcription failed.'));
      }
    };

    const onWorkerError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Unable to start the local Whisper worker.'));
    };

    whisperWorker.addEventListener('message', onMessage);
    whisperWorker.addEventListener('error', onWorkerError);
    whisperWorker.postMessage({ type: 'transcribe', audioUrl });
  });
}
