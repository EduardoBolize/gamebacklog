import type { WorkerMessage, WorkerRequest } from './whisper.worker.ts';

/** Whisper reads mono audio at 16 kHz. */
const SAMPLE_RATE = 16_000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: Error) => void }
>();
const progressListeners = new Set<(percent: number | null) => void>();

/** One worker for the whole page: the model is loaded once, whichever field asks first. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'progress') {
      for (const listener of progressListeners) listener(message.percent);
    } else if (message.type === 'ready') {
      for (const listener of progressListeners) listener(null);
    } else {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.type === 'result') waiting?.resolve(message.text);
      else waiting?.reject(new Error(message.message));
    }
  };
  return worker;
}

/** Follows the model download; `null` means it is done (or not happening). */
export function onModelProgress(listener: (percent: number | null) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** Turns what the microphone recorded into the samples Whisper wants. */
async function toSamples(recording: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    // Decoding into a 16 kHz context also resamples.
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i++)
        mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / decoded.numberOfChannels;
    }
    return mono;
  } finally {
    void context.close();
  }
}

export async function transcribeLocally(recording: Blob, locale: 'pt-BR' | 'en'): Promise<string> {
  const audio = await toSamples(recording);
  const id = nextId++;
  const request: WorkerRequest = {
    id,
    audio,
    language: locale === 'en' ? 'english' : 'portuguese',
  };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request, [audio.buffer]);
  });
}
