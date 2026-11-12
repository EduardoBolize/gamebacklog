import type { InteractiveMapRef } from '@gamebacklog/shared';
import { useState } from 'react';
import { useGameMaps, useInteractiveMap } from '../../api-assist.ts';
import { ErrorNote } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { InteractiveMapView } from './InteractiveMapView.tsx';

/**
 * The game's maps as its wikis have them: the interactive map first, when a wiki has one, and
 * map images after. Everything links back to the wiki it came from. No AI.
 */
export function MapTab({ runId }: { runId: string }) {
  const { t } = useI18n();
  const maps = useGameMaps(runId);
  const [picked, setPicked] = useState<string | null>(null);
  const refs = maps.data?.interactive ?? [];
  const keyOf = (ref: InteractiveMapRef) => `${ref.wikiUrl}|${ref.page}`;
  const chosen = refs.find((ref) => keyOf(ref) === picked) ?? refs[0] ?? null;
  const map = useInteractiveMap(runId, chosen);

  if (maps.isPending) {
    return (
      <p className="note py-8" role="status">
        {t('gameMaps.searching')}
      </p>
    );
  }
  if (maps.isError) return <p className="text-muted">{t('gameMaps.failed')}</p>;
  const data = maps.data;

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="section-title">{t('gameMaps.interactive')}</h2>
          {refs.length > 1 && chosen && (
            <label className="flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto">
              <span className="text-muted">{t('gameMaps.pick')}</span>
              <select
                className="field min-w-0 flex-1 sm:flex-none sm:!w-auto"
                value={keyOf(chosen)}
                onChange={(event) => setPicked(event.target.value)}
              >
                {refs.map((ref) => (
                  <option key={keyOf(ref)} value={keyOf(ref)}>
                    {ref.title} — {ref.wikiName}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!chosen && <p className="text-muted">{t('gameMaps.noInteractive')}</p>}
        {chosen && map.isPending && (
          <p className="note" role="status">
            {t('gameMaps.loadingMap')}
          </p>
        )}
        {chosen && map.isError && <ErrorNote error={map.error} />}
        {chosen && map.data && <InteractiveMapView key={keyOf(chosen)} map={map.data} />}
      </section>

      <section className="grid gap-3">
        <h2 className="section-title">{t('gameMaps.images')}</h2>
        {data.images.length === 0 ? (
          <p className="note">{t('gameMaps.noImages')}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.images.map((image) => (
              <li key={image.pageUrl}>
                <a
                  href={image.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="grid gap-1 text-sm"
                >
                  <img
                    src={image.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="max-h-64 w-full rounded-base border border-line bg-surface object-contain"
                  />
                  <span className="link">{image.title}</span>
                  <span className="note">{image.wikiName}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.wikis.length === 0 ? (
        <p className="note">{t('gameMaps.noWiki')}</p>
      ) : (
        <p className="note">
          {t('gameMaps.wikis')}{' '}
          {data.wikis.map((wiki, index) => (
            <span key={wiki.url}>
              {index > 0 && ', '}
              <a href={wiki.url} target="_blank" rel="noreferrer" className="link">
                {wiki.name}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
