import {
  REVIEW_SUBSCORE_KEYS,
  type Playthrough,
  type Review,
  type SaveReviewRequest,
} from '@gamebacklog/shared';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { api, useApiMutation, useReviews } from '../../api.ts';
import { ChipInput, ErrorNote, Loading } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';

const SCORE_KEYS = ['score', ...REVIEW_SUBSCORE_KEYS] as const;
type ScoreKey = (typeof SCORE_KEYS)[number];

const LABEL: Record<ScoreKey, Parameters<ReturnType<typeof useI18n>['t']>[0]> = {
  score: 'review.overall',
  difficultyScore: 'review.difficultyScore',
  storyScore: 'review.storyScore',
  gameplayScore: 'review.gameplayScore',
  levelDesignScore: 'review.levelDesignScore',
  soundtrackScore: 'review.soundtrackScore',
  visualsScore: 'review.visualsScore',
  perceivedLengthScore: 'review.perceivedLengthScore',
};

/** A 0–10 score in half points: a number field and a slider bound to the same value. */
function ScoreField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_5rem_minmax(0,1fr)_auto]">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={10}
        step={0.5}
        inputMode="decimal"
        className="field tabular-nums"
        placeholder={t('app.none')}
        value={value ?? ''}
        onChange={(event) => {
          if (event.target.value === '') return onChange(null);
          const rounded = Math.round(Number(event.target.value) * 2) / 2;
          onChange(Math.min(10, Math.max(0, rounded)));
        }}
      />
      <input
        type="range"
        min={0}
        max={10}
        step={0.5}
        tabIndex={-1}
        aria-hidden="true"
        className="col-span-2 w-full accent-accent sm:col-span-1"
        value={value ?? 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <button
        type="button"
        className="btn-quiet col-span-2 justify-self-start sm:col-span-1"
        aria-label={t('review.clearScore', { label })}
        disabled={value === null}
        onClick={() => onChange(null)}
      >
        ×
      </button>
    </div>
  );
}

function emptyDraft(playthroughId: string | null, run: Playthrough): SaveReviewRequest {
  return {
    playthroughId,
    score: null,
    difficultyScore: null,
    storyScore: null,
    gameplayScore: null,
    levelDesignScore: null,
    soundtrackScore: null,
    visualsScore: null,
    perceivedLengthScore: null,
    body: null,
    pros: [],
    cons: [],
    hasSpoilers: false,
    // Starts from the hours logged on the run; the user can change it.
    timeToBeatMinutes: playthroughId ? run.playtimeMinutes : null,
  };
}

function ReviewForm({
  entryId,
  initial,
  onDone,
}: {
  entryId: string;
  initial: SaveReviewRequest;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const save = useApiMutation((body: SaveReviewRequest) => api.saveReview(entryId, body));

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ ...draft, body: draft.body?.trim() || null }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-3">
        {SCORE_KEYS.map((key) => (
          <ScoreField
            key={key}
            label={t(LABEL[key])}
            value={draft[key]}
            onChange={(value) => setDraft({ ...draft, [key]: value })}
          />
        ))}
      </div>

      <label>
        <span className="label">{t('review.body')}</span>
        <textarea
          className="field"
          rows={6}
          maxLength={20000}
          value={draft.body ?? ''}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
      </label>

      <ChipInput
        label={t('review.pros')}
        values={draft.pros}
        maxLength={120}
        placeholder={t('review.addItem')}
        removeLabel={(item) => t('review.removeItem', { item })}
        onChange={(pros) => setDraft({ ...draft, pros })}
      />
      <ChipInput
        label={t('review.cons')}
        values={draft.cons}
        maxLength={120}
        placeholder={t('review.addItem')}
        removeLabel={(item) => t('review.removeItem', { item })}
        onChange={(cons) => setDraft({ ...draft, cons })}
      />

      <div className="flex flex-wrap items-end gap-6">
        <label>
          <span className="label">
            {t('review.timeToBeat')} ({t('game.hours')})
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            className="field !w-28"
            value={draft.timeToBeatMinutes === null ? '' : draft.timeToBeatMinutes / 60}
            onChange={(event) =>
              setDraft({
                ...draft,
                timeToBeatMinutes:
                  event.target.value === '' ? null : Math.round(Number(event.target.value) * 60),
              })
            }
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input
            type="checkbox"
            className="accent-accent"
            checked={draft.hasSpoilers}
            onChange={(event) => setDraft({ ...draft, hasSpoilers: event.target.checked })}
          />
          {t('review.hasSpoilers')}
        </label>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t('review.save')}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t('app.cancel')}
        </button>
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}

function ReviewView({ review, onEdit }: { review: Review; onEdit: () => void }) {
  const { t, formatNumber, formatDate, formatMinutes } = useI18n();
  const [showSpoilers, setShowSpoilers] = useState(false);
  const remove = useApiMutation(() => api.deleteReview(review.id));
  const hidden = review.hasSpoilers && !showSpoilers;

  return (
    <article className="grid gap-5">
      <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {SCORE_KEYS.map((key) => (
          <div
            key={key}
            className={`flex items-baseline justify-between gap-4 border-b border-line py-1 ${
              key === 'score' ? 'text-lg font-semibold sm:col-span-2' : 'text-sm'
            }`}
          >
            <dt>{t(LABEL[key])}</dt>
            <dd className="tabular-nums">
              {review[key] === null ? (
                <span className="font-normal text-muted">{t('review.notRated')}</span>
              ) : (
                formatNumber(review[key])
              )}
            </dd>
          </div>
        ))}
      </dl>

      {hidden ? (
        <div className="grid justify-items-start gap-2 rounded-base border border-line p-3">
          <p className="note">{t('review.spoilerHidden')}</p>
          <button type="button" className="btn" onClick={() => setShowSpoilers(true)}>
            {t('review.showSpoilers')}
          </button>
        </div>
      ) : (
        <>
          {review.body && <p className="max-w-prose whitespace-pre-wrap">{review.body}</p>}
          {(review.pros.length > 0 || review.cons.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['review.pros', review.pros],
                  ['review.cons', review.cons],
                ] as const
              ).map(
                ([label, list]) =>
                  list.length > 0 && (
                    <section key={label}>
                      <h3 className="label">{t(label)}</h3>
                      <ul className="list-inside list-disc text-sm">
                        {list.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ),
              )}
            </div>
          )}
        </>
      )}

      <p className="note">
        {t('review.reviewedOn', { date: formatDate(review.reviewedAt) })}
        {review.timeToBeatMinutes !== null &&
          ` · ${t('review.timeToBeat')}: ${formatMinutes(review.timeToBeatMinutes)}`}
      </p>
      <div className="flex gap-4">
        <button type="button" className="btn" onClick={onEdit}>
          {t('app.edit')}
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => {
            if (window.confirm(t('review.confirmDelete'))) remove.mutate(undefined);
          }}
        >
          {t('app.delete')}
        </button>
      </div>
      <ErrorNote error={remove.error} />
    </article>
  );
}

export function ReviewTab({ entryId, run }: { entryId: string; run: Playthrough }) {
  const { t } = useI18n();
  const reviews = useReviews(entryId);
  const [scope, setScope] = useState<'run' | 'game'>('run');
  const [editing, setEditing] = useState(false);

  if (reviews.isPending) return <Loading />;
  if (reviews.isError) return <ErrorNote error={reviews.error} />;

  const playthroughId = scope === 'run' ? run.id : null;
  const review = reviews.data.items.find((item) => item.playthroughId === playthroughId);

  return (
    <div className="grid gap-5">
      <fieldset>
        <legend className="label">{t('review.scope')}</legend>
        <div className="flex flex-wrap gap-x-5">
          {(
            [
              ['run', 'review.thisRun'],
              ['game', 'review.wholeGame'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <input
                type="radio"
                name="review-scope"
                className="accent-accent"
                checked={scope === value}
                onChange={() => {
                  setScope(value);
                  setEditing(false);
                }}
              />
              {t(label)}
            </label>
          ))}
        </div>
      </fieldset>

      {editing ? (
        <ReviewForm
          key={`${playthroughId}-${review?.id}`}
          entryId={entryId}
          initial={review ? { ...review, playthroughId } : emptyDraft(playthroughId, run)}
          onDone={() => setEditing(false)}
        />
      ) : review ? (
        <ReviewView review={review} onEdit={() => setEditing(true)} />
      ) : (
        <div className="grid justify-items-start gap-3">
          <p className="note">{t('review.empty')}</p>
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
            {t('review.write')}
          </button>
        </div>
      )}
    </div>
  );
}
