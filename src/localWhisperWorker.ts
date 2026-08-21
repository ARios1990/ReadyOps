/// <reference lib="webworker" />

import { pipeline } from '@huggingface/transformers';

type WorkerRequest = {
  type: 'transcribe';
  audio: Float32Array;
};

type ProgressPayload = {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

type WhisperOutput = { text?: string };
type WhisperTranscriber = ((
  audio: Float32Array,
  options: { chunk_length_s: number; stride_length_s: number; return_timestamps: boolean },
) => Promise<WhisperOutput | WhisperOutput[]>) & {
  dispose?: () => void | Promise<void>;
};
type WhisperPipelineFactory = (
  task: 'automatic-speech-recognition',
  model: string,
  options: { device: 'webgpu' | 'wasm'; progress_callback: typeof modelProgress },
) => Promise<WhisperTranscriber>;

let transcriberPromise: Promise<WhisperTranscriber> | null = null;
let activeDevice: 'webgpu' | 'wasm' | null = null;
let forceWasm = false;

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

type WebGpuNavigator = Navigator & {
  gpu?: {
    requestAdapter?: () => Promise<unknown | null>;
  };
};

async function hasUsableWebGpu(): Promise<boolean> {
  const gpu = (self.navigator as WebGpuNavigator).gpu;
  if (!gpu?.requestAdapter) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function initializeTranscriber() {
  const createWhisperPipeline = pipeline as unknown as WhisperPipelineFactory;
  if (!forceWasm && await hasUsableWebGpu()) {
    post('progress', { message: 'Loading local Whisper AI with WebGPU…' });
    try {
      const transcriber = await createWhisperPipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-tiny',
        { device: 'webgpu', progress_callback: modelProgress },
      );
      activeDevice = 'webgpu';
      return transcriber;
    } catch {
      post('progress', { message: 'WebGPU was unavailable for this model. Retrying with browser CPU…' });
    }
  } else {
    post('progress', { message: 'Loading local Whisper AI with browser CPU…' });
  }

  const transcriber = await createWhisperPipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-tiny',
    { device: 'wasm', progress_callback: modelProgress },
  );
  activeDevice = 'wasm';
  return transcriber;
}

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = initializeTranscriber().catch(error => {
      transcriberPromise = null;
      throw error;
    });
  }
  return transcriberPromise;
}

function runTranscription(transcriber: WhisperTranscriber, audio: Float32Array) {
  return transcriber(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data?.type !== 'transcribe' || !(event.data.audio instanceof Float32Array) || event.data.audio.length === 0) return;
  try {
    let transcriber = await getTranscriber();
    post('progress', { message: 'Transcribing call locally — no paid API…' });
    let output: WhisperOutput | WhisperOutput[];
    try {
      output = await runTranscription(transcriber, event.data.audio);
    } catch (error) {
      if (activeDevice !== 'webgpu') throw error;
      post('progress', { message: 'WebGPU transcription failed. Retrying with browser CPU…' });
      forceWasm = true;
      activeDevice = null;
      transcriberPromise = null;
      await transcriber.dispose?.();
      transcriber = await getTranscriber();
      output = await runTranscription(transcriber, event.data.audio);
    }
    const text = String(Array.isArray(output) ? output[0]?.text || '' : output?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Whisper did not detect speech in this recording.');
    post('result', { text });
  } catch (error) {
    post('error', { message: error instanceof Error ? error.message : 'Local Whisper transcription failed.' });
  }
};

export {};
