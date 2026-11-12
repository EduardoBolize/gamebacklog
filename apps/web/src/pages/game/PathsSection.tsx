import type { PathWarning, PathsResponse } from '@gamebacklog/shared';
import { useEffect, useRef } from 'react';
import { useApiMutation } from '../../api.ts';
import { assistApi, usePaths } from '../../api-assist.ts';
import { ErrorNote } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { SourceList } from './ChapterMapSection.tsx';

function Warnings({ items }: { items: PathWarning[] }) {
  const { t } = useI18n();
  if (items.length === 0) return <p className="note">{t('paths.nothing')}</p>;
  return (
    <ul className="grid gap-1.5 text-sm">
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.name}-${index}`}>
          <span
            className={`mr-2 text-xs font-semibold uppercase tracking-wide ${item.kind === 'point_of_no_return' ? 'text-danger' : 'text-accent'}`}
          >
            {t(`paths.kind.${item.kind}`)}
          </span>
          <span className="font-medium">{item.name}</span>
          <span className="text-muted"> — {item.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** Warnings about the paths ahead, for the achievements tab: from the cache only, never the AI. */
export function PathWarningsBanner({ runId }: { runId: string }) {
  const { t, locale } = useI18n();
  const paths = usePaths(runId, locale);
  const data = paths.data;
  if (!data?.analysis || !data.current) return null;
  const optionName = (id: string) => data.options.find((option) => option.id === id)?.name ?? '';
  const groups = [
    {
      title: t('paths.beforeLeaving', { name: data.current.name }),
      items: data.analysis.beforeLeaving,
    },
    ...data.analysis.paths.map((path) => ({
      title: t('paths.goingTo', { name: optionName(path.checkpointId) }),
      items: path.warnings,
    })),
  ].filter((group) => group.items.length > 0);
  if (groups.length === 0) return null;

  return (
    <section className="grid gap-3 rounded-base border border-accent p-4">
      <h2 className="section-title">{t('paths.banner', { name: data.current.name })}</h2>
      {groups.map((group) => (
        <div key={group.title} className="grid gap-1">
          <h3 className="label">{group.title}</h3>
          <Warnings items={group.items} />
        </div>
      ))}
    </section>
  );
}

/** Achievement IDs the cached reading of the paths warns about. */
export function useWarnedAchievements(runId: string): ReadonlySet<string> {
  const { locale } = useI18n();
  const analysis = usePaths(runId, locale).data?.analysis;
  const ids = new Set<string>();
  for (const item of [
    ...(analysis?.beforeLeaving ?? []),
    ...(analysis?.paths.flatMap((path) => path.warnings) ?? []),
  ]) {
    if (item.achievementId) ids.add(item.achievementId);
  }
  return ids;
}

/**
 * "Paths from here": the places the route says come next, free, and on request the AI's
 * reading of what each of them could make the player miss. After the player moves on this
 * page, the reading is asked for by itself.
 */
export function PathsSection({
  runId,
  onMove,
}: {
  runId: string;
  onMove: (checkpointId: string) => void;
}) {
  const { t, locale } = useI18n();
  const paths = usePaths(runId, locale);
  const analyze = useApiMutation(() => assistApi.analyzePaths(runId, locale));
  const data: PathsResponse | undefined = paths.data;
  const currentId = data?.current?.id ?? null;
  const firstSeen = useRef<string | null | undefined>(undefined);

  // Reading the paths spends tokens, so it only starts by itself when the player just moved.
  const { mutate, isPending } = analyze;
  useEffect(() => {
    if (!data) return;
    if (firstSeen.current === undefined) {
      firstSeen.current = currentId;
      return;
    }
    if (
      currentId &&
      currentId !== firstSeen.current &&
      data.aiConnected &&
      !data.analysis &&
      !isPending
    ) {
      firstSeen.current = currentId;
      mutate(undefined);
    }
  }, [data, currentId, mutate, isPending]);

  if (!data) return null;
  const analysis = data.analysis;

  return (
    <section className="grid gap-3" aria-live="polite">
      <h2 className="section-title">{t('paths.title')}</h2>
      {!data.current ? (
        <p className="text-muted">{t('paths.needPosition')}</p>
      ) : (
        <>
          {data.options.length === 0 ? (
            <p className="text-muted">{t('paths.none', { name: data.current.name })}</p>
          ) : (
            <>
              <p>{t('paths.from', { name: data.current.name })}</p>
              <ul className="grid gap-3">
                {data.options.map((option) => {
                  const reading = analysis?.paths.find((path) => path.checkpointId === option.id);
                  return (
                    <li key={option.id} className="grid gap-1 border-b border-line pb-3">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-semibold">{option.name}</span>
                        {option.requirement && (
                          <span className="note">
                            {t('map.needs', { name: option.requirement })}
                          </span>
                        )}
                        {option.isPointOfNoReturn && (
                          <span className="text-sm text-danger">{t('map.pointOfNoReturn')}</span>
                        )}
                        <button
                          type="button"
                          className="btn-quiet ml-auto"
                          onClick={() => onMove(option.id)}
                        >
                          {t('map.setHere')}
                        </button>
                      </div>
                      {reading?.howToGetThere && <p className="text-sm">{reading.howToGetThere}</p>}
                      {reading && reading.warnings.length > 0 && (
                        <Warnings items={reading.warnings} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {analysis && analysis.beforeLeaving.length > 0 && (
            <div className="grid gap-1">
              <h3 className="label">{t('paths.beforeLeaving', { name: data.current.name })}</h3>
              <Warnings items={analysis.beforeLeaving} />
            </div>
          )}

          {analysis ? (
            <>
              <SourceList sources={analysis.sources} label={t('map.sources')} />
              {analysis.cached && <p className="note">{t('paths.cached')}</p>}
            </>
          ) : data.aiConnected ? (
            <button
              type="button"
              className="btn justify-self-start"
              disabled={analyze.isPending}
              onClick={() => analyze.mutate(undefined)}
            >
              {analyze.isPending ? t('paths.analyzing') : t('paths.analyze')}
            </button>
          ) : (
            <p className="note">{t('paths.aiOnly')}</p>
          )}
          <ErrorNote error={analyze.error} />
        </>
      )}
    </section>
  );
}
