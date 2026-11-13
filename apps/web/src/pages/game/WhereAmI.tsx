import type {
  Playthrough,
  ReportProgressRequest,
  ReportProgressResponse,
} from '@gamebacklog/shared';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api, useApiMutation, useFunnel } from '../../api.ts';
import { assistApi } from '../../api-assist.ts';
import { ErrorNote, Modal, useErrorMessage } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { VoiceButton } from '../../components/VoiceButton.tsx';
import { appendDictation } from '../../voice/engine.ts';

type Warning = NonNullable<ReportProgressResponse['warning']>;

/**
 * Reports progress and handles the one case where it must not just be saved: a move past a
 * point of no return is shown back to the user first, with what would be lost.
 */
export function useReportProgress(runId: string) {
  const [held, setHeld] = useState<{
    request: ReportProgressRequest;
    warning: Warning;
    /** What to do once the move is saved; kept so confirming finishes the same way. */
    onSaved?: () => void;
  } | null>(null);
  const [last, setLast] = useState<ReportProgressResponse | null>(null);
  const mutation = useApiMutation((request: ReportProgressRequest) =>
    assistApi.reportProgress(runId, request),
  );

  function report(request: ReportProgressRequest, onSaved?: () => void) {
    mutation.mutate(request, {
      onSuccess: (response) => {
        if (!response.saved && response.warning) {
          setHeld({ request, warning: response.warning, onSaved });
          return;
        }
        setHeld(null);
        setLast(response);
        onSaved?.();
      },
    });
  }

  return {
    report,
    last,
    held,
    pending: mutation.isPending,
    error: mutation.error,
    confirm: () => held && report({ ...held.request, confirmPointOfNoReturn: true }, held.onSaved),
    cancel: () => setHeld(null),
  };
}

export function PointOfNoReturnDialog({
  progress,
}: {
  progress: ReturnType<typeof useReportProgress>;
}) {
  const { t } = useI18n();
  const warning = progress.held?.warning;
  const nothing =
    warning?.missableAchievements.length === 0 && warning.missableCollectibles.length === 0;

  return (
    <Modal open={Boolean(warning)} onClose={progress.cancel} title={t('map.warningTitle')}>
      {warning && (
        <div className="grid gap-4">
          <p>
            {nothing
              ? t('map.warningNothing', { name: warning.pointOfNoReturn.name })
              : t('map.warningBody', { name: warning.pointOfNoReturn.name })}
          </p>
          {(
            [
              ['map.warningAchievements', warning.missableAchievements],
              ['map.warningCollectibles', warning.missableCollectibles],
            ] as const
          ).map(
            ([label, items]) =>
              items.length > 0 && (
                <div key={label}>
                  <h3 className="label">{t(label)}</h3>
                  <ul className="list-inside list-disc text-sm">
                    {items.map((item) => (
                      <li key={item.id}>{item.name}</li>
                    ))}
                  </ul>
                </div>
              ),
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={progress.cancel}>
              {t('map.stay')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={progress.pending}
              onClick={progress.confirm}
            >
              {t('map.goAnyway')}
            </button>
          </div>
          <ErrorNote error={progress.error} />
        </div>
      )}
    </Modal>
  );
}

/** What became of the last report: where it placed the run, or why it could not. */
function ProgressNote({ result }: { result: ReportProgressResponse }) {
  const { t } = useI18n();
  const message = useErrorMessage();
  if (!result.checkpoint) {
    const reason = result.aiError
      ? message(new ApiError(result.aiError, 502))
      : result.notPlaced === 'no_match'
        ? t('map.notPlacedNoMatch')
        : t('map.notPlacedNoMap');
    return <p className="note">{t('map.notPlaced', { reason })}</p>;
  }
  return (
    <p className="note">
      {t('map.understood', { name: result.checkpoint.name })}{' '}
      {result.completed.length > 0 &&
        `${t('map.completed', { names: result.completed.map((step) => step.name).join(', ') })} `}
      {result.resolvedBy === 'local_match' && t('map.resolvedLocal')}
      {result.resolvedBy === 'ai' && t('map.resolvedAi')}
    </p>
  );
}

/** "Where am I?": free text, resolved to a step of the chapter map when there is one. */
export function WhereAmI({ run }: { run: Playthrough }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const inputId = useId();
  const funnel = useFunnel(run.id);
  const progress = useReportProgress(run.id);
  const reach = useApiMutation((achievementId: string) =>
    api.setAchievementUnlocked(run.id, achievementId, true),
  );
  const milestones = funnel.data?.milestones ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    progress.report({ rawText: text.trim(), locale }, () => setText(''));
  }

  return (
    <section className="grid gap-2">
      <h2 className="section-title">
        <label htmlFor={inputId}>{t('game.whereAmI')}</label>
      </h2>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          id={inputId}
          className="field min-w-0 flex-1 basis-60"
          maxLength={500}
          placeholder={t('game.whereAmIPlaceholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <VoiceButton
          fieldLabel={t('game.whereAmI')}
          onText={(dictated) => setText((current) => appendDictation(current, dictated, 500))}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={progress.pending || !text.trim()}
        >
          {t('app.save')}
        </button>
      </form>
      <div aria-live="polite">
        {progress.last && !text && <ProgressNote result={progress.last} />}
      </div>
      {milestones.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {t('game.lastMilestone')}
          <select
            className="field sm:!w-auto"
            value={funnel.data?.currentMilestoneId ?? ''}
            onChange={(event) => event.target.value && reach.mutate(event.target.value)}
          >
            <option value="">{t('game.noMilestone')}</option>
            {milestones.map((milestone) => (
              <option key={milestone.achievementId} value={milestone.achievementId}>
                {milestone.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ErrorNote error={progress.held ? null : (progress.error ?? reach.error)} />
      <PointOfNoReturnDialog progress={progress} />
    </section>
  );
}
