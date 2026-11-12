import type { LibraryItem } from '@gamebacklog/shared';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.tsx';
import { HEADING, ProgressBar, timeText, WideCover } from './parts.tsx';

const BUTTON = 'inline-flex min-h-9 items-center rounded-md px-3.5 text-[13px]';

/** The games being played, each one click away from its screen, hints or 100% guide. */
export function ContinuePlaying({ items }: { items: LibraryItem[] }) {
  const { t } = useI18n();
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="continue-title" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="continue-title" className={HEADING}>
          {t('libraryScreen.continueTitle')}
        </h2>
        <Link
          to="/?status=playing"
          className="text-[13px] font-semibold text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {t('libraryScreen.seeAllPlaying')}
        </Link>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-[18px]">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface"
          >
            {/* The banner and the name open the game's screen. */}
            <Link to={`/games/${item.id}`} className="group block">
              <WideCover
                item={item}
                title={
                  <h3 className="font-display text-[30px] font-bold uppercase leading-none text-white group-hover:underline">
                    {item.game.title}
                  </h3>
                }
              />
            </Link>
            <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3.5">
              <div className="flex justify-between gap-3 text-xs text-muted">
                <span>{timeText(item, t)}</span>
                {item.progressPercent !== null && (
                  <span className="font-semibold text-text">{item.progressPercent}%</span>
                )}
              </div>
              {item.progressPercent !== null && (
                <ProgressBar
                  value={item.progressPercent}
                  label={t('libraryScreen.progressOf', { name: item.game.title })}
                  className="h-1.5 rounded-[3px] bg-bg"
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/games/${item.id}?tab=hints`}
                  className={`${BUTTON} bg-accent font-bold text-accent-text hover:bg-accent-hover`}
                >
                  {t('libraryScreen.hints')}
                </Link>
                <Link
                  to={`/games/${item.id}?tab=achievements`}
                  className={`${BUTTON} border border-line-control font-semibold text-text hover:border-soft`}
                >
                  {t('libraryScreen.guide')}
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
