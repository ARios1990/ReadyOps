let worker: Worker | null = null;
let activeReject: ((reason?: unknown) => void) | null = null;

const WHISPER_SAMPLE_RATE = 16_000;

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

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function mixToMono(audio: AudioBuffer): Float32Array {
  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const channelData = audio.getChannelData(channel);
    for (let index = 0; index < channelData.length; index += 1) {
      mono[index] += channelData[index] / audio.numberOfChannels;
    }
  }
  return mono;
}

function resampleLinear(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === WHISPER_SAMPLE_RATE) return samples;

  const outputLength = Math.max(1, Math.round(samples.length * WHISPER_SAMPLE_RATE / sourceRate));
  const output = new Float32Array(outputLength);
  const sourceStep = sourceRate / WHISPER_SAMPLE_RATE;

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * sourceStep;
    const leftIndex = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    output[index] = samples[leftIndex] + (samples[rightIndex] - samples[leftIndex]) * fraction;
  }

  return output;
}

async function decodeAudioForWhisper(audioUrl: string, onProgress?: (message: string) => void): Promise<Float32Array> {
  onProgress?.('Loading recording for transcription…');

  let response: Response;
  try {
    response = await fetch(audioUrl);
  } catch {
    throw new Error('The browser could not download this recording for transcription. Upload the audio file instead if the pasted recording URL blocks browser access.');
  }
  if (!response.ok) throw new Error(`Unable to download the recording (${response.status}).`);

  const encodedAudio = await response.arrayBuffer();
  const contextWindow = window as AudioContextWindow;
  const AudioContextCtor = globalThis.AudioContext || contextWindow.webkitAudioContext;
  if (!AudioContextCtor) throw new Error('This browser cannot decode audio for local transcription.');

  onProgress?.('Decoding and preparing the recording…');
  let audioContext: AudioContext;
  try {
    audioContext = new AudioContextCtor({ sampleRate: WHISPER_SAMPLE_RATE });
  } catch {
    audioContext = new AudioContextCtor();
  }

  try {
    const decodedAudio = await audioContext.decodeAudioData(encodedAudio);
    const mono = mixToMono(decodedAudio);
    return resampleLinear(mono, decodedAudio.sampleRate);
  } catch {
    throw new Error('The recording could not be decoded. Use an MP3, WAV, M4A, WebM, or OGG file supported by this browser.');
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export async function transcribeWithLocalWhisper(
  audioUrl: string,
  language?: string | null,
  onProgress?: (message: string) => void,
): Promise<string> {
  const audio = await decodeAudioForWhisper(audioUrl, onProgress);
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
    whisperWorker.postMessage({ type: 'transcribe', audio, language }, [audio.buffer]);
  });
}
