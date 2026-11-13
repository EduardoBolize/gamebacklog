import { CONSOLE_PLATFORMS, type BackupStatusResponse, type ImportMode } from '@gamebacklog/shared';
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link } from 'react-router';
import { api, useApiMutation, useAppState, useBackup, useSources } from '../api.ts';
import { AiSection } from '../components/AiSettings.tsx';
import { SourceRow } from '../components/SourceForms.tsx';
import { ErrorNote, Loading } from '../components/ui.tsx';
import { LOCALES, LOCALE_NAMES, useI18n } from '../i18n/index.tsx';
import {
  VOICE_ENGINES,
  browserRecognitionWorks,
  localRecognitionWorks,
  readVoicePreference,
  writeVoicePreference,
  type VoicePreference,
} from '../voice/engine.ts';

function SourcesSection() {
  const { t, tn } = useI18n();
  const sources = useSources();
  const sync = useApiMutation(api.steamSync);
  const steamReady = sources.data?.items.some((item) => item.id === 'steam' && item.configured);
  const consolesReady = CONSOLE_PLATFORMS.filter((id) =>
    sources.data?.items.some((item) => item.id === id && item.configured),
  );

  return (
    <section id="sources" aria-labelledby="sources-title" className="grid scroll-mt-20 gap-3">
      <h2 id="sources-title" className="text-xl">
        {t('sources.title')}
      </h2>
      {sources.isPending ? (
        <Loading />
      ) : sources.isError ? (
        <ErrorNote error={sources.error} />
      ) : (
        <>
          <ul className="border-t border-line">
            {sources.data.items.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </ul>
          <p className="note">
            {sources.data.secretStore === 'file' ? t('sources.keyfile') : t('sources.keychain')}{' '}
            {t('sources.neverShown')}
          </p>
        </>
      )}

      {consolesReady.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {consolesReady.map((id) => (
            <Link key={id} to={`/import/${id}`} className="btn">
              {t('steamImport.importFrom', { source: t(`sourceName.${id}`) })}
            </Link>
          ))}
        </div>
      )}

      {steamReady && (
        <div className="grid gap-2">
          <h3 className="section-title">{t('settings.steamLibrary')}</h3>
          <div className="flex flex-wrap gap-2">
            <Link to="/import/steam" className="btn">
              {t('library.emptyImport')}
            </Link>
            <button
              type="button"
              className="btn"
              disabled={sync.isPending}
              onClick={() => sync.mutate(undefined)}
            >
              {t('steamImport.sync')}
            </button>
          </div>
          <div aria-live="polite">
            {sync.data && (
              <p className="text-sm">
                {sync.data.sessionsCreated > 0
                  ? tn('steamImport.syncDone', sync.data.sessionsCreated)
                  : t('steamImport.syncNone')}
              </p>
            )}
          </div>
          <ErrorNote error={sync.error} />
        </div>
      )}
      <Link to="/setup" className="btn-quiet justify-self-start">
        {t('settings.runSetup')}
      </Link>
    </section>
  );
}

function ExportBlock() {
  const { t } = useI18n();
  const [includeCaches, setIncludeCaches] = useState(false);
  return (
    <div className="grid justify-items-start gap-2">
      <h3 className="section-title">{t('settings.exportTitle')}</h3>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
        <input
          type="checkbox"
          className="accent-accent"
          checked={includeCaches}
          onChange={(event) => setIncludeCaches(event.target.checked)}
        />
        {t('settings.includeCaches')}
      </label>
      <p className="note">{t('settings.exportNote')}</p>
      {/* A plain link: the server sends the file with a download header. */}
      <a href={`/api/export?includeCaches=${includeCaches}`} download className="btn btn-primary">
        {t('settings.exportButton')}
      </a>
    </div>
  );
}

function ImportBlock() {
  const { t, formatDateTime } = useI18n();
  const [file, setFile] = useState<{ name: string; content: unknown } | null>(null);
  const [notJson, setNotJson] = useState(false);
  const [mode, setMode] = useState<ImportMode>('merge');
  const preview = useApiMutation(
    ({ mode: wanted, content }: { mode: ImportMode; content: unknown }) =>
      api.importPreview(wanted, content),
  );
  const run = useApiMutation(({ mode: wanted, content }: { mode: ImportMode; content: unknown }) =>
    api.importFile(wanted, content),
  );
  const resetPreview = preview.reset;
  const resetRun = run.reset;

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    resetPreview();
    resetRun();
    setFile(null);
    setNotJson(false);
    if (!chosen) return;
    try {
      const content: unknown = JSON.parse(await chosen.text());
      setFile({ name: chosen.name, content });
      preview.mutate({ mode, content });
    } catch {
      setNotJson(true);
    }
  }

  function changeMode(next: ImportMode) {
    setMode(next);
    resetRun();
    if (file) preview.mutate({ mode: next, content: file.content });
  }

  const data = preview.data;

  return (
    <div className="grid gap-3">
      <h3 className="section-title">{t('settings.importTitle')}</h3>
      <label>
        <span className="label">{t('settings.chooseFile')}</span>
        <input
          type="file"
          accept="application/json,.json"
          className="block w-full text-sm file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-base file:border file:border-solid file:border-line file:bg-bg file:px-4 file:text-text"
          onChange={(event) => void chooseFile(event)}
        />
      </label>
      {notJson && (
        <p role="alert" className="text-sm text-danger">
          {t('settings.notJson')}
        </p>
      )}

      {file && (
        <fieldset>
          <legend className="label">{t('settings.mode')}</legend>
          <div className="flex flex-wrap gap-x-5">
            {(
              [
                ['merge', 'settings.modeMerge'],
                ['replace', 'settings.modeReplace'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <input
                  type="radio"
                  name="import-mode"
                  className="accent-accent"
                  checked={mode === value}
                  onChange={() => changeMode(value)}
                />
                {t(label)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div aria-live="polite" className="grid gap-3">
        {preview.isPending && <Loading />}
        <ErrorNote error={preview.error} />

        {file && data && !run.data && (
          <div className="grid gap-2 rounded-base border border-line p-4">
            <p className="note">
              {file.name} ·{' '}
              {t('settings.fileInfo', {
                version: data.fileSchemaVersion,
                date: formatDateTime(data.exportedAt),
              })}
            </p>
            <p>
              <span className="font-medium">{t('settings.preview')}:</span>{' '}
              {t('settings.previewLine', data.library)} ({t('settings.previewGames')})
            </p>
            {(data.addedTitles.length > 0 || data.updatedTitles.length > 0) && (
              <details>
                <summary className="text-sm text-muted">{t('settings.showList')}</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['settings.addedList', data.addedTitles, data.library.added],
                      ['settings.updatedList', data.updatedTitles, data.library.updated],
                    ] as const
                  ).map(
                    ([label, titles, total]) =>
                      titles.length > 0 && (
                        <div key={label}>
                          <h4 className="label">{t(label)}</h4>
                          <ul className="text-sm">
                            {titles.map((title) => (
                              <li key={title}>{title}</li>
                            ))}
                            {total > titles.length && (
                              <li className="text-muted">{t('settings.andMore')}…</li>
                            )}
                          </ul>
                        </div>
                      ),
                  )}
                </div>
              </details>
            )}
            {mode === 'replace' && <p className="text-sm">{t('settings.replaceWarning')}</p>}
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={run.isPending}
                onClick={() => {
                  if (mode === 'replace' && !window.confirm(t('settings.confirmReplace'))) return;
                  run.mutate({ mode, content: file.content });
                }}
              >
                {run.isPending ? t('settings.importing') : t('settings.confirmImport')}
              </button>
            </div>
          </div>
        )}

        <ErrorNote error={run.error} />
        {run.data && (
          <div className="grid gap-1" role="status">
            <p>
              {t('settings.importDone')} {t('settings.previewLine', run.data.library)} (
              {t('settings.previewGames')})
            </p>
            {run.data.backupFile && (
              <p className="note break-all">
                {t('settings.safetyCopy', { file: run.data.backupFile })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BackupForm({ status }: { status: BackupStatusResponse }) {
  const { t, formatDateTime } = useI18n();
  const [enabled, setEnabled] = useState(status.enabled);
  const [folder, setFolder] = useState(status.folder ?? '');
  const [keep, setKeep] = useState(String(status.keep));
  const save = useApiMutation(api.saveBackup);
  const run = useApiMutation(api.runBackup);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ enabled, folder: folder.trim() || null, keep: Number(keep) || 7 });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h3 className="section-title">{t('settings.backupTitle')}</h3>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
        <input
          type="checkbox"
          className="accent-accent"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {t('settings.backupEnabled')}
      </label>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label>
          <span className="label">{t('settings.backupFolder')}</span>
          <input
            className="field font-mono"
            spellCheck={false}
            aria-describedby="backup-folder-hint"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
          <span id="backup-folder-hint" className="note mt-1 block">
            {t('settings.backupFolderHint')}
          </span>
        </label>
        <label>
          <span className="label">{t('settings.backupKeep')}</span>
          <input
            type="number"
            min={1}
            max={365}
            className="field"
            value={keep}
            onChange={(event) => setKeep(event.target.value)}
          />
        </label>
      </div>
      <p className="note">
        {status.lastRunAt
          ? t('settings.backupLast', { date: formatDateTime(status.lastRunAt) })
          : t('settings.backupNever')}
      </p>
      {status.lastError && <p className="text-sm text-danger">{t('settings.backupFailed')}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t('app.save')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={run.isPending || !status.folder}
          onClick={() => run.mutate(undefined)}
        >
          {t('settings.backupNow')}
        </button>
      </div>
      <div aria-live="polite">
        {save.isSuccess && <p className="text-sm">{t('app.saved')}</p>}
        {run.data && (
          <p className="break-all text-sm">{t('settings.backupDone', { file: run.data.file })}</p>
        )}
      </div>
      <ErrorNote error={save.error ?? run.error} />
    </form>
  );
}

function DataSection() {
  const { t } = useI18n();
  const appState = useAppState();
  const backup = useBackup();
  const [copied, setCopied] = useState(false);
  const dataDir = appState.data?.dataDir ?? '';

  return (
    <section id="data" aria-labelledby="data-title" className="grid scroll-mt-20 gap-8">
      <h2 id="data-title" className="text-xl">
        {t('settings.data')}
      </h2>

      <div className="grid gap-1">
        <h3 className="section-title">{t('settings.dataFolder')}</h3>
        <p className="flex flex-wrap items-center gap-3">
          <code className="break-all rounded-sm bg-surface px-1 text-sm">{dataDir}</code>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              void navigator.clipboard.writeText(dataDir).then(() => setCopied(true));
            }}
          >
            {copied ? t('settings.copied') : t('settings.copy')}
          </button>
        </p>
      </div>

      <ExportBlock />
      <ImportBlock />
      {backup.isPending ? (
        <Loading />
      ) : backup.isError ? (
        <ErrorNote error={backup.error} />
      ) : (
        <BackupForm
          key={`${backup.data.folder}-${backup.data.keep}-${backup.data.enabled}`}
          status={backup.data}
        />
      )}
    </section>
  );
}

function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  return (
    <section id="appearance" aria-labelledby="appearance-title" className="grid scroll-mt-20 gap-4">
      <h2 id="appearance-title" className="text-xl">
        {t('settings.appearance')}
      </h2>
      <fieldset>
        <legend className="label">{t('settings.language')}</legend>
        <div className="flex flex-wrap gap-x-5">
          {LOCALES.map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <input
                type="radio"
                name="locale"
                className="accent-accent"
                checked={locale === option}
                onChange={() => setLocale(option)}
              />
              <span lang={option}>{LOCALE_NAMES[option]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function VoiceSection() {
  const { t } = useI18n();
  const [preference, setPreference] = useState<VoicePreference>(readVoicePreference);
  const available = { browser: browserRecognitionWorks(), local: localRecognitionWorks() };
  const labels: Record<
    VoicePreference,
    'voice.engineAuto' | 'voice.engineBrowser' | 'voice.engineLocal'
  > = {
    auto: 'voice.engineAuto',
    browser: 'voice.engineBrowser',
    local: 'voice.engineLocal',
  };
  return (
    <section id="voice" aria-labelledby="voice-title" className="grid scroll-mt-20 gap-4">
      <h2 id="voice-title" className="text-xl">
        {t('voice.settingsTitle')}
      </h2>
      {!available.browser && !available.local ? (
        <p className="note">{t('voice.unavailable')}</p>
      ) : (
        <fieldset>
          <legend className="label">{t('voice.engine')}</legend>
          <div className="grid gap-1">
            {VOICE_ENGINES.map((option) => (
              <label key={option} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <input
                  type="radio"
                  name="voice-engine"
                  className="accent-accent"
                  checked={preference === option}
                  disabled={option !== 'auto' && !available[option]}
                  onChange={() => {
                    setPreference(option);
                    writeVoicePreference(option);
                  }}
                />
                <span>{t(labels[option])}</span>
              </label>
            ))}
          </div>
          <p className="note mt-2">{t('voice.engineNote')}</p>
        </fieldset>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="grid max-w-3xl gap-10">
      <header className="grid gap-3">
        <h1 className="text-2xl">{t('settings.title')}</h1>
        <nav aria-label={t('settings.sections')}>
          <ul className="flex flex-wrap gap-x-5 text-sm">
            <li>
              <a href="#sources" className="link">
                {t('sources.title')}
              </a>
            </li>
            <li>
              <a href="#ai" className="link">
                {t('ai.title')}
              </a>
            </li>
            <li>
              <a href="#data" className="link">
                {t('settings.data')}
              </a>
            </li>
            <li>
              <a href="#voice" className="link">
                {t('voice.settingsTitle')}
              </a>
            </li>
            <li>
              <a href="#appearance" className="link">
                {t('settings.appearance')}
              </a>
            </li>
          </ul>
        </nav>
      </header>
      <SourcesSection />
      <AiSection />
      <DataSection />
      <VoiceSection />
      <AppearanceSection />
    </div>
  );
}
