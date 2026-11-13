/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

/**
 * Whisper in a worker, so the page stays responsive while it thinks. The model comes from the
 * Hugging Face Hub the first time and from the browser's cache after that.
 */

export const WHISPER_MODEL = 'onnx-community/whisper-base';

export type WorkerRequest = { id: number; audio: Float32Array; language: 'portuguese' | 'english' };
export type WorkerMessage =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; message: string };

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const post = (message: WorkerMessage) => self.postMessage(message);

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  loading ??= (async () => {
    // Several files download at once; the bar follows the bytes of all of them together.
    const files = new Map<string, { loaded: number; total: number }>();
    const transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (event: {
        status: string;
        file?: string;
        loaded?: number;
        total?: number;
      }) => {
        if (event.status !== 'progress' || !event.file || !event.total) return;
        files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
        let loaded = 0;
        let total = 0;
        for (const file of files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        post({ type: 'progress', percent: Math.min(99, Math.floor((loaded / total) * 100)) });
      },
    });
    post({ type: 'ready' });
    return transcriber;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, audio, language } = event.data;
  try {
    const transcriber = await load();
    const output: { text: string } | { text: string }[] = await transcriber(audio, {
      language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = [output]
      .flat()
      .map((part) => part.text)
      .join(' ');
    post({ type: 'result', id, text: text.trim() });
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
