import type { LibraryStatus } from '@gamebacklog/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { api, useApiMutation, useAppState, useSources } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import { useTheme } from '../theme.tsx';
import { AddGameDialog } from './AddGameDialog.tsx';

const HOUR_MS = 60 * 60 * 1000;

interface AddGame {
  open: (status: LibraryStatus) => void;
}
const AddGameContext = createContext<AddGame | null>(null);

/** Opens the "add game" dialog from anywhere, with a status already chosen. */
export function useAddGame(): AddGame {
  const value = useContext(AddGameContext);
  if (!value) throw new Error('useAddGame must be used inside Shell');
  return value;
}

/** The three buttons that are always on screen: top bar on wide screens, bottom bar on phones. */
function QuickAddButtons({
  onPick,
  className,
}: {
  onPick: (status: LibraryStatus) => void;
  className: string;
}) {
  const { t } = useI18n();
  const buttons: [LibraryStatus, string][] = [
    ['playing', t('nav.playing')],
    ['backlog', t('nav.backlog')],
    ['wishlist', t('nav.wishlist')],
  ];
  return (
    <nav aria-label={t('nav.quickAdd')} className={className}>
      {buttons.map(([status, label]) => (
        <button
          key={status}
          type="button"
          className="btn flex-1 sm:flex-none"
          onClick={() => onPick(status)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

/** Pulls new Steam hours quietly when the app opens, at most once an hour. */
function useBackgroundSteamSync() {
  const appState = useAppState();
  const sources = useSources();
  const sync = useApiMutation(api.steamSync);
  const started = useRef(false);

  const steamReady = sources.data?.items.some((item) => item.id === 'steam' && item.configured);
  const lastSync = appState.data?.steamLastSyncAt;
  const mutate = sync.mutate;

  useEffect(() => {
    if (started.current || !steamReady || lastSync === undefined) return;
    if (lastSync && Date.now() - new Date(lastSync).getTime() < HOUR_MS) return;
    started.current = true;
    mutate(undefined);
  }, [steamReady, lastSync, mutate]);
}

export function Shell() {
  const { t } = useI18n();
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const appState = useAppState();
  const [addStatus, setAddStatus] = useState<LibraryStatus | null>(null);
  const addGame = useMemo<AddGame>(() => ({ open: setAddStatus }), []);

  useBackgroundSteamSync();

  // First run: send the user through the setup once.
  const needsSetup = appState.data?.setupCompleted === false;
  useEffect(() => {
    if (needsSetup && location.pathname === '/') void navigate('/setup', { replace: true });
  }, [needsSetup, location.pathname, navigate]);

  const nextTheme = theme.resolved === 'dark' ? 'light' : 'dark';

  return (
    <AddGameContext.Provider value={addGame}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-bg focus:p-2"
      >
        {t('app.skipToContent')}
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 px-4 py-2">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            {t('app.name')}
          </Link>
          <QuickAddButtons onPick={setAddStatus} className="hidden gap-2 sm:flex" />
          <nav
            aria-label={t('nav.sections')}
            className="order-last flex w-full items-center gap-4 overflow-x-auto sm:order-none sm:ml-auto sm:w-auto"
          >
            <Link to="/recommendations" className="btn-quiet flex min-h-11 items-center sm:min-h-0">
              {t('nav.recommendations')}
            </Link>
            <Link to="/stats" className="btn-quiet flex min-h-11 items-center sm:min-h-0">
              {t('nav.stats')}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-4 sm:ml-0">
            <button
              type="button"
              className="btn-quiet min-h-11 sm:min-h-0"
              aria-label={nextTheme === 'dark' ? t('nav.themeToDark') : t('nav.themeToLight')}
              onClick={() => theme.setChoice(nextTheme)}
            >
              {t('nav.theme')}
            </button>
            <Link to="/settings" className="btn-quiet flex min-h-11 items-center sm:min-h-0">
              {t('nav.settings')}
            </Link>
          </div>
        </div>
      </header>

      <main id="content" className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:pb-12">
        {appState.isError ? (
          <div role="alert" className="grid justify-items-start gap-3 py-12">
            <p>{t('app.serverDown')}</p>
            <button type="button" className="btn" onClick={() => void appState.refetch()}>
              {t('app.retry')}
            </button>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg p-2 sm:hidden">
        <QuickAddButtons onPick={setAddStatus} className="flex gap-2" />
      </div>

      <AddGameDialog status={addStatus} onClose={() => setAddStatus(null)} />
    </AddGameContext.Provider>
  );
}
