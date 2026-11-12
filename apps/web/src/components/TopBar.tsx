import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api, useApiMutation, useAppState, useSources } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import { GamepadIcon, MenuIcon, PlusIcon, SettingsIcon, SyncIcon } from './icons.tsx';

export const TABS = [
  'library',
  'playing',
  'backlog',
  'wishlist',
  'recommendations',
  'stats',
] as const;
export type Tab = (typeof TABS)[number];

const TAB_LINKS: Record<Tab, string> = {
  library: '/',
  playing: '/?status=playing',
  backlog: '/?status=backlog',
  wishlist: '/?status=wishlist',
  recommendations: '/recommendations',
  stats: '/stats',
};

/** The tab that matches where the user is; none on pages outside the tabs (a game, settings). */
function useActiveTab(): Tab | null {
  const { pathname, search } = useLocation();
  if (pathname === '/recommendations') return 'recommendations';
  if (pathname === '/stats') return 'stats';
  if (pathname !== '/') return null;
  const status = new URLSearchParams(search).get('status');
  return status === 'playing' || status === 'backlog' || status === 'wishlist' ? status : 'library';
}

const MINUTE_MS = 60 * 1000;

/** "Steam sincronizada · há 12 min", kept fresh while the page stays open. */
function useSteamStatus() {
  const { t } = useI18n();
  const appState = useAppState();
  const sources = useSources();
  const sync = useApiMutation(api.steamSync);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const connected = sources.data?.items.some((item) => item.id === 'steam' && item.configured);
  const syncedAt = appState.data?.steamLastSyncAt;
  let label = t('libraryScreen.neverSynced');
  if (sync.isPending) label = t('libraryScreen.syncing');
  else if (syncedAt) {
    const minutes = Math.max(0, Math.floor((now - new Date(syncedAt).getTime()) / MINUTE_MS));
    label =
      minutes < 1
        ? t('libraryScreen.syncedNow')
        : minutes < 60
          ? t('libraryScreen.syncedMinutes', { minutes })
          : minutes < 48 * 60
            ? t('libraryScreen.syncedHours', { hours: Math.floor(minutes / 60) })
            : t('libraryScreen.syncedDays', { days: Math.floor(minutes / 60 / 24) });
  }
  return { connected, label, sync, ok: Boolean(syncedAt) && !sync.isError };
}

const ICON_BUTTON =
  'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-soft hover:border-line-control hover:text-text';

export function TopBar({
  sidebar,
  onAddGame,
}: {
  /** Present on pages with a sidebar: the menu button shows and drives it. */
  sidebar: { open: boolean; id: string; toggle: () => void } | null;
  onAddGame: () => void;
}) {
  const { t } = useI18n();
  const activeTab = useActiveTab();
  const steam = useSteamStatus();

  return (
    <header className="flex flex-wrap items-center gap-x-3 border-b border-divider bg-topbar px-4 md:min-h-16 md:gap-x-5 md:px-5">
      {sidebar && (
        <button
          type="button"
          aria-label={t('libraryScreen.toggleSidebar')}
          aria-expanded={sidebar.open}
          aria-controls={sidebar.id}
          onClick={sidebar.toggle}
          className="my-2.5 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-text hover:border-line-control"
        >
          <MenuIcon />
        </button>
      )}

      <Link to="/" className="my-2.5 flex items-center gap-2.5 text-text">
        <span className="text-accent">
          <GamepadIcon />
        </span>
        <span className="max-sm:sr-only font-display text-xl font-bold uppercase tracking-[0.08em] md:text-2xl">
          {t('libraryScreen.logo')}
        </span>
      </Link>

      <nav
        aria-label={t('libraryScreen.sections')}
        className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto [scrollbar-width:none] lg:order-none lg:mx-0 lg:w-auto lg:flex-1"
      >
        <ul className="flex gap-0.5 px-2 lg:px-0">
          {TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <li key={tab} className="shrink-0">
                <Link
                  to={TAB_LINKS[tab]}
                  aria-current={active ? 'page' : undefined}
                  className={`block border-b-[3px] px-3.5 pb-[13px] pt-4 font-display text-[17px] font-semibold uppercase tracking-[0.06em] lg:pb-[17px] lg:pt-5 ${
                    active
                      ? 'border-accent text-text'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {t(`libraryScreen.tabs.${tab}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        {steam.connected ? (
          <>
            <p
              className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-2 text-xs text-muted xl:flex"
              aria-live="polite"
            >
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${steam.ok ? 'bg-status-completed' : 'bg-muted'}`}
              />
              {steam.label}
            </p>
            <button
              type="button"
              aria-label={t('libraryScreen.syncNow')}
              title={steam.label}
              disabled={steam.sync.isPending}
              onClick={() => steam.sync.mutate(undefined)}
              className={`${ICON_BUTTON} disabled:cursor-wait`}
            >
              <span className={steam.sync.isPending ? 'animate-spin' : undefined}>
                <SyncIcon />
              </span>
            </button>
          </>
        ) : (
          <Link
            to="/settings#sources"
            className="hidden whitespace-nowrap rounded-full border border-line px-3 py-2 text-xs text-muted hover:text-text xl:block"
          >
            {t('libraryScreen.steamOff')}
          </Link>
        )}
        <button
          type="button"
          onClick={onAddGame}
          aria-label={t('libraryScreen.addGame')}
          className="flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-3 font-bold text-accent-text hover:bg-accent-hover 2xl:px-4"
        >
          <PlusIcon />
          <span className="hidden 2xl:inline">{t('libraryScreen.addGame')}</span>
        </button>
        <Link to="/settings" aria-label={t('libraryScreen.settings')} className={ICON_BUTTON}>
          <SettingsIcon />
        </Link>
      </div>
    </header>
  );
}
