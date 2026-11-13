/**
 * Which speech-to-text engine to use. Two exist:
 *
 * - `browser`: the browser's own recognition (Web Speech API). Instant and free, but the audio
 *   goes to the browser maker's servers (Google in Chrome, Microsoft in Edge), and Brave ships
 *   it switched off.
 * - `local`: Whisper running in this browser through Transformers.js. Nothing leaves the PC;
 *   the model is downloaded once (about 80 MB) and kept in the browser's cache.
 */
export const VOICE_ENGINES = ['auto', 'browser', 'local'] as const;
export type VoicePreference = (typeof VOICE_ENGINES)[number];
export type VoiceEngine = Exclude<VoicePreference, 'auto'>;

const STORAGE_KEY = 'gamebacklog.voice';

/** A per-device choice (it depends on the browser), so it lives in this browser only. */
export function readVoicePreference(): VoicePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return VOICE_ENGINES.includes(value as VoicePreference) ? (value as VoicePreference) : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeVoicePreference(value: VoicePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

// --- The browser's recognition (not in TypeScript's DOM types yet) -----------------------

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function browserRecognition(): SpeechRecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Brave exposes the API but its servers refuse it, so it never counts as available there. */
const isBrave = () => 'brave' in navigator;

export function browserRecognitionWorks(): boolean {
  return browserRecognition() !== null && !isBrave();
}

export function localRecognitionWorks(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    'getUserMedia' in (navigator.mediaDevices ?? {})
  );
}

/** The engine for a preference: "auto" takes the browser's when it works, Whisper otherwise. */
export function pickEngine(
  preference: VoicePreference,
  available: { browser: boolean; local: boolean },
): VoiceEngine | null {
  if (preference === 'browser') return available.browser ? 'browser' : null;
  if (preference === 'local') return available.local ? 'local' : null;
  if (available.browser) return 'browser';
  return available.local ? 'local' : null;
}

/** Joins dictated text to what is already in the field, with one space between them. */
export function appendDictation(current: string, dictated: string, maxLength: number): string {
  const words = dictated.trim();
  if (!words) return current;
  const joined = current.trim() ? `${current.trimEnd()} ${words}` : words;
  return joined.slice(0, maxLength);
}
