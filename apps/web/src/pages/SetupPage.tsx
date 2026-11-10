import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, useApiMutation, useAppState, useSources } from '../api.ts';
import { useAddGame } from '../components/Shell.tsx';
import { IgdbForm, SteamForm } from '../components/SourceForms.tsx';
import { ErrorNote } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

const STEPS = ['welcome', 'igdb', 'steam', 'done'] as const;

/** First-run guide. Every step can be skipped, and all of it can be redone later in Settings. */
export function SetupPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const addGame = useAddGame();
  const appState = useAppState();
  const sources = useSources();
  const complete = useApiMutation(api.completeSetup);
  const [index, setIndex] = useState(0);
  const step = STEPS[index] ?? 'welcome';

  const configured = (id: string) =>
    sources.data?.items.some((item) => item.id === id && item.configured) ?? false;

  function finish(destination: 'library' | 'steam' | 'add') {
    complete.mutate(undefined, {
      onSuccess: () => {
        void navigate(destination === 'steam' ? '/import/steam' : '/');
        if (destination === 'add') addGame.open('playing');
      },
    });
  }

  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">{t('setup.title')}</h1>
        <p className="note">{t('setup.step', { current: index + 1, total: STEPS.length })}</p>
      </header>

      {step === 'welcome' && (
        <div className="grid gap-3">
          <h2 className="section-title">{t('setup.welcomeTitle')}</h2>
          <p>{t('setup.welcomeBody')}</p>
          <p>
            {t('setup.welcomeData')}{' '}
            <code className="break-all rounded-sm bg-surface px-1 text-sm">
              {appState.data?.dataDir}
            </code>
          </p>
          <p className="note">{t('setup.welcomeBackup')}</p>
        </div>
      )}

      {step === 'igdb' && (
        <div className="grid gap-3">
          <h2 className="section-title">{t('setup.igdbTitle')}</h2>
          {configured('igdb') && <p className="text-sm">{t('sources.connected')}.</p>}
          <IgdbForm />
        </div>
      )}

      {step === 'steam' && (
        <div className="grid gap-3">
          <h2 className="section-title">
            {t('setup.steamTitle')} <span className="note font-normal">({t('app.optional')})</span>
          </h2>
          {configured('steam') && <p className="text-sm">{t('sources.connected')}.</p>}
          <SteamForm />
        </div>
      )}

      {step === 'done' && (
        <div className="grid gap-3">
          <h2 className="section-title">{t('setup.doneTitle')}</h2>
          <p>{t('setup.doneBody')}</p>
          <div className="flex flex-wrap gap-2">
            {configured('steam') && (
              <button type="button" className="btn btn-primary" onClick={() => finish('steam')}>
                {t('setup.doneImport')}
              </button>
            )}
            <button
              type="button"
              className={configured('steam') ? 'btn' : 'btn btn-primary'}
              onClick={() => finish('add')}
            >
              {t('setup.doneAdd')}
            </button>
          </div>
          <p className="note">{t('setup.doneOptional')}</p>
        </div>
      )}

      {(step === 'igdb' || step === 'steam') && (
        <p className="note">
          {sources.data?.secretStore === 'file' ? t('sources.keyfile') : t('sources.keychain')}
        </p>
      )}

      <ErrorNote error={complete.error} />

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <button type="button" className="btn-quiet" onClick={() => finish('library')}>
          {t('setup.skip')}
        </button>
        <div className="flex gap-2">
          {index > 0 && (
            <button type="button" className="btn" onClick={() => setIndex(index - 1)}>
              {t('app.back')}
            </button>
          )}
          {index < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)}>
              {t('setup.next')}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => finish('library')}>
              {t('setup.finish')}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
