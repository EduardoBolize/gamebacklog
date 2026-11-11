import { useState } from 'react';
import { useAreaMedia } from '../../api-assist.ts';
import { useI18n } from '../../i18n/index.tsx';

/**
 * Maps and videos for one area, for when words are not enough. Nothing here uses the AI: maps
 * are thumbnails served by the game's wiki that open the wiki's own page, and videos are links.
 * It only looks things up once opened, so a visit to the page costs no request.
 */
export function AreaMedia({ runId, checkpointId }: { runId: string; checkpointId: string | null }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const media = useAreaMedia(runId, checkpointId, locale, open);
  const data = media.data;

  return (
    <details
      className="rounded-base border border-line p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="section-title">{t('media.title')}</summary>
      <div className="mt-3 grid gap-4">
        {media.isPending && (
          <p className="note" role="status">
            {t('app.loading')}
          </p>
        )}
        {media.isError && <p className="note">{t('media.failed')}</p>}

        {data && (
          <>
            <div className="grid gap-2">
              <h3 className="label">
                {data.mapsScope === 'game' || !data.checkpoint
                  ? t('media.mapsOfGame')
                  : t('media.mapsOfArea', { name: data.checkpoint })}
              </h3>
              {data.maps.length > 0 ? (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {data.maps.map((map) => (
                    <li key={map.pageUrl}>
                      <a
                        href={map.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="grid gap-1 text-sm"
                      >
                        <img
                          src={map.thumbUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="max-h-64 w-full rounded-base border border-line bg-surface object-contain"
                        />
                        <span className="link">{map.title}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="note">{t('media.noMaps')}</p>
              )}
              {data.wiki?.url && (
                <p className="note">
                  <a href={data.wiki.url} target="_blank" rel="noreferrer" className="link">
                    {t('media.fromWiki')}
                  </a>
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <h3 className="label">{t('media.videos')}</h3>
              <p className="note">{t('media.videoWarning')}</p>
              <ul className="grid gap-1 text-sm">
                {data.videos.map((video) => (
                  <li key={video.url}>
                    <a href={video.url} target="_blank" rel="noreferrer" className="link">
                      {video.title}
                    </a>
                  </li>
                ))}
                <li>
                  <a href={data.videoSearchUrl} target="_blank" rel="noreferrer" className="link">
                    {t('media.searchVideos')}
                  </a>
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
