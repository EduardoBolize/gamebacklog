import { LIBRARY_STATUSES, type LibraryStatus } from '@gamebacklog/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, useApiMutation, useAppState, useSources } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import { AddGameDialog } from './AddGameDialog.tsx';
import { TopBar } from './TopBar.tsx';

const HOUR_MS = 60 * 60 * 1000;
const SIDEBAR_ID = 'library-sidebar';
/** Tailwind's `md`: below it the sidebar is a drawer over the page. */
const WIDE_QUERY = '(min-width: 768px)';

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

interface Sidebar {
  id: string;
  open: boolean;
  /** False below the `md` breakpoint, where the sidebar is a drawer. */
  wide: boolean;
  setOpen: (open: boolean) => void;
}
const SidebarContext = createContext<Sidebar | null>(null);

/** The library sidebar's state; the menu button in the top bar drives it. */
export function useSidebar(): Sidebar {
  const value = useContext(SidebarContext);
  if (!value) throw new Error('useSidebar must be used inside Shell');
  return value;
}

/** Open by default on wide screens, closed on phones; follows the screen across the breakpoint. */
function useSidebarState(): Sidebar {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const [open, setOpen] = useState(wide);

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => {
      setWide(query.matches);
      setOpen(query.matches);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return useMemo(() => ({ id: SIDEBAR_ID, open, wide, setOpen }), [open, wide]);
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

/**
 * The frame of every screen: the top bar with the sections, "add game" and Steam sync. The
 * library brings its own sidebar and layout; every other page sits in a centred column.
 */
export function Shell() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const appState = useAppState();
  const sidebar = useSidebarState();
  const [addStatus, setAddStatus] = useState<LibraryStatus | null>(null);
  const addGame = useMemo<AddGame>(() => ({ open: setAddStatus }), []);

  useBackgroundSteamSync();

  // First run: send the user through the setup once.
  const needsSetup = appState.data?.setupCompleted === false;
  useEffect(() => {
    if (needsSetup && location.pathname === '/') void navigate('/setup', { replace: true });
  }, [needsSetup, location.pathname, navigate]);

  const isLibrary = location.pathname === '/';
  // "Add game" starts on the status being looked at, when there is one.
  const viewed = params.get('status');
  const defaultStatus =
    isLibrary && LIBRARY_STATUSES.some((status) => status === viewed)
      ? (viewed as LibraryStatus)
      : 'backlog';

  return (
    <AddGameContext.Provider value={addGame}>
      <SidebarContext.Provider value={sidebar}>
        <div className="flex min-h-screen flex-col text-sm">
          <a
            href="#content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-accent focus:p-2 focus:text-accent-text"
          >
            {t('app.skipToContent')}
          </a>

          <TopBar
            sidebar={
              isLibrary && !appState.isError
                ? {
                    open: sidebar.open,
                    id: SIDEBAR_ID,
                    toggle: () => sidebar.setOpen(!sidebar.open),
                  }
                : null
            }
            onAddGame={() => setAddStatus(defaultStatus)}
          />

          {appState.isError ? (
            <main id="content" className="mx-auto w-full max-w-6xl px-4 py-12 md:px-8">
              <div role="alert" className="grid justify-items-start gap-3">
                <p>{t('app.serverDown')}</p>
                <button type="button" className="btn" onClick={() => void appState.refetch()}>
                  {t('app.retry')}
                </button>
              </div>
            </main>
          ) : isLibrary ? (
            <Outlet />
          ) : (
            <main
              id="content"
              className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 md:px-8 md:pt-8"
            >
              <Outlet />
            </main>
          )}
        </div>

        <AddGameDialog status={addStatus} onClose={() => setAddStatus(null)} />
      </SidebarContext.Provider>
    </AddGameContext.Provider>
  );
}
