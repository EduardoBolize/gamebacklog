import type { AreaChecklistResponse, Playthrough } from '@gamebacklog/shared';
import { useState } from 'react';
import { ApiError, useApiMutation } from '../../api.ts';
import { assistApi, useChecklist, useMap } from '../../api-assist.ts';
import { ErrorNote, Loading } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { AreaMedia } from './AreaMedia.tsx';
import { SourceList } from './ChapterMapSection.tsx';

type Item = AreaChecklistResponse['collectibles'][number];

function ItemList({
  items,
  onToggle,
}: {
  items: Item[];
  onToggle: (item: Item, isCollected: boolean) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) return <p className="note">{t('checklist.emptyGroup')}</p>;
  return (
    <ul className="grid gap-1">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-1">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-accent"
            aria-label={t('checklist.markCollected', { name: item.name })}
            checked={item.isCollected}
            onChange={(event) => onToggle(item, event.target.checked)}
          />
          <span className="text-sm">
            <span className={item.isCollected ? 'text-muted line-through' : 'font-medium'}>
              {item.name}
            </span>
            {item.isMissable && (
              <span className="ml-2 text-danger">{t('checklist.missableTag')}</span>
            )}
            {item.achievementName && (
              <span className="ml-2 text-accent">
                {t('checklist.countsFor', { name: item.achievementName })}
              </span>
            )}
            {item.description && <span className="block text-muted">{item.description}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 100% mode: what there is to collect in one area, and what can be lost for good there.
 * Shown when the playthrough's goal is 100% or all achievements.
 */
export function AreaChecklist({ run }: { run: Playthrough }) {
  const { t, locale } = useI18n();
  const completionist = run.goal !== 'finish';
  const map = useMap(run.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const checklist = useChecklist(run.id, chosen, locale, completionist);
  const generate = useApiMutation(() => assistApi.generateChecklist(run.id, chosen, locale));
  const collect = useApiMutation(({ id, isCollected }: { id: string; isCollected: boolean }) =>
    assistApi.setCollected(run.id, id, isCollected),
  );

  if (!completionist) return <p className="note">{t('checklist.onlyWithGoal')}</p>;
  if (checklist.isPending || map.isPending) return <Loading />;
  if (checklist.isError) {
    const noMap = checklist.error instanceof ApiError && checklist.error.code === 'no_chapter_map';
    return noMap ? (
      <p className="note">{t('checklist.noMap')}</p>
    ) : (
      <ErrorNote error={checklist.error} />
    );
  }

  const data = checklist.data;
  const steps = map.data?.map?.checkpoints ?? [];
  const aiConnected = map.data?.aiConnected ?? false;
  const hasAiItems = data.collectibles.some((item) => item.origin === 'ai');
  const forAchievements = data.collectibles.filter((item) => item.achievementName);
  const forCompletion = data.collectibles.filter((item) => !item.achievementName);
  const toggle = (item: Item, isCollected: boolean) => collect.mutate({ id: item.id, isCollected });
  const somethingToLose =
    data.missableAchievements.length > 0 ||
    data.collectibles.some((item) => item.isMissable && !item.isCollected);

  return (
    <section className="grid gap-4 rounded-base border border-line p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="section-title">{t('checklist.title')}</h2>
        <label className="flex items-center gap-2 text-sm text-muted">
          {t('checklist.area')}
          <select
            className="field sm:!w-auto"
            value={data.checkpoint.id}
            onChange={(event) => setChosen(event.target.value)}
          >
            {steps.map((step) => (
              <option key={step.id} value={step.id}>
                {step.position}. {step.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.nextPointOfNoReturn && somethingToLose && (
        <p role="alert" className="rounded-base border border-danger p-3 font-medium text-danger">
          {t('checklist.pointOfNoReturnAhead', { name: data.nextPointOfNoReturn.name })}
        </p>
      )}

      {/* A list written in another language, or by an older version, is offered for a rewrite
          up front: at the bottom of a long list it went unnoticed. */}
      {!data.generated && aiConnected && hasAiItems && (
        <div className="grid justify-items-start gap-2 rounded-base border border-accent p-3">
          <p className="text-sm">{t('checklist.outdated')}</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={generate.isPending}
            onClick={() => generate.mutate(undefined)}
          >
            {generate.isPending ? t('checklist.generating') : t('checklist.regenerate')}
          </button>
        </div>
      )}

      {data.collectibles.length === 0 && (
        <>
          {data.generated ? (
            <p className="note">{t('checklist.nothingFound')}</p>
          ) : !aiConnected ? (
            <p className="note">{t('checklist.needsAi')}</p>
          ) : (
            <button
              type="button"
              className="btn justify-self-start"
              disabled={generate.isPending}
              onClick={() => generate.mutate(undefined)}
            >
              {generate.isPending ? t('checklist.generating') : t('checklist.generate')}
            </button>
          )}
        </>
      )}

      {(data.collectibles.length > 0 || data.missableAchievements.length > 0) && (
        <div className="grid gap-2">
          <h3 className="section-title">{t('checklist.forAchievements')}</h3>
          <p className="note">{t('checklist.forAchievementsNote')}</p>
          {data.missableAchievements.length > 0 && (
            <div className="grid gap-1">
              <h4 className="label">{t('checklist.missable')}</h4>
              <ul className="grid gap-1 text-sm">
                {data.missableAchievements.map((item) => (
                  <li key={item.id}>
                    <span className="font-medium">{item.name}</span>
                    {item.description && <span className="text-muted"> — {item.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ItemList items={forAchievements} onToggle={toggle} />
        </div>
      )}

      {data.collectibles.length > 0 && (
        <div className="grid gap-2">
          <h3 className="section-title">{t('checklist.forCompletion')}</h3>
          <p className="note">{t('checklist.forCompletionNote')}</p>
          <ItemList items={forCompletion} onToggle={toggle} />
        </div>
      )}

      {data.collectibles.some((item) => item.origin === 'ai') && (
        <p className="note">{t('checklist.unofficial')}</p>
      )}
      <SourceList sources={data.sources} label={t('checklist.sources')} />
      <ErrorNote error={generate.error ?? collect.error} />
      <AreaMedia key={data.checkpoint.id} runId={run.id} checkpointId={data.checkpoint.id} />
    </section>
  );
}
