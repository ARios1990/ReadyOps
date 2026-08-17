/// <reference lib="webworker" />

import { pipeline } from '@huggingface/transformers';

type WorkerRequest = {
  type: 'transcribe';
  audioUrl: string;
};

type ProgressPayload = {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

let transcriberPromise: Promise<any> | null = null;

function post(type: string, payload: Record<string, unknown> = {}) {
  self.postMessage({ type, ...payload });
}

function modelProgress(progress: ProgressPayload) {
  if (progress.status === 'progress') {
    const percent = typeof progress.progress === 'number' ? Math.round(progress.progress) : null;
    post('progress', { message: percent == null ? 'Downloading local Whisper model…' : `Downloading local Whisper model… ${percent}%` });
  } else if (progress.status === 'ready') {
    post('progress', { message: 'Local Whisper model ready.' });
  } else if (progress.status === 'initiate') {
    post('progress', { message: 'Preparing free local transcription model…' });
  }
}

async function getTranscriber() {
  if (!transcriberPromise) {
    const hasWebGPU = Boolean((self.navigator as Navigator & { gpu?: unknown }).gpu);
    post('progress', { message: hasWebGPU ? 'Loading local Whisper AI with WebGPU…' : 'Loading local Whisper AI with browser CPU…' });
    transcriberPromise = pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny',
      {
        device: hasWebGPU ? 'webgpu' : 'wasm',
        progress_callback: modelProgress,
      },
    );
  }
  return transcriberPromise;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data?.type !== 'transcribe' || !event.data.audioUrl) return;
  try {
    const transcriber = await getTranscriber();
    post('progress', { message: 'Transcribing call locally — no paid API…' });
    const output = await transcriber(event.data.audioUrl, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
    const text = String(Array.isArray(output) ? output[0]?.text || '' : output?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Whisper did not detect speech in this recording.');
    post('result', { text });
  } catch (error) {
    post('error', { message: error instanceof Error ? error.message : 'Local Whisper transcription failed.' });
  }
};

export {};
