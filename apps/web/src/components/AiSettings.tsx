import type { AiProviderStatus, WebSearchProvider, WebSearchSettings } from '@gamebacklog/shared';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { useApiMutation } from '../api.ts';
import { assistApi, useAi, useWebSearch } from '../api-assist.ts';
import { useI18n } from '../i18n/index.tsx';
import { ErrorNote, Loading } from './ui.tsx';

/** One provider: its state, the switch that makes it the one in use, and its settings. */
function ProviderRow({ provider, active }: { provider: AiProviderStatus; active: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(provider.model ?? '');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const modelListId = useId();

  const save = useApiMutation((body: Parameters<typeof assistApi.saveAiProvider>[1]) =>
    assistApi.saveAiProvider(provider.id, body),
  );
  const choose = useApiMutation((activeProviderId: AiProviderStatus['id'] | null) =>
    assistApi.saveAiSettings({ activeProviderId }),
  );
  const removeKey = useApiMutation(() => assistApi.removeAiKey(provider.id));
  const test = useApiMutation(() => assistApi.testAi(provider.id));
  const models = useApiMutation(() => assistApi.aiModels(provider.id));

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        model: model.trim() || null,
        ...(provider.kind === 'local' ? { baseUrl: baseUrl.trim() || null } : {}),
      },
      { onSuccess: () => setApiKey('') },
    );
  }

  return (
    <li className="grid gap-2 border-b border-line py-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h4 className="w-48 font-medium">{provider.displayName}</h4>
        <p className="note flex-1">
          {t(`ai.cost.${provider.costHint}`)} · {t(`ai.status.${provider.status}`)}
          {provider.model && ` · ${provider.model}`}
        </p>
        <div className="flex flex-wrap items-center gap-x-4">
          {active ? (
            <>
              <span className="text-sm font-semibold text-accent">{t('ai.active')}</span>
              <button type="button" className="btn-quiet" onClick={() => choose.mutate(null)}>
                {t('ai.stopUsing')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-quiet"
              disabled={choose.isPending}
              onClick={() => choose.mutate(provider.id)}
            >
              {t('ai.use')}
            </button>
          )}
          <button
            type="button"
            className="btn-quiet"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {t('ai.configure')}
          </button>
        </div>
      </div>

      {provider.billingWarning && (
        <p className="text-sm text-danger" role="note">
          {t('ai.billingWarning', { name: provider.billingWarning })}
        </p>
      )}
      <ErrorNote error={choose.error} />

      {open && (
        <form onSubmit={submit} className="grid gap-3 rounded-base border border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {provider.kind === 'api' && (
              <label>
                <span className="label">
                  {t('ai.apiKey')}
                  {provider.hasKey && ` (${t('ai.keySaved')})`}
                </span>
                <input
                  className="field font-mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
            )}
            {provider.kind === 'local' && (
              <label>
                <span className="label">{t('ai.baseUrl')}</span>
                <input
                  className="field font-mono"
                  type="url"
                  spellCheck={false}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </label>
            )}
            <label>
              <span className="label">{t('ai.model')}</span>
              <input
                className="field font-mono"
                list={modelListId}
                spellCheck={false}
                maxLength={120}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
              <datalist id={modelListId}>
                {models.data?.models.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {provider.kind === 'cli' && (
                <span className="note mt-1 block">{t('ai.modelCliHint')}</span>
              )}
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {t('app.save')}
            </button>
            {provider.kind !== 'cli' && (
              <button
                type="button"
                className="btn"
                disabled={models.isPending}
                onClick={() => models.mutate(undefined)}
              >
                {t('ai.listModels')}
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={test.isPending}
              onClick={() => test.mutate(undefined)}
            >
              {test.isPending ? t('ai.testing') : t('ai.test')}
            </button>
            {provider.hasKey && (
              <button
                type="button"
                className="btn-quiet"
                onClick={() => removeKey.mutate(undefined)}
              >
                {t('ai.removeKey')}
              </button>
            )}
          </div>
          <div aria-live="polite" className="grid gap-1">
            {save.isSuccess && <p className="text-sm">{t('app.saved')}</p>}
            {models.data?.models.length === 0 && <p className="note">{t('ai.noModels')}</p>}
            {test.data && (
              <p className={`text-sm ${test.data.ok ? '' : 'text-danger'}`}>
                {test.data.ok ? t('ai.testOk') : t(`ai.status.${test.data.status}`)}
              </p>
            )}
          </div>
          <ErrorNote error={save.error ?? test.error ?? removeKey.error} />
        </form>
      )}
    </li>
  );
}

function BudgetForm({ value }: { value: number }) {
  const { t } = useI18n();
  const [budget, setBudget] = useState(String(value));
  const save = useApiMutation((contextBudgetTokens: number) =>
    assistApi.saveAiSettings({ contextBudgetTokens }),
  );
  return (
    <form
      className="grid gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate(Number(budget));
      }}
    >
      <label>
        <span className="label">{t('ai.budget')}</span>
        <div className="flex gap-2">
          <input
            type="number"
            min={500}
            max={100000}
            step={500}
            className="field !w-36"
            aria-describedby="ai-budget-hint"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
          <button type="submit" className="btn" disabled={save.isPending}>
            {t('app.save')}
          </button>
        </div>
      </label>
      <p id="ai-budget-hint" className="note max-w-prose">
        {t('ai.budgetHint')}
      </p>
      <ErrorNote error={save.error} />
    </form>
  );
}

function WebSearchForm({ settings }: { settings: WebSearchSettings }) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<WebSearchProvider | ''>(settings.provider ?? '');
  const [searxngUrl, setSearxngUrl] = useState(settings.searxngUrl ?? '');
  const [key, setKey] = useState('');
  const save = useApiMutation(assistApi.saveWebSearch);
  const hasKey =
    (provider === 'brave' && settings.hasBraveKey) ||
    (provider === 'tavily' && settings.hasTavilyKey);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      {
        provider: provider || null,
        ...(provider === 'searxng' ? { searxngUrl: searxngUrl.trim() || null } : {}),
        ...(provider === 'brave' && key.trim() ? { braveKey: key.trim() } : {}),
        ...(provider === 'tavily' && key.trim() ? { tavilyKey: key.trim() } : {}),
      },
      { onSuccess: () => setKey('') },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h3 className="section-title">{t('ai.searchTitle')}</h3>
      <p className="note max-w-prose">{t('ai.searchIntro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">{t('ai.searchProvider')}</span>
          <select
            className="field"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as WebSearchProvider | '');
              setKey('');
            }}
          >
            <option value="">{t('ai.searchNone')}</option>
            <option value="searxng">SearXNG</option>
            <option value="brave">Brave Search</option>
            <option value="tavily">Tavily</option>
          </select>
        </label>
        {provider === 'searxng' && (
          <label>
            <span className="label">{t('ai.searxngUrl')}</span>
            <input
              className="field font-mono"
              type="url"
              placeholder="http://127.0.0.1:8080"
              value={searxngUrl}
              onChange={(event) => setSearxngUrl(event.target.value)}
            />
          </label>
        )}
        {(provider === 'brave' || provider === 'tavily') && (
          <label>
            <span className="label">
              {provider === 'brave' ? t('ai.braveKey') : t('ai.tavilyKey')}
              {hasKey && ` (${t('ai.keySaved')})`}
            </span>
            <input
              className="field font-mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={save.isPending}>
          {t('app.save')}
        </button>
        <span aria-live="polite" className="text-sm">
          {save.isSuccess && t('app.saved')}
        </span>
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}

/** The "Connect AI" section of Settings. */
export function AiSection() {
  const { t } = useI18n();
  const ai = useAi();
  const webSearch = useWebSearch();

  return (
    <section id="ai" aria-labelledby="ai-title" className="grid scroll-mt-20 gap-5">
      <h2 id="ai-title" className="text-xl">
        {t('ai.title')}
      </h2>
      <p className="max-w-prose">{t('ai.intro')}</p>

      {ai.isPending ? (
        <Loading />
      ) : ai.isError ? (
        <ErrorNote error={ai.error} />
      ) : (
        <>
          {!ai.data.activeProviderId && <p className="note">{t('ai.none')}</p>}
          {(['cli', 'api', 'local'] as const).map((kind) => (
            <div key={kind}>
              <h3 className="section-title">{t(`ai.kind.${kind}`)}</h3>
              <ul className="border-t border-line">
                {ai.data.providers
                  .filter((provider) => provider.kind === kind)
                  .map((provider) => (
                    <ProviderRow
                      key={provider.id}
                      provider={provider}
                      active={ai.data.activeProviderId === provider.id}
                    />
                  ))}
              </ul>
            </div>
          ))}
          <BudgetForm key={ai.data.contextBudgetTokens} value={ai.data.contextBudgetTokens} />
        </>
      )}

      <Link to="/ai/usage" className="link justify-self-start text-sm">
        {t('ai.usageLink')}
      </Link>

      {webSearch.data && (
        <WebSearchForm
          key={`${webSearch.data.provider}-${webSearch.data.hasBraveKey}-${webSearch.data.hasTavilyKey}`}
          settings={webSearch.data}
        />
      )}
    </section>
  );
}
