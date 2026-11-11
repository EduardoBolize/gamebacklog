import {
  LIBRARY_STATUSES,
  type ConsolePlatform,
  type LibraryStatus,
  type SteamImportItem,
} from '@gamebacklog/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, api, keys, useApiMutation } from '../api.ts';
import { Cover, ErrorNote, Loading } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

const VIEWS = ['all', 'review', 'unplayed'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL = {
  all: 'steamImport.showAll',
  review: 'steamImport.showReview',
  unplayed: 'steamImport.showUnplayed',
} as const;

const inView: Record<View, (item: SteamImportItem) => boolean> = {
  all: () => true,
  review: (item) => !item.match && !item.libraryEntryId,
  unplayed: (item) => item.playtimeMinutes === 0,
};

/** Where a library can be imported from. Consoles only give names, so they match on import. */
export type ImportSource = 'steam' | ConsolePlatform;

function ImportList({
  source,
  items,
  catalogAvailable,
}: {
  source: ImportSource;
  items: SteamImportItem[];
  catalogAvailable: boolean;
}) {
  const { t, tn, formatMinutes } = useI18n();
  const sourceName = t(`sourceName.${source}`);
  const matchOnImport = source !== 'steam';
  const views = matchOnImport ? VIEWS.filter((option) => option !== 'review') : VIEWS;
  const [view, setView] = useState<View>('all');
  // By default everything identified is selected; unidentified entries are often tools or DLC.
  const [selected, setSelected] = useState(
    () =>
      new Set(
        items
          .filter(
            (item) => !item.libraryEntryId && (item.match || !catalogAvailable || matchOnImport),
          )
          .map((item) => item.appId),
      ),
  );
  const [statuses, setStatuses] = useState<Record<string, LibraryStatus>>({});
  const importGames = useApiMutation((body: Parameters<typeof api.steamImport>[0]) =>
    source === 'steam' ? api.steamImport(body) : api.consoleImport(source, body),
  );

  const visible = useMemo(() => items.filter(inView[view]), [items, view]);
  const statusOf = (item: SteamImportItem) => statuses[item.appId] ?? item.suggestedStatus;
  const matched = items.filter((item) => item.match).length;
  const toReview = items.filter(inView.review).length;

  function toggle(appId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(appId);
      else next.delete(appId);
      return next;
    });
  }

  if (importGames.data) {
    return (
      <div className="grid justify-items-start gap-3" role="status">
        <p>{t('steamImport.done', importGames.data)}</p>
        <Link to="/" className="btn btn-primary">
          {t('app.backToLibrary')}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p>
        {matchOnImport
          ? tn('steamImport.found', items.length)
          : t('steamImport.summary', { total: items.length, matched, review: toReview })}
      </p>
      {!catalogAvailable ? (
        <p className="note">{t('steamImport.noCatalog', { source: sourceName })}</p>
      ) : (
        matchOnImport && <p className="note max-w-prose">{t('steamImport.matchOnImport')}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <fieldset className="flex flex-wrap items-center gap-x-4">
          <legend className="sr-only">{t('steamImport.show')}</legend>
          <span className="text-sm text-muted" aria-hidden="true">
            {t('steamImport.show')}
          </span>
          {views.map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <input
                type="radio"
                name={`${source}-view`}
                className="accent-accent"
                checked={view === option}
                onChange={() => setView(option)}
              />
              {t(VIEW_LABEL[option])}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-muted">
          {t('steamImport.setStatus')}
          <select
            className="field sm:!w-auto"
            value=""
            onChange={(event) => {
              const status = event.target.value as LibraryStatus | '';
              if (!status) return;
              setStatuses((current) => ({
                ...current,
                ...Object.fromEntries([...selected].map((appId) => [appId, status])),
              }));
            }}
          >
            <option value="">{t('app.none')}</option>
            {LIBRARY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input
            type="checkbox"
            className="accent-accent"
            checked={
              visible.length > 0 &&
              visible.every((item) => item.libraryEntryId || selected.has(item.appId))
            }
            onChange={(event) => {
              for (const item of visible)
                if (!item.libraryEntryId) toggle(item.appId, event.target.checked);
            }}
          />
          {t('steamImport.selectAll')}
        </label>
        <span className="note tabular-nums">
          {t('steamImport.selected', { count: selected.size })}
        </span>
      </div>

      <ul className="border-t border-line">
        {visible.map((item) => (
          <li
            key={item.appId}
            className="grid grid-cols-[auto_2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-line py-2 sm:grid-cols-[auto_2.5rem_minmax(0,1.2fr)_5rem_minmax(0,1fr)_9rem]"
          >
            <input
              type="checkbox"
              className="h-5 w-5 accent-accent"
              aria-label={t('steamImport.select', { name: item.name })}
              disabled={Boolean(item.libraryEntryId)}
              checked={selected.has(item.appId)}
              onChange={(event) => toggle(item.appId, event.target.checked)}
            />
            <Cover title="" url={item.match?.coverUrl ?? null} />
            <span className="truncate font-medium">{item.name}</span>
            <span className="col-start-3 text-sm tabular-nums text-muted sm:col-start-auto sm:text-right">
              {item.playtimeMinutes > 0 || !matchOnImport
                ? formatMinutes(item.playtimeMinutes)
                : t('steamImport.noHours')}
            </span>
            <span className="col-start-3 truncate text-sm text-muted sm:col-start-auto">
              {item.libraryEntryId
                ? t('steamImport.alreadyInLibrary')
                : item.match
                  ? [item.match.title, item.match.releaseYear && `(${item.match.releaseYear})`]
                      .filter(Boolean)
                      .join(' ')
                  : (item.detail ?? t('steamImport.notIdentified'))}
            </span>
            {!item.libraryEntryId && (
              <select
                className="field col-start-3 sm:col-start-auto"
                aria-label={t('steamImport.statusOf', { name: item.name })}
                value={statusOf(item)}
                onChange={(event) =>
                  setStatuses({ ...statuses, [item.appId]: event.target.value as LibraryStatus })
                }
              >
                {LIBRARY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>

      <ErrorNote error={importGames.error} />
      <div className="sticky bottom-16 flex justify-end gap-2 bg-bg py-3 sm:bottom-0">
        <Link to="/" className="btn">
          {t('app.cancel')}
        </Link>
        <button
          type="button"
          className="btn btn-primary"
          disabled={selected.size === 0 || importGames.isPending}
          onClick={() =>
            importGames.mutate({
              items: items
                .filter((item) => selected.has(item.appId))
                .map((item) => ({ appId: item.appId, status: statusOf(item) })),
            })
          }
        >
          {importGames.isPending
            ? t('steamImport.importing')
            : tn('steamImport.import', selected.size)}
        </button>
      </div>
    </div>
  );
}

export function ImportPage({ source }: { source: ImportSource }) {
  const { t } = useI18n();
  const sourceName = t(`sourceName.${source}`);
  // Nothing is written until the user confirms: this only reads the library of the account.
  const preview = useQuery({
    queryKey: keys.importPreview(source),
    queryFn: () => (source === 'steam' ? api.steamPreview() : api.consolePreview(source)),
    retry: false,
    staleTime: 60_000,
  });
  const notConfigured =
    preview.error instanceof ApiError && preview.error.code === 'source_not_configured';

  return (
    <section className="grid gap-5">
      <Link to="/" className="btn-quiet justify-self-start">
        ← {t('app.backToLibrary')}
      </Link>
      <h1 className="text-2xl">{t('steamImport.title', { source: sourceName })}</h1>

      {preview.isPending ? (
        <p className="note" role="status">
          {t('steamImport.loading', { source: sourceName })}
        </p>
      ) : notConfigured ? (
        <div className="grid justify-items-start gap-3">
          <p>{t('steamImport.notConfigured', { source: sourceName })}</p>
          <Link to="/settings" className="btn btn-primary">
            {t('steamImport.goToSettings')}
          </Link>
        </div>
      ) : preview.isError ? (
        <div className="grid justify-items-start gap-3">
          <ErrorNote error={preview.error} />
          <button type="button" className="btn" onClick={() => void preview.refetch()}>
            {t('app.retry')}
          </button>
        </div>
      ) : preview.data.items.length === 0 ? (
        <p className="text-muted">{t('steamImport.empty', { source: sourceName })}</p>
      ) : (
        <ImportList
          key={source}
          source={source}
          items={preview.data.items}
          catalogAvailable={preview.data.catalogAvailable}
        />
      )}
      {preview.isFetching && !preview.isPending && <Loading />}
    </section>
  );
}
