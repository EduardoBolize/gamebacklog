import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.tsx';
import { GamepadIcon, MenuIcon, SyncIcon } from './icons.tsx';
import { mockProfile, mockSync } from './mock-library.ts';

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
  wishlist: '/wishlist',
  // These two already exist as full screens of the app.
  recommendations: '/recommendations',
  stats: '/stats',
};

const MINUTE_MS = 60 * 1000;

function useSyncLabel(): { label: string; sync: () => void } {
  const { t } = useI18n();
  const [syncedAt, setSyncedAt] = useState(() => new Date(mockSync.syncedAt).getTime());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const minutes = Math.floor((now - syncedAt) / MINUTE_MS);
  const label =
    minutes < 1
      ? t('libraryScreen.syncedNow')
      : minutes < 60
        ? t('libraryScreen.syncedMinutes', { minutes })
        : t('libraryScreen.syncedHours', { hours: Math.floor(minutes / 60) });

  return {
    label,
    // Mock: the real sync talks to the server, which this screen does not use yet.
    sync: () => {
      const at = Date.now();
      setSyncedAt(at);
      setNow(at);
    },
  };
}

export function TopBar({
  activeTab,
  sidebarOpen,
  sidebarId,
  onToggleSidebar,
}: {
  activeTab: Tab;
  sidebarOpen: boolean;
  sidebarId: string;
  onToggleSidebar: () => void;
}) {
  const { t } = useI18n();
  const { label, sync } = useSyncLabel();

  return (
    <header className="flex flex-wrap items-center gap-x-3 border-b border-divider bg-topbar px-4 md:min-h-16 md:gap-x-5 md:px-5">
      <button
        type="button"
        aria-label={t('libraryScreen.toggleSidebar')}
        aria-expanded={sidebarOpen}
        aria-controls={sidebarId}
        onClick={onToggleSidebar}
        className="my-2.5 flex size-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-text hover:border-line-control"
      >
        <MenuIcon />
      </button>

      <Link to="/" className="flex items-center gap-2.5 text-text">
        <span className="text-accent">
          <GamepadIcon />
        </span>
        <span className="font-display text-xl font-bold uppercase tracking-[0.08em] md:text-2xl">
          {t('libraryScreen.logo')}
        </span>
      </Link>

      <nav
        aria-label={t('libraryScreen.sections')}
        className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto [scrollbar-width:none] md:order-none md:mx-0 md:w-auto md:flex-1"
      >
        <ul className="flex gap-0.5 px-2 md:px-0">
          {TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <li key={tab} className="shrink-0">
                <Link
                  to={TAB_LINKS[tab]}
                  aria-current={active ? 'page' : undefined}
                  className={`block border-b-[3px] px-3.5 pb-[13px] pt-4 font-display text-[17px] font-semibold uppercase tracking-[0.06em] md:pb-[17px] md:pt-5 ${
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

      <div className="ml-auto flex items-center gap-3">
        <p
          className="hidden items-center gap-2 rounded-full border border-line px-3 py-2 text-xs text-muted lg:flex"
          aria-live="polite"
        >
          <span className="size-2 rounded-full bg-status-completed" aria-hidden="true" />
          {label}
        </p>
        <button
          type="button"
          aria-label={t('libraryScreen.syncNow')}
          title={label}
          onClick={sync}
          className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-line text-soft hover:border-line-control hover:text-text"
        >
          <SyncIcon />
        </button>
        <span
          role="img"
          aria-label={t('libraryScreen.profile', { name: mockProfile.name })}
          className="flex size-10 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-text"
        >
          {mockProfile.initials}
        </span>
      </div>
    </header>
  );
}
