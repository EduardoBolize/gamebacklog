import type { ConfigurableSource, SourceStatus, SourceTestResponse } from '@gamebacklog/shared';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, useApiMutation } from '../api.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { ErrorNote } from './ui.tsx';

/** Saves the keys and then tests them, so the user learns right away whether they work. */
function useSaveAndTest(id: ConfigurableSource) {
  const save = useApiMutation(api.saveSource);
  const test = useApiMutation(() => api.testSource(id));
  return { save, test };
}

export function TestResult({ result }: { result: SourceTestResponse | undefined }) {
  const { t } = useI18n();
  if (!result) return null;
  return (
    <p role="status" className={`text-sm ${result.ok ? '' : 'text-danger'}`}>
      {t(`sources.testResult.${result.code}`)}
    </p>
  );
}

function Steps({ items }: { items: MessageKey[] }) {
  const { t } = useI18n();
  return (
    <ol className="grid list-inside list-decimal gap-1 text-sm">
      {items.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ol>
  );
}

function SecretInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <input
        className="field font-mono"
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function FormFrame({
  intro,
  children,
  onSubmit,
  pending,
  error,
  result,
}: {
  intro: ReactNode;
  children: ReactNode;
  onSubmit: () => void;
  pending: boolean;
  error: unknown;
  result: SourceTestResponse | undefined;
}) {
  const { t } = useI18n();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {intro}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? t('sources.testing') : t('sources.test')}
        </button>
        <div aria-live="polite">
          <TestResult result={result} />
        </div>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

export function IgdbForm() {
  const { t } = useI18n();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const { save, test } = useSaveAndTest('igdb');

  return (
    <FormFrame
      intro={
        <>
          <p>{t('sources.igdbIntro')}</p>
          <Steps
            items={[
              'sources.igdbStep1',
              'sources.igdbStep2',
              'sources.igdbStep3',
              'sources.igdbStep4',
              'sources.igdbStep5',
            ]}
          />
        </>
      }
      pending={save.isPending || test.isPending}
      error={save.error ?? test.error}
      result={test.data}
      onSubmit={() =>
        save.mutate(
          { id: 'igdb', clientId: clientId.trim(), clientSecret: clientSecret.trim() },
          { onSuccess: () => test.mutate(undefined) },
        )
      }
    >
      <SecretInput label={t('sources.clientId')} value={clientId} onChange={setClientId} />
      <SecretInput
        label={t('sources.clientSecret')}
        value={clientSecret}
        onChange={setClientSecret}
      />
    </FormFrame>
  );
}

export function SteamForm() {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [steamId, setSteamId] = useState('');
  const { save, test } = useSaveAndTest('steam');

  return (
    <FormFrame
      intro={
        <>
          <p>{t('sources.steamIntro')}</p>
          <Steps items={['sources.steamStep1', 'sources.steamStep2', 'sources.steamStep3']} />
        </>
      }
      pending={save.isPending || test.isPending}
      error={save.error ?? test.error}
      result={test.data}
      onSubmit={() =>
        save.mutate(
          { id: 'steam', apiKey: apiKey.trim(), steamId: steamId.trim() },
          { onSuccess: () => test.mutate(undefined) },
        )
      }
    >
      <SecretInput label={t('sources.apiKey')} value={apiKey} onChange={setApiKey} />
      <label>
        <span className="label">{t('sources.steamIdLabel')}</span>
        <input
          className="field font-mono"
          inputMode="numeric"
          pattern="\d{17}"
          required
          value={steamId}
          onChange={(event) => setSteamId(event.target.value)}
        />
      </label>
    </FormFrame>
  );
}

export function PsnForm() {
  const { t } = useI18n();
  const [npsso, setNpsso] = useState('');
  const { save, test } = useSaveAndTest('psn');

  return (
    <FormFrame
      intro={
        <>
          <p>{t('sources.psnIntro')}</p>
          <p className="note max-w-prose">{t('sources.psnWarning')}</p>
          <Steps
            items={['sources.psnStep1', 'sources.psnStep2', 'sources.psnStep3', 'sources.psnStep4']}
          />
        </>
      }
      pending={save.isPending || test.isPending}
      error={save.error ?? test.error}
      result={test.data}
      onSubmit={() =>
        save.mutate({ id: 'psn', npsso: npsso.trim() }, { onSuccess: () => test.mutate(undefined) })
      }
    >
      <SecretInput label={t('sources.npsso')} value={npsso} onChange={setNpsso} />
    </FormFrame>
  );
}

export function XboxForm() {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const { save, test } = useSaveAndTest('xbox');

  return (
    <FormFrame
      intro={
        <>
          <p>{t('sources.xboxIntro')}</p>
          <p className="note max-w-prose">{t('sources.xboxWarning')}</p>
          <Steps items={['sources.xboxStep1', 'sources.xboxStep2', 'sources.xboxStep3']} />
        </>
      }
      pending={save.isPending || test.isPending}
      error={save.error ?? test.error}
      result={test.data}
      onSubmit={() =>
        save.mutate(
          { id: 'xbox', apiKey: apiKey.trim() },
          { onSuccess: () => test.mutate(undefined) },
        )
      }
    >
      <SecretInput label={t('sources.apiKey')} value={apiKey} onChange={setApiKey} />
    </FormFrame>
  );
}

function SimpleKeyForm({ id }: { id: 'rawg' | 'retroachievements' }) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const save = useApiMutation(api.saveSource);

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate(
          id === 'rawg'
            ? { id, apiKey: apiKey.trim() }
            : { id, username: username.trim(), apiKey: apiKey.trim() },
        );
      }}
    >
      {id === 'retroachievements' && (
        <label>
          <span className="label">{t('sources.username')}</span>
          <input
            className="field"
            required
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
      )}
      <SecretInput label={t('sources.apiKey')} value={apiKey} onChange={setApiKey} />
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t('app.save')}
        </button>
      </div>
      <div className="sm:col-span-2" aria-live="polite">
        {save.isSuccess && <p className="text-sm">{t('sources.keysSaved')}</p>}
        <ErrorNote error={save.error} />
      </div>
    </form>
  );
}

/** One line per source in Settings: its state, and the actions that make sense for it. */
export function SourceRow({ source }: { source: SourceStatus }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const test = useApiMutation(() => api.testSource(source.id));
  const remove = useApiMutation(() => api.removeSource(source.id));
  const toggle = useApiMutation((enabled: boolean) => api.saveSource({ id: 'hltb', enabled }));

  const name = t(`sourceName.${source.id}`);
  const isHltb = source.id === 'hltb';
  const isOptional = source.id === 'rawg' || source.id === 'retroachievements';

  const state = isHltb
    ? source.enabled
      ? t('sources.active')
      : t('sources.off')
    : source.configured
      ? [t('sources.connected'), source.detail && t('sources.steamId', { id: source.detail })]
          .filter(Boolean)
          .join(' · ')
      : [t('sources.notConfigured'), isOptional && t('sources.optionalNote')]
          .filter(Boolean)
          .join(' · ');

  return (
    <li className="grid gap-3 border-b border-line py-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h3 className="w-44 font-medium">{name}</h3>
        <p className="note flex-1">{state}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {isHltb ? (
            <button
              type="button"
              className="btn-quiet"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(!source.enabled)}
            >
              {source.enabled ? t('sources.turnOff') : t('sources.turnOn')}
            </button>
          ) : (
            <button
              type="button"
              className="btn-quiet"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {source.configured ? t('sources.change') : t('sources.configure')}
            </button>
          )}
          {(isHltb ? source.enabled : source.configured && !isOptional) && (
            <button
              type="button"
              className="btn-quiet"
              disabled={test.isPending}
              onClick={() => test.mutate(undefined)}
            >
              {test.isPending ? t('sources.testing') : t('sources.test')}
            </button>
          )}
          {!isHltb && source.configured && (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                if (window.confirm(t('sources.confirmRemove', { source: name })))
                  remove.mutate(undefined);
              }}
            >
              {t('sources.removeKeys')}
            </button>
          )}
        </div>
      </div>
      {isHltb && <p className="note max-w-prose">{t('sources.hltbNote')}</p>}
      <div aria-live="polite">
        <TestResult result={test.data} />
      </div>
      <ErrorNote error={test.error ?? remove.error ?? toggle.error} />
      {open && (
        <div className="rounded-base border border-line p-4">
          {source.id === 'igdb' && <IgdbForm />}
          {source.id === 'steam' && <SteamForm />}
          {source.id === 'psn' && <PsnForm />}
          {source.id === 'xbox' && <XboxForm />}
          {(source.id === 'rawg' || source.id === 'retroachievements') && (
            <SimpleKeyForm id={source.id} />
          )}
        </div>
      )}
    </li>
  );
}
