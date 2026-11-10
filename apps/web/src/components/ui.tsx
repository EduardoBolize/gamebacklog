import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError } from '../api.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';

/** Translates an error from the API into a sentence the user can act on. */
export function useErrorMessage() {
  const { t } = useI18n();
  return (error: unknown): string => {
    if (error instanceof ApiError) {
      const key = `errors.${error.code}`;
      const message = t(key as MessageKey);
      return message === key ? t('errors.generic') : message;
    }
    return t('errors.generic');
  };
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = useErrorMessage();
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {message(error)}
    </p>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <p className="note py-8" role="status">
      {t('app.loading')}
    </p>
  );
}

/** Game cover in the 3:4 ratio. Without an image, a flat panel with the title written on it. */
export function Cover({
  title,
  url,
  className = '',
}: {
  title: string;
  url: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const frame = `aspect-[3/4] w-full overflow-hidden rounded-base border border-line bg-surface ${className}`;
  if (!url || failed) {
    return (
      <div className={`${frame} flex items-center justify-center p-3`}>
        <span className="line-clamp-4 text-center text-sm text-muted">{title}</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${frame} object-cover`}
    />
  );
}

/** Modal built on the native `<dialog>`, which brings focus trapping and Esc for free. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
      className="m-0 h-full max-h-none w-full max-w-none border-line bg-bg p-0 sm:m-auto sm:h-auto sm:max-h-[90vh] sm:w-[min(44rem,92vw)] sm:rounded-base sm:border"
    >
      {open && (
        <div className="flex h-full flex-col sm:max-h-[90vh]">
          <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            <button type="button" className="btn-quiet" onClick={onClose}>
              {t('app.close')}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Editable list of short texts (tags, pros, cons): chips with a remove button, plus an input. */
export function ChipInput({
  label,
  values,
  onChange,
  placeholder,
  removeLabel,
  maxLength = 40,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  removeLabel: (value: string) => string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  function add(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft('');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={inputId} className="text-sm text-muted">
        {label}
      </label>
      {values.map((value) => (
        <span key={value} className="chip">
          {value}
          <button
            type="button"
            aria-label={removeLabel(value)}
            className="cursor-pointer px-1 text-muted hover:text-text"
            onClick={() => onChange(values.filter((item) => item !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <form onSubmit={add} className="inline-flex">
        <input
          id={inputId}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          className="field !min-h-8 w-32 !px-2 !text-sm"
        />
      </form>
    </div>
  );
}

/** Thin horizontal bar for a 0–100 value. Decorative: the number is always printed next to it. */
export function PercentBar({ value }: { value: number }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-full rounded-full bg-surface">
      <span
        className="block h-full rounded-full bg-muted"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}
