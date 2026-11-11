import type {
  AchievementShape,
  CatalogReach,
  ExplainRecommendationsRequest,
  RecommendationReason,
  RecommendedGame,
} from '@gamebacklog/shared';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { api, useApiMutation } from '../api.ts';
import { useAi } from '../api-assist.ts';
import { recommendationsApi } from '../api-recommendations.ts';
import { useI18n } from '../i18n/index.tsx';
import { Cover, ErrorNote } from './ui.tsx';

/** "A, B and C" in the current language. */
function useListFormat() {
  const { locale } = useI18n();
  return useMemo(() => {
    const format = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
    return (values: string[]) => format.format(values);
  }, [locale]);
}

export function ShapeSummary({ shape }: { shape: AchievementShape }) {
  const { t, tn, formatNumber } = useI18n();
  return (
    <>
      {[
        tn('recs.shapeCount', shape.count),
        shape.medianPercent !== null &&
          t('recs.shapeMedian', { percent: formatNumber(shape.medianPercent) }),
        shape.rarestPercent !== null &&
          t('recs.shapeRarest', { percent: formatNumber(shape.rarestPercent) }),
      ]
        .filter(Boolean)
        .join(' · ')}
    </>
  );
}

function Reason({ reason }: { reason: RecommendationReason }) {
  const { t } = useI18n();
  const list = useListFormat();
  if (reason.weight < 0) return <li>{t('recs.reasonAvoided', { value: reason.value })}</li>;
  return (
    <li>
      {reason.because.length > 0
        ? t('recs.reasonLiked', { value: reason.value, games: list(reason.because) })
        : t('recs.reasonLikedPlain', { value: reason.value })}
    </li>
  );
}

function AddButtons({ igdbId }: { igdbId: string }) {
  const { t } = useI18n();
  const add = useApiMutation((status: 'backlog' | 'wishlist') =>
    api.addGame({ status, game: { kind: 'igdb', externalId: igdbId } }),
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn"
        disabled={add.isPending}
        onClick={() => add.mutate('backlog')}
      >
        + {t('nav.backlog')}
      </button>
      <button
        type="button"
        className="btn"
        disabled={add.isPending}
        onClick={() => add.mutate('wishlist')}
      >
        + {t('nav.wishlist')}
      </button>
      <ErrorNote error={add.error} />
    </div>
  );
}

function Item({ item }: { item: RecommendedGame }) {
  const { t } = useI18n();
  const list = useListFormat();
  const meta = [item.releaseYear, item.genres.slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  const numbers = [
    item.similarity !== null && t('recs.similarity', { percent: item.similarity }),
    item.affinity !== null && t('recs.affinity', { percent: item.affinity }),
  ].filter(Boolean);

  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 border-b border-line py-4 last:border-b-0 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <Cover title={item.title} url={item.coverUrl} />
      <div className="grid content-start gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h3 className="text-base">
            {item.libraryEntryId ? (
              <Link to={`/games/${item.libraryEntryId}`} className="link">
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </h3>
          {numbers.length > 0 && (
            <span className="text-sm tabular-nums text-muted">{numbers.join(' · ')}</span>
          )}
        </div>
        <p className="note">
          {[meta, item.status && t(`status.${item.status}`)].filter(Boolean).join(' · ')}
        </p>

        {item.line && <p className="max-w-prose">{item.line}</p>}

        <ul className="note grid max-w-prose gap-0.5">
          {item.shared.length > 0 && <li>{t('recs.shared', { values: list(item.shared) })}</li>}
          {item.listedBySource && <li>{t('recs.listedByIgdb')}</li>}
          {item.shape && (
            <li>
              <ShapeSummary shape={item.shape} />
            </li>
          )}
          {item.playedPercent !== null && (
            <li>{t('recs.played', { percent: item.playedPercent })}</li>
          )}
          {item.reasons.map((reason) => (
            <Reason key={`${reason.dimension}:${reason.value}`} reason={reason} />
          ))}
        </ul>

        {!item.libraryEntryId && item.igdbId && <AddButtons igdbId={item.igdbId} />}
        {item.source?.url && (
          <p className="note">
            <a href={item.source.url} target="_blank" rel="noreferrer" className="link">
              {t('app.source', { source: t(`sourceName.${item.source.origin}`) })}
            </a>
          </p>
        )}
      </div>
    </li>
  );
}

export function RecommendationList({ items }: { items: RecommendedGame[] }) {
  return (
    <ul>
      {items.map((item) => (
        <Item key={item.key} item={item} />
      ))}
    </ul>
  );
}

/** What the catalog could not add to a list, said once and without alarm. */
export function CatalogNote({ reach }: { reach: CatalogReach }) {
  const { t } = useI18n();
  if (reach === 'ok') return null;
  return (
    <p className="note">
      {t(`recs.catalog.${reach}`)}{' '}
      {reach === 'not_configured' && (
        <Link to="/settings" className="link">
          {t('nav.settings')}
        </Link>
      )}
    </p>
  );
}

/**
 * The one optional AI step: a line of text per game, all in a single request. The lists are
 * complete without it, so with no AI connected this is only a quiet invitation.
 */
export function ExplainBar({
  request,
  disabled,
}: {
  request: Omit<ExplainRecommendationsRequest, 'locale'>;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const ai = useAi();
  const explain = useApiMutation(() => recommendationsApi.explain({ ...request, locale }));

  if (disabled || ai.isPending) return null;
  if (!ai.data?.activeProviderId) {
    return (
      <p className="note">
        {t('recs.explainLocked')}{' '}
        <Link to="/settings#ai" className="link">
          {t('recs.connectAi')}
        </Link>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <button
        type="button"
        className="btn"
        disabled={explain.isPending}
        onClick={() => explain.mutate(undefined)}
      >
        {explain.isPending ? t('recs.explaining') : t('recs.explain')}
      </button>
      <span className="note" aria-live="polite">
        {explain.data
          ? explain.data.cached
            ? t('hintLadder.cached')
            : t('recs.explained')
          : t('recs.explainHint')}
      </span>
      <ErrorNote error={explain.error} />
    </div>
  );
}
