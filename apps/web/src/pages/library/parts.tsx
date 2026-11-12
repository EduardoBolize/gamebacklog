import type { ReactNode } from 'react';
import type { I18n } from '../../i18n/index.tsx';
import { useI18n } from '../../i18n/index.tsx';
import type { Game, GameStatus } from './mock-library.ts';

/** Small uppercase label above each group of controls. */
export const LABEL = 'text-xs font-semibold uppercase tracking-[0.08em] text-muted';

/** Section heading of the main area ("Continue jogando", "Biblioteca"). */
export const HEADING = 'font-display text-[26px] font-bold uppercase tracking-[0.04em]';

export const STATUS_TEXT: Record<GameStatus, string> = {
  playing: 'text-status-playing',
  backlog: 'text-status-backlog',
  completed: 'text-status-completed',
  completed_100: 'text-status-platinum',
};

export const STATUS_DOT: Record<GameStatus, string> = {
  playing: 'bg-status-playing',
  backlog: 'bg-status-backlog',
  completed: 'bg-status-completed',
  completed_100: 'bg-status-platinum',
};

export function hoursText(game: Game, t: I18n['t']): string {
  return game.hoursPlayed > 0
    ? t('libraryScreen.hoursPlayed', { hours: game.hoursPlayed, hltb: game.hltbHours })
    : t('libraryScreen.neverPlayed', { hltb: game.hltbHours });
}

const BADGE = 'rounded px-[7px] py-1 text-[11px] uppercase leading-none bg-topbar/90';

export function StatusBadge({ status }: { status: GameStatus }) {
  const { t } = useI18n();
  return (
    <span className={`${BADGE} font-bold tracking-[0.04em] ${STATUS_TEXT[status]}`}>
      {t(`libraryScreen.badge.${status}`)}
    </span>
  );
}

export function PlatformBadge({ game }: { game: Game }) {
  const { t } = useI18n();
  return (
    <span className={`${BADGE} font-semibold tracking-[0.06em] text-soft`}>
      {t(`libraryScreen.platformShort.${game.platform}`)}
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={`overflow-hidden ${className}`}
    >
      <div className="h-full bg-accent" style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * A game's cover. With `coverUrl` it shows the image; until there is one, a block of the game's
 * colour with its name. The badges sit on top either way.
 */
export function GameCover({
  game,
  shape,
  showStatus = true,
  title,
}: {
  game: Game;
  shape: 'portrait' | 'wide';
  showStatus?: boolean;
  /** The name drawn on the cover: a heading on wide covers, decoration on portrait ones. */
  title: ReactNode;
}) {
  const wide = shape === 'wide';
  return (
    <div
      className={`relative isolate flex flex-col justify-between overflow-hidden ${
        wide ? 'aspect-[16/7] px-4 py-3.5' : 'aspect-[2/3] rounded-lg border border-white/5 p-2.5'
      }`}
      style={{ backgroundColor: game.coverColor }}
    >
      {game.coverUrl && (
        <img
          src={game.coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
      )}
      <div className="flex justify-between gap-1.5">
        {showStatus && <StatusBadge status={game.status} />}
        <PlatformBadge game={game} />
      </div>
      {/* A real cover already shows the name; the title stays for screen readers only. */}
      <div className={game.coverUrl ? 'sr-only' : undefined}>{title}</div>
    </div>
  );
}
