import { Link } from 'react-router';
import { useAiUsage } from '../api-assist.ts';
import { ErrorNote, Loading } from '../components/ui.tsx';
import { useI18n, type MessageKey } from '../i18n/index.tsx';

/** Every AI request, newest first, so the user can see what was spent and what the cache saved. */
export function AiUsagePage() {
  const { t, formatDateTime, formatNumber } = useI18n();
  const usage = useAiUsage();

  const featureName = (feature: string) => {
    const key = `usage.feature.${feature}`;
    const label = t(key as MessageKey);
    return label === key ? feature : label;
  };

  return (
    <section className="grid gap-5">
      <Link to="/settings#ai" className="btn-quiet justify-self-start">
        ← {t('nav.settings')}
      </Link>
      <h1 className="text-2xl">{t('usage.title')}</h1>
      <p className="note max-w-prose">{t('usage.intro')}</p>

      {usage.isPending ? (
        <Loading />
      ) : usage.isError ? (
        <ErrorNote error={usage.error} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            {(
              [
                ['usage.requests', usage.data.totals.requests],
                ['usage.cacheHits', usage.data.totals.cacheHits],
                ['usage.inputTokens', usage.data.totals.inputTokens],
                ['usage.outputTokens', usage.data.totals.outputTokens],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="label">{t(label)}</dt>
                <dd className="text-2xl tabular-nums">{formatNumber(value, 0)}</dd>
              </div>
            ))}
          </dl>
          <p className="note">{t('usage.estimated')}</p>

          {usage.data.items.length === 0 ? (
            <p className="text-muted">{t('usage.empty')}</p>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    {(
                      [
                        'usage.colWhen',
                        'usage.colFeature',
                        'usage.colGame',
                        'usage.colProvider',
                        'usage.colTokens',
                        'usage.colTime',
                        'usage.colResult',
                      ] as const
                    ).map((label) => (
                      <th key={label} scope="col" className="py-2 pr-4 font-normal">
                        {t(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usage.data.items.map((item) => (
                    <tr key={item.id} className="border-b border-line align-top">
                      <td className="py-2 pr-4 tabular-nums">{formatDateTime(item.createdAt)}</td>
                      <td className="py-2 pr-4">{featureName(item.feature)}</td>
                      <td className="py-2 pr-4">{item.gameTitle ?? t('app.none')}</td>
                      <td className="py-2 pr-4">
                        {[item.providerId, item.model].filter(Boolean).join(' · ') || t('app.none')}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {item.cacheHit
                          ? '0 / 0'
                          : `${formatNumber(item.inputTokensEstimated, 0)} / ${formatNumber(item.outputTokensEstimated, 0)}`}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {item.cacheHit
                          ? t('app.none')
                          : `${formatNumber(item.durationMs / 1000)} s`}
                      </td>
                      <td className={`py-2 ${item.success ? '' : 'text-danger'}`}>
                        {item.cacheHit
                          ? t('usage.cache')
                          : item.success
                            ? t('usage.ok')
                            : t('usage.failed', { code: item.errorCode ?? '' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
