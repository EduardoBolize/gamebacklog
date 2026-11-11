import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Shell } from './components/Shell.tsx';
import { I18nProvider, useI18n } from './i18n/index.tsx';
import { AiUsagePage } from './pages/AiUsagePage.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { LibraryPage } from './pages/LibraryPage.tsx';
import { RecommendationsPage } from './pages/RecommendationsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { SteamImportPage } from './pages/SteamImportPage.tsx';
import { ThemeProvider } from './theme.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    // The server is local: one retry is plenty, and refetching on focus keeps two tabs in step.
    queries: { retry: 1, staleTime: 5_000 },
  },
});

function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="grid justify-items-start gap-3 py-12">
      <p>{t('app.notFound')}</p>
      <Link to="/" className="link">
        {t('app.backToLibrary')}
      </Link>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<LibraryPage />} />
                <Route path="games/:entryId" element={<GamePage />} />
                <Route path="recommendations" element={<RecommendationsPage />} />
                <Route path="setup" element={<SetupPage />} />
                <Route path="import/steam" element={<SteamImportPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="ai/usage" element={<AiUsagePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
