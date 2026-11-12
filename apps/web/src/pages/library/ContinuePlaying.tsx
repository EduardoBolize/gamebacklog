import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.tsx';
import type { Game } from './mock-library.ts';
import { GameCover, HEADING, hoursText, ProgressBar } from './parts.tsx';

const BUTTON = 'inline-flex min-h-9 items-center rounded-md px-3.5 text-[13px]';

export function ContinuePlaying({ games }: { games: Game[] }) {
  const { t } = useI18n();
  if (games.length === 0) return null;

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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-[18px]">
        {games.map((game) => (
          <article
            key={game.id}
            className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface"
          >
            <GameCover
              game={game}
              shape="wide"
              showStatus={false}
              title={
                <h3 className="font-display text-[30px] font-bold uppercase leading-none text-white">
                  {game.name}
                </h3>
              }
            />
            <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3.5">
              <div className="flex justify-between text-xs text-muted">
                <span>{hoursText(game, t)}</span>
                <span className="font-semibold text-text">{game.progress}%</span>
              </div>
              <ProgressBar
                value={game.progress}
                label={t('libraryScreen.progressOf', { name: game.name })}
                className="h-1.5 rounded-[3px] bg-bg"
              />
              {/* Each game's own screen; they open once the screen reads the real library. */}
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/games/${game.id}?tab=hints`}
                  className={`${BUTTON} bg-accent font-bold text-accent-text hover:bg-accent-hover`}
                >
                  {t('libraryScreen.hints')}
                </Link>
                <Link
                  to={`/games/${game.id}?tab=achievements`}
                  className={`${BUTTON} border border-line-control font-semibold text-text hover:border-soft`}
                >
                  {t('libraryScreen.guide')}
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
