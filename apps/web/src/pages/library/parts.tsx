import type { LibraryItem, LibraryStatus } from '@gamebacklog/shared';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { I18n } from '../../i18n/index.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { platformBadge } from './filters.ts';

/** Section heading of the main area ("Continue jogando", "Biblioteca"). */
export const HEADING = 'font-display text-[26px] font-bold uppercase tracking-[0.04em]';

export const STATUS_TEXT: Record<LibraryStatus, string> = {
  playing: 'text-status-playing',
  backlog: 'text-status-backlog',
  wishlist: 'text-status-wishlist',
  completed: 'text-status-completed',
  completed_100: 'text-status-platinum',
  paused: 'text-status-paused',
  dropped: 'text-status-dropped',
};

export const STATUS_DOT: Record<LibraryStatus, string> = {
  playing: 'bg-status-playing',
  backlog: 'bg-status-backlog',
  wishlist: 'bg-status-wishlist',
  completed: 'bg-status-completed',
  completed_100: 'bg-status-platinum',
  paused: 'bg-status-paused',
  dropped: 'bg-status-dropped',
};

/** "74h" or "45min": whole hours read better on a card than "73h 52min". */
export function shortTime(minutes: number, t: I18n['t']): string {
  return minutes < 60
    ? t('time.minutes', { minutes })
    : t('time.hours', { hours: Math.round(minutes / 60) });
}

/** "74h jogadas · HLTB 118h", "Nunca jogado · HLTB 40h"… */
export function timeText(item: LibraryItem, t: I18n['t']): string {
  return [
    item.playedMinutes > 0
      ? t('libraryScreen.played', { time: shortTime(item.playedMinutes, t) })
      : t('libraryScreen.neverPlayed'),
    item.mainMinutes ? t('libraryScreen.hltb', { time: shortTime(item.mainMinutes, t) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const BADGE = 'rounded px-[7px] py-1 text-[11px] uppercase leading-none bg-topbar/90';

export function StatusBadge({ status }: { status: LibraryStatus }) {
  const { t } = useI18n();
  return (
    <span className={`${BADGE} font-bold tracking-[0.04em] ${STATUS_TEXT[status]}`}>
      {t(`libraryScreen.badge.${status}`)}
    </span>
  );
}

export function PlatformBadge({ item }: { item: LibraryItem }) {
  const label = platformBadge(item);
  if (!label) return null;
  return (
    <span className={`${BADGE} max-w-[60%] truncate font-semibold tracking-[0.06em] text-soft`}>
      {label}
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

/** The cover image, or nothing when there is none or it failed to load. */
function useCover(url: string | null): [string | null, () => void] {
  const [failed, setFailed] = useState<string | null>(null);
  return [url && url !== failed ? url : null, () => setFailed(url)];
}

/**
 * A portrait cover (2:3) for the grid. Without an image, a block with the game's name in the
 * display face; the badges sit on top either way.
 */
export function PortraitCover({
  item,
  showStatus = true,
}: {
  item: LibraryItem;
  showStatus?: boolean;
}) {
  const [url, fail] = useCover(item.game.coverUrl);
  return (
    <div className="relative isolate flex aspect-[2/3] flex-col justify-between overflow-hidden rounded-lg border border-white/5 bg-selected p-2.5">
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={fail}
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
      )}
      <div className="flex justify-between gap-1.5">
        {showStatus && <StatusBadge status={item.status} />}
        <PlatformBadge item={item} />
      </div>
      {!url && (
        <span
          aria-hidden="true"
          className="line-clamp-4 font-display text-2xl font-bold uppercase leading-[1.02] text-white"
        >
          {item.game.title}
        </span>
      )}
    </div>
  );
}

/**
 * The wide banner of a "continue playing" card. Covers are portrait, so the banner shows the
 * cover sharp on the right over a blurred copy of itself.
 */
export function WideCover({ item, title }: { item: LibraryItem; title: ReactNode }) {
  const [url, fail] = useCover(item.game.coverUrl);
  return (
    <div className="relative isolate flex aspect-[16/7] overflow-hidden bg-selected">
      {url && (
        <>
          <img
            src={url}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="absolute inset-0 -z-20 h-full w-full scale-110 object-cover opacity-60 blur-md"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-topbar/80 via-topbar/40 to-transparent" />
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-between px-4 py-3.5">
        <div className="flex">
          <PlatformBadge item={item} />
        </div>
        {title}
      </div>
      {url && (
        <img
          src={url}
          alt=""
          decoding="async"
          onError={fail}
          className="my-3 mr-3 aspect-[3/4] h-[calc(100%-1.5rem)] w-auto rounded-md object-cover shadow-lg"
        />
      )}
    </div>
  );
}
