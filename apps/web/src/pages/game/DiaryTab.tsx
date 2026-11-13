import type { Playthrough, Session } from '@gamebacklog/shared';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { api, useApiMutation, useSessions } from '../../api.ts';
import { ErrorNote, Loading } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { VoiceButton } from '../../components/VoiceButton.tsx';
import { appendDictation } from '../../voice/engine.ts';

const pad = (value: number) => String(value).padStart(2, '0');
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const localDay = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
/** Noon keeps the calendar day stable whatever the time zone. */
const atNoon = (day: string) => new Date(`${day}T12:00:00`).toISOString();

interface FormValues {
  day: string;
  hours: string;
  minutes: string;
  note: string;
}

function SessionForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  pending: boolean;
  error: unknown;
  onSubmit: (values: { startedAt: string; durationMinutes: number; note: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState(initial);
  const noteId = useId();
  const duration = Number(values.hours || 0) * 60 + Number(values.minutes || 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      startedAt: atNoon(values.day),
      durationMinutes: duration,
      note: values.note.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-base border border-line p-3">
      <div className="flex flex-wrap gap-3">
        <label>
          <span className="label">{t('diary.date')}</span>
          <input
            type="date"
            required
            className="field"
            value={values.day}
            onChange={(event) => setValues({ ...values, day: event.target.value })}
          />
        </label>
        <fieldset>
          <legend className="label">{t('diary.duration')}</legend>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={24}
              aria-label={`${t('diary.duration')} (${t('diary.hours')})`}
              className="field !w-20"
              value={values.hours}
              onChange={(event) => setValues({ ...values, hours: event.target.value })}
            />
            <span className="text-sm text-muted">{t('diary.hours')}</span>
            <input
              type="number"
              min={0}
              max={59}
              aria-label={`${t('diary.duration')} (${t('diary.minutes')})`}
              className="field !w-20"
              value={values.minutes}
              onChange={(event) => setValues({ ...values, minutes: event.target.value })}
            />
            <span className="text-sm text-muted">{t('diary.minutes')}</span>
          </div>
        </fieldset>
      </div>
      <div>
        <label htmlFor={noteId} className="label">
          {t('diary.note')}
        </label>
        <div className="flex flex-wrap gap-2">
          <textarea
            id={noteId}
            className="field min-w-0 flex-1"
            rows={2}
            maxLength={2000}
            placeholder={t('diary.notePlaceholder')}
            value={values.note}
            onChange={(event) => setValues({ ...values, note: event.target.value })}
          />
          <VoiceButton
            fieldLabel={t('diary.note')}
            onText={(text) =>
              setValues((current) => ({
                ...current,
                note: appendDictation(current.note, text, 2000),
              }))
            }
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || duration < 1}>
          {t('app.save')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('app.cancel')}
        </button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

function SessionRow({ session, otherRun }: { session: Session; otherRun: boolean }) {
  const { t, formatDate, formatMinutes } = useI18n();
  const [editing, setEditing] = useState(false);
  const update = useApiMutation((body: Parameters<typeof api.updateSession>[1]) =>
    api.updateSession(session.id, body),
  );
  const remove = useApiMutation(() => api.deleteSession(session.id));

  if (editing) {
    return (
      <li>
        <SessionForm
          initial={{
            day: localDay(session.startedAt),
            hours: String(Math.floor(session.durationMinutes / 60)),
            minutes: String(session.durationMinutes % 60),
            note: session.note ?? '',
          }}
          pending={update.isPending}
          error={update.error}
          onCancel={() => setEditing(false)}
          onSubmit={(values) =>
            update.mutate(
              { ...values, note: values.note || null },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      </li>
    );
  }

  return (
    <li className="grid gap-1 border-b border-line py-3">
      <p className="text-sm">
        <time dateTime={session.startedAt} className="font-medium tabular-nums">
          {formatDate(session.startedAt)}
        </time>
        {' · '}
        {formatMinutes(session.durationMinutes)}
        {session.origin === 'steam' && (
          <span className="text-muted"> · {t('diary.automatic')}</span>
        )}
        {otherRun && <span className="text-muted"> · {t('diary.otherRun')}</span>}
      </p>
      {session.note && <p className="whitespace-pre-wrap">{session.note}</p>}
      <div className="flex gap-4">
        <button type="button" className="btn-quiet" onClick={() => setEditing(true)}>
          {t('app.edit')}
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => {
            if (window.confirm(t('diary.confirmDelete'))) remove.mutate(undefined);
          }}
        >
          {t('app.delete')}
        </button>
      </div>
      <ErrorNote error={remove.error} />
    </li>
  );
}

export function DiaryTab({ entryId, run }: { entryId: string; run: Playthrough }) {
  const { t, formatMinutes } = useI18n();
  const sessions = useSessions(entryId);
  const [adding, setAdding] = useState(false);
  const create = useApiMutation((body: Parameters<typeof api.createSession>[1]) =>
    api.createSession(entryId, body),
  );

  if (sessions.isPending) return <Loading />;
  if (sessions.isError) return <ErrorNote error={sessions.error} />;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg">
          {t('diary.summary', { time: formatMinutes(run.playtimeMinutes ?? 0) })}
        </p>
        {!adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {t('diary.add')}
          </button>
        )}
      </div>

      {adding && (
        <SessionForm
          initial={{ day: today(), hours: '1', minutes: '0', note: '' }}
          pending={create.isPending}
          error={create.error}
          onCancel={() => setAdding(false)}
          onSubmit={(values) =>
            create.mutate(
              { ...values, playthroughId: run.id, note: values.note || undefined },
              { onSuccess: () => setAdding(false) },
            )
          }
        />
      )}

      {sessions.data.items.length === 0 ? (
        <p className="note">{t('diary.empty')}</p>
      ) : (
        <ul className="border-t border-line">
          {sessions.data.items.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              otherRun={session.playthroughId !== null && session.playthroughId !== run.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
