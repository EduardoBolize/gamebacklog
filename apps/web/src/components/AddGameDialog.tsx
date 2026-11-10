import { LIBRARY_STATUSES, type CatalogGame, type LibraryStatus } from '@gamebacklog/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { api, keys, useApiMutation } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import { Cover, ErrorNote, Modal } from './ui.tsx';

const MAIN_STATUSES: LibraryStatus[] = ['playing', 'backlog', 'wishlist', 'completed'];
const OTHER_STATUSES = LIBRARY_STATUSES.filter((status) => !MAIN_STATUSES.includes(status));

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function ResultRow({
  game,
  status,
  onClose,
}: {
  game: CatalogGame;
  status: LibraryStatus;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState(
    game.platforms.length === 1 ? (game.platforms[0] ?? '') : '',
  );
  const add = useApiMutation(api.addGame);
  const entryId = add.data?.libraryEntryId ?? game.libraryEntryId;

  return (
    <li className="flex gap-3 border-b border-line py-3">
      <div className="w-14 shrink-0">
        <Cover title={game.title} url={game.coverUrl} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{game.title}</p>
        <p className="note">
          {[game.releaseYear, game.platforms.join(', ')].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {entryId ? (
            <Link to={`/games/${entryId}`} className="link text-sm" onClick={onClose}>
              {add.data
                ? t('addGame.added')
                : `${t('addGame.alreadyInLibrary')} · ${t('addGame.open')}`}
            </Link>
          ) : (
            <>
              {game.platforms.length > 1 && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  {t('addGame.platform')}
                  <select
                    className="field !w-auto"
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value)}
                  >
                    <option value="">{t('addGame.choosePlatform')}</option>
                    {game.platforms.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="btn btn-primary ml-auto"
                disabled={add.isPending}
                onClick={() =>
                  add.mutate({
                    status,
                    platform: platform || undefined,
                    game: { kind: 'igdb', externalId: game.externalId },
                  })
                }
              >
                {t('addGame.add')}
              </button>
            </>
          )}
        </div>
        <ErrorNote error={add.error} />
      </div>
    </li>
  );
}

function ManualForm({
  status,
  initialTitle,
  onClose,
}: {
  status: LibraryStatus;
  initialTitle: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initialTitle);
  const [year, setYear] = useState('');
  const [platform, setPlatform] = useState('');
  const add = useApiMutation(api.addGame);

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate({
      status,
      platform: platform.trim() || undefined,
      game: { kind: 'manual', title: title.trim(), releaseYear: year ? Number(year) : undefined },
    });
  }

  if (add.data) {
    return (
      <p>
        <Link to={`/games/${add.data.libraryEntryId}`} className="link" onClick={onClose}>
          {t('addGame.added')}
        </Link>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_8rem]">
      <label className="sm:col-span-2">
        <span className="label">{t('addGame.manualName')}</span>
        <input
          className="field"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        <span className="label">{t('addGame.manualPlatform')}</span>
        <input
          className="field"
          maxLength={80}
          placeholder={t('game.platformPlaceholder')}
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        />
      </label>
      <label>
        <span className="label">{t('addGame.manualYear')}</span>
        <input
          className="field"
          type="number"
          min={1950}
          max={2100}
          value={year}
          onChange={(event) => setYear(event.target.value)}
        />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={add.isPending || !title.trim()}>
          {t('addGame.add')}
        </button>
      </div>
      <div className="sm:col-span-2">
        <ErrorNote error={add.error} />
      </div>
    </form>
  );
}

function AddGameBody({
  initialStatus,
  onClose,
}: {
  initialStatus: LibraryStatus;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<LibraryStatus>(initialStatus);
  const [text, setText] = useState('');
  const [manual, setManual] = useState(false);
  const query = useDebounced(text.trim(), 350);

  const search = useQuery({
    queryKey: keys.catalog(query),
    queryFn: () => api.searchCatalog(query),
    // An empty query still asks once, to learn whether the catalog is configured at all.
    staleTime: 60_000,
  });
  const notConfigured = search.data?.configured === false;

  return (
    <div className="grid gap-4">
      <fieldset>
        <legend className="label">{t('addGame.addAs')}</legend>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {MAIN_STATUSES.map((option) => (
            <label key={option} className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="radio"
                name="add-status"
                className="accent-accent"
                checked={status === option}
                onChange={() => setStatus(option)}
              />
              {t(`status.${option}`)}
            </label>
          ))}
          <select
            aria-label={t('addGame.otherStatus')}
            className="field !w-auto"
            value={MAIN_STATUSES.includes(status) ? '' : status}
            onChange={(event) =>
              event.target.value && setStatus(event.target.value as LibraryStatus)
            }
          >
            <option value="">{t('addGame.otherStatus')}</option>
            {OTHER_STATUSES.map((option) => (
              <option key={option} value={option}>
                {t(`status.${option}`)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {manual ? (
        <section className="grid gap-3">
          <h3 className="section-title">{t('addGame.manualTitle')}</h3>
          <ManualForm status={status} initialTitle={text.trim()} onClose={onClose} />
          {!notConfigured && (
            <button
              type="button"
              className="btn-quiet justify-self-start"
              onClick={() => setManual(false)}
            >
              {t('addGame.backToSearch')}
            </button>
          )}
        </section>
      ) : notConfigured ? (
        <section className="grid gap-3 border-t border-line pt-4">
          <p className="font-medium">{t('addGame.notConfiguredTitle')}</p>
          <p className="note">{t('addGame.notConfiguredBody')}</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/settings" className="btn" onClick={onClose}>
              {t('addGame.configure')}
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setManual(true)}>
              {t('addGame.manualTitle')}
            </button>
          </div>
        </section>
      ) : (
        <section className="grid gap-2">
          <input
            type="search"
            autoFocus
            className="field"
            aria-label={t('addGame.searchLabel')}
            placeholder={t('addGame.search')}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div aria-live="polite">
            {query.length < 2 ? (
              <p className="note py-3">{t('addGame.typeToSearch')}</p>
            ) : search.isError ? (
              <p className="py-3 text-sm text-danger" role="alert">
                {t('addGame.searchFailed')}
              </p>
            ) : search.isFetching && !search.data?.results.length ? (
              <p className="note py-3">{t('addGame.searching')}</p>
            ) : search.data?.results.length === 0 ? (
              <p className="note py-3">{t('addGame.noResults', { query })}</p>
            ) : (
              <ul className="border-t border-line">
                {search.data?.results.map((game) => (
                  <ResultRow key={game.externalId} game={game} status={status} onClose={onClose} />
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="note">{t('addGame.sourceNote')}</span>
            <button type="button" className="btn-quiet" onClick={() => setManual(true)}>
              {t('addGame.manualLink')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export function AddGameDialog({
  status,
  onClose,
}: {
  /** Status pre-selected by the button that opened the dialog; `null` keeps it closed. */
  status: LibraryStatus | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal open={status !== null} onClose={onClose} title={t('addGame.title')}>
      {/* Remounting per opening resets the search and the chosen status. */}
      {status && <AddGameBody key={status} initialStatus={status} onClose={onClose} />}
    </Modal>
  );
}
