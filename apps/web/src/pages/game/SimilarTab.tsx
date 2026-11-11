import { useSimilarCompletion, useSimilarGames } from '../../api-recommendations.ts';
import {
  CatalogNote,
  ExplainBar,
  RecommendationList,
  ShapeSummary,
} from '../../components/Recommendations.tsx';
import { ErrorNote, Loading } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';

function SimilarGames({ entryId }: { entryId: string }) {
  const { t, locale } = useI18n();
  const similar = useSimilarGames(entryId, locale);

  return (
    <section className="grid gap-2">
      <h2 className="section-title">{t('recs.similarTitle')}</h2>
      <p className="note max-w-prose">{t('recs.similarIntro')}</p>
      {similar.isPending && <Loading />}
      <ErrorNote error={similar.error} />
      {similar.data && (
        <>
          <CatalogNote reach={similar.data.catalog} />
          {similar.data.items.length > 0 ? (
            <>
              <ExplainBar request={{ list: 'similar', libraryEntryId: entryId }} />
              <RecommendationList items={similar.data.items} />
            </>
          ) : (
            <p className="note">{t('recs.similarEmpty')}</p>
          )}
        </>
      )}
    </section>
  );
}

function SimilarCompletion({
  entryId,
  onOpenAchievements,
}: {
  entryId: string;
  onOpenAchievements: () => void;
}) {
  const { t, locale } = useI18n();
  const completion = useSimilarCompletion(entryId, locale);

  return (
    <section className="grid gap-2">
      <h2 className="section-title">{t('recs.completionTitle')}</h2>
      <p className="note max-w-prose">{t('recs.completionIntro')}</p>
      {completion.isPending && <Loading />}
      <ErrorNote error={completion.error} />
      {completion.data &&
        (completion.data.shape ? (
          <>
            <p className="text-sm">
              {t('recs.thisGame')} <ShapeSummary shape={completion.data.shape} />
            </p>
            <CatalogNote reach={completion.data.catalog} />
            {completion.data.items.length > 0 ? (
              <>
                <ExplainBar request={{ list: 'completion', libraryEntryId: entryId }} />
                <RecommendationList items={completion.data.items} />
              </>
            ) : (
              <p className="note">{t('recs.completionEmpty')}</p>
            )}
          </>
        ) : (
          <div className="grid justify-items-start gap-2">
            <p className="note">{t('recs.completionNoAchievements')}</p>
            <button type="button" className="btn" onClick={onOpenAchievements}>
              {t('game.tabAchievements')}
            </button>
          </div>
        ))}
    </section>
  );
}

/** "Similar to this game" and "similar to this platinum / 100%", for the game on screen. */
export function SimilarTab({
  entryId,
  onOpenAchievements,
}: {
  entryId: string;
  onOpenAchievements: () => void;
}) {
  return (
    <div className="grid gap-10">
      <SimilarGames entryId={entryId} />
      <SimilarCompletion entryId={entryId} onOpenAchievements={onOpenAchievements} />
    </div>
  );
}
