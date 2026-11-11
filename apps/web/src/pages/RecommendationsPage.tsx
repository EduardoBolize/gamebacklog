import { TASTE_DIMENSIONS, type TasteProfileResponse } from '@gamebacklog/shared';
import { useSearchParams } from 'react-router';
import { useFavoriteGenre, usePlayNext, useTasteProfile } from '../api-recommendations.ts';
import { CatalogNote, ExplainBar, RecommendationList } from '../components/Recommendations.tsx';
import { useAddGame } from '../components/Shell.tsx';
import { ErrorNote, Loading } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

const TABS = ['play-next', 'genre'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL = { 'play-next': 'recs.tabPlayNext', genre: 'recs.tabGenre' } as const;

function PlayNextTab() {
  const { t, locale } = useI18n();
  const addGame = useAddGame();
  const playNext = usePlayNext(locale);

  if (playNext.isPending) return <Loading />;
  if (playNext.isError) return <ErrorNote error={playNext.error} />;
  const { profileReady, backlog, resume } = playNext.data;

  if (backlog.length === 0 && resume.length === 0) {
    return (
      <div className="grid justify-items-start gap-3 py-6">
        <p className="text-muted">{t('recs.backlogEmpty')}</p>
        <button type="button" className="btn btn-primary" onClick={() => addGame.open('backlog')}>
          {t('nav.backlog')}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <p className="note max-w-prose">
        {profileReady ? t('recs.playNextIntro') : t('recs.profileEmpty')}
      </p>
      <ExplainBar request={{ list: 'play_next' }} disabled={!profileReady} />

      {backlog.length > 0 && (
        <section className="grid gap-1">
          <h2 className="section-title">{t('recs.fromBacklog')}</h2>
          <RecommendationList items={backlog} />
        </section>
      )}
      {resume.length > 0 && (
        <section className="grid gap-1">
          <h2 className="section-title">{t('recs.worthResuming')}</h2>
          <p className="note max-w-prose">{t('recs.worthResumingIntro')}</p>
          <RecommendationList items={resume} />
        </section>
      )}
    </div>
  );
}

function GenreTab() {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const requested = params.get('genre') ?? '';
  const result = useFavoriteGenre(requested, locale);

  if (result.isPending) return <Loading />;
  if (result.isError) return <ErrorNote error={result.error} />;
  const { genre, genres, catalog, inLibrary, discover } = result.data;

  if (!genre) return <p className="py-6 text-muted">{t('recs.genreEmpty')}</p>;

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {t('recs.genre')}
          <select
            className="field sm:!w-auto"
            value={genre}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              next.set('genre', event.target.value);
              setParams(next, { replace: true });
            }}
          >
            {genres.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <p className="note max-w-prose">{t('recs.genreIntro')}</p>
        <ExplainBar
          request={{ list: 'genre', genre }}
          disabled={inLibrary.length + discover.length === 0}
        />
      </div>

      <section className="grid gap-1">
        <h2 className="section-title">{t('recs.inLibrary')}</h2>
        {inLibrary.length > 0 ? (
          <RecommendationList items={inLibrary} />
        ) : (
          <p className="note">{t('recs.inLibraryEmpty', { genre })}</p>
        )}
      </section>

      <section className="grid gap-1">
        <h2 className="section-title">{t('recs.discover')}</h2>
        <CatalogNote reach={catalog} />
        {discover.length > 0 ? (
          <RecommendationList items={discover} />
        ) : (
          catalog === 'ok' && <p className="note">{t('recs.discoverEmpty')}</p>
        )}
      </section>
    </div>
  );
}

function TasteProfile({ profile }: { profile: TasteProfileResponse }) {
  const { t, tn } = useI18n();
  const withData = TASTE_DIMENSIONS.map((dimension) =>
    profile.dimensions.find((item) => item.dimension === dimension),
  ).filter((item) => item !== undefined && item.liked.length + item.disliked.length > 0);

  return (
    <details className="border-t border-line pt-4">
      <summary className="text-sm text-muted">{t('recs.profileTitle')}</summary>
      <div className="mt-3 grid gap-4">
        <p className="note max-w-prose">
          {t('recs.profileIntro')} {tn('recs.profileBasis', profile.signalGames)}{' '}
          {tn('recs.profileRated', profile.ratedGames)}
        </p>
        {withData.length === 0 && <p className="note">{t('recs.profileEmpty')}</p>}
        <dl className="grid gap-3">
          {withData.map(
            (item) =>
              item && (
                <div key={item.dimension} className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <dt className="text-sm text-muted">{t(`recs.dimension.${item.dimension}`)}</dt>
                  <dd className="grid gap-1 text-sm">
                    {item.liked.length > 0 && (
                      <span>{item.liked.map((feature) => feature.value).join(' · ')}</span>
                    )}
                    {item.disliked.length > 0 && (
                      <span className="text-muted">
                        {t('recs.profileAvoids', {
                          values: item.disliked.map((feature) => feature.value).join(' · '),
                        })}
                      </span>
                    )}
                  </dd>
                </div>
              ),
          )}
        </dl>
      </div>
    </details>
  );
}

export function RecommendationsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const profile = useTasteProfile();
  const tab: Tab = TABS.find((option) => option === params.get('tab')) ?? 'play-next';

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl">{t('recs.title')}</h1>

      <nav
        aria-label={t('recs.tabs')}
        className="-mx-4 overflow-x-auto overflow-y-hidden border-b border-line px-4"
      >
        <ul className="flex gap-6 whitespace-nowrap">
          {TABS.map((option) => (
            <li key={option}>
              <button
                type="button"
                aria-current={tab === option ? 'page' : undefined}
                onClick={() =>
                  setParams(option === 'play-next' ? {} : { tab: option }, { replace: true })
                }
                className={`-mb-px min-h-11 cursor-pointer border-b-2 text-sm ${
                  tab === option
                    ? 'border-accent font-semibold'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {t(TAB_LABEL[option])}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'play-next' ? <PlayNextTab /> : <GenreTab />}
      {profile.data && <TasteProfile profile={profile.data} />}
    </div>
  );
}
