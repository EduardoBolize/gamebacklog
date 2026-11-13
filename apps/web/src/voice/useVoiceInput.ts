import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import {
  browserRecognition,
  browserRecognitionWorks,
  localRecognitionWorks,
  pickEngine,
  readVoicePreference,
  type SpeechRecognitionLike,
  type VoiceEngine,
} from './engine.ts';
import { onModelProgress, transcribeLocally } from './local.ts';

export type VoiceError = 'mic_denied' | 'no_speech' | 'browser_failed' | 'local_failed';

export type VoiceState =
  | { status: 'idle' }
  | { status: 'listening' }
  /** Whisper's model is downloading (first use only). */
  | { status: 'loading'; percent: number }
  | { status: 'transcribing' }
  | { status: 'error'; error: VoiceError };

/** Longest recording, so a forgotten microphone does not record forever. */
const MAX_RECORDING_MS = 90_000;

/**
 * Dictation for one field. `start` listens; `stop` ends it and the words go to `onText`.
 * The browser's engine hands words over as they are recognised; Whisper after the stop.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const { locale } = useI18n();
  const [state, setState] = useState<VoiceState>({ status: 'idle' });
  // Read once per field: the choice in Settings applies the next time a screen opens.
  const [engine] = useState<VoiceEngine | null>(() =>
    pickEngine(readVoicePreference(), {
      browser: browserRecognitionWorks(),
      local: localRecognitionWorks(),
    }),
  );
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const textHandler = useRef(onText);
  useEffect(() => {
    textHandler.current = onText;
  }, [onText]);

  // Stop everything when the field goes away.
  useEffect(
    () => () => {
      recognition.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const startBrowser = useCallback(() => {
    const Recognition = browserRecognition();
    if (!Recognition) return;
    const instance = new Recognition();
    instance.lang = locale === 'en' ? 'en-US' : 'pt-BR';
    instance.continuous = true;
    instance.interimResults = false;
    let heard = false;
    let failed = false;
    instance.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal && result[0]) {
          heard = true;
          textHandler.current(result[0].transcript);
        }
      }
    };
    instance.onerror = (event) => {
      failed = true;
      const error: VoiceError =
        event.error === 'not-allowed'
          ? 'mic_denied'
          : event.error === 'no-speech'
            ? 'no_speech'
            : 'browser_failed';
      setState({ status: 'error', error });
    };
    instance.onend = () => {
      recognition.current = null;
      if (!failed) setState(heard ? { status: 'idle' } : { status: 'error', error: 'no_speech' });
    };
    recognition.current = instance;
    instance.start();
    setState({ status: 'listening' });
  }, [locale]);

  const startLocal = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState({ status: 'error', error: 'mic_denied' });
      return;
    }
    const chunks: Blob[] = [];
    const instance = new MediaRecorder(stream);
    instance.ondataavailable = (event) => chunks.push(event.data);
    instance.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
      const recording = new Blob(chunks, { type: instance.mimeType });
      if (recording.size === 0) {
        setState({ status: 'error', error: 'no_speech' });
        return;
      }
      setState({ status: 'transcribing' });
      const unsubscribe = onModelProgress((percent) =>
        setState(percent === null ? { status: 'transcribing' } : { status: 'loading', percent }),
      );
      try {
        const text = await transcribeLocally(recording, locale);
        if (text) {
          textHandler.current(text);
          setState({ status: 'idle' });
        } else {
          setState({ status: 'error', error: 'no_speech' });
        }
      } catch {
        setState({ status: 'error', error: 'local_failed' });
      } finally {
        unsubscribe();
      }
    };
    recorder.current = instance;
    instance.start();
    setState({ status: 'listening' });
    timer.current = window.setTimeout(() => {
      if (instance.state === 'recording') instance.stop();
    }, MAX_RECORDING_MS);
  }, [locale]);

  const start = useCallback(() => {
    if (engine === 'browser') startBrowser();
    else if (engine === 'local') void startLocal();
  }, [engine, startBrowser, startLocal]);

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    recognition.current?.stop();
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  return { engine, state, start, stop };
}
