import { useId } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useVoiceInput } from '../voice/useVoiceInput.ts';
import { MicIcon, StopIcon } from './icons.tsx';

/**
 * Microphone beside a text field: one click to start talking, another to stop. What was said
 * is added to the field, never sent on its own, so it can be read and fixed before sending.
 * Nothing shows when this browser has no way to listen.
 */
export function VoiceButton({
  onText,
  fieldLabel,
}: {
  onText: (text: string) => void;
  fieldLabel: string;
}) {
  const { t } = useI18n();
  const statusId = useId();
  const voice = useVoiceInput(onText);
  if (!voice.engine) return null;

  const { state } = voice;
  const listening = state.status === 'listening';
  const busy = state.status === 'loading' || state.status === 'transcribing';
  const status =
    state.status === 'listening'
      ? t('voice.listening')
      : state.status === 'loading'
        ? t('voice.downloading', { percent: state.percent })
        : state.status === 'transcribing'
          ? t('voice.transcribing')
          : state.status === 'error'
            ? t(`voice.errors.${state.error}`)
            : '';

  return (
    <span className="contents">
      <button
        type="button"
        aria-label={
          listening
            ? t('voice.stop', { field: fieldLabel })
            : t('voice.start', { field: fieldLabel })
        }
        aria-pressed={listening}
        aria-describedby={status ? statusId : undefined}
        title={listening ? t('voice.stopShort') : t('voice.startShort')}
        disabled={busy}
        onClick={listening ? voice.stop : voice.start}
        className={`flex size-11 shrink-0 cursor-pointer items-center justify-center self-start rounded-lg border disabled:cursor-wait disabled:opacity-60 ${
          listening
            ? 'animate-pulse border-danger bg-danger text-accent-text'
            : 'border-line-control text-soft hover:border-accent hover:text-text'
        }`}
      >
        {listening ? <StopIcon /> : <MicIcon />}
      </button>
      <span
        id={statusId}
        role="status"
        className={status ? 'basis-full text-sm text-muted' : 'sr-only'}
      >
        {status}
      </span>
    </span>
  );
}
