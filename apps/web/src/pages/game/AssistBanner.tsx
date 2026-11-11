import type { GameAssistResponse } from '@gamebacklog/shared';
import { useState } from 'react';
import { useAssist } from '../../api-assist.ts';
import { Spoiler } from '../../components/Spoiler.tsx';
import { useI18n } from '../../i18n/index.tsx';

type Question = GameAssistResponse['questions'][number];

/**
 * "Where you left off" for a run that went quiet, and questions the app can ask on its own
 * from what it already knows. Nothing here calls the AI.
 */
export function AssistBanner({
  runId,
  onQuestion,
}: {
  runId: string;
  onQuestion: (question: Question) => void;
}) {
  const { t, tn, formatDate } = useI18n();
  const assist = useAssist(runId);
  const [dismissed, setDismissed] = useState(false);
  if (!assist.data) return null;
  const { recap, questions } = assist.data;
  if (!recap && questions.length === 0) return null;

  const text = (question: Question) => {
    const name = question.subject ?? '';
    if (question.kind === 'boss_hint') return t('assist.bossQuestion', { name });
    if (question.kind === 'collectibles') {
      return tn('assist.collectiblesQuestion', question.count ?? 0, { name });
    }
    return tn('assist.missablesQuestion', question.count ?? 0, { name });
  };

  return (
    <div className="grid gap-4">
      {recap && !dismissed && (
        <section className="grid gap-3 rounded-base border border-line p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-title">{t('assist.recapTitle')}</h2>
            <button type="button" className="btn-quiet" onClick={() => setDismissed(true)}>
              {t('assist.dismiss')}
            </button>
          </div>
          <p className="text-muted">{tn('assist.recapIdle', recap.daysIdle)}</p>
          <dl className="grid gap-2 text-sm">
            {recap.currentCheckpoint && (
              <div>
                <dt className="label">{t('assist.recapAt')}</dt>
                <dd>{recap.currentCheckpoint}</dd>
              </div>
            )}
            {recap.lastProgress?.rawText && (
              <div>
                <dt className="label">
                  {t('assist.recapLast')} · {formatDate(recap.lastProgress.occurredAt)}
                </dt>
                <dd>“{recap.lastProgress.rawText}”</dd>
              </div>
            )}
            {recap.lastNotes.length > 0 && (
              <div>
                <dt className="label">{t('assist.recapNotes')}</dt>
                <dd>
                  <ul className="grid gap-1">
                    {recap.lastNotes.map((note) => (
                      <li key={note.startedAt}>
                        <span className="tabular-nums text-muted">
                          {formatDate(note.startedAt)}
                        </span>{' '}
                        · {note.note}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {recap.nextCheckpoint && (
              <div>
                <dt className="label">{t('assist.recapNext')}</dt>
                <dd>
                  {/* The name of what comes next can be a spoiler. */}
                  <Spoiler inline>{recap.nextCheckpoint}</Spoiler>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {questions.length > 0 && (
        <ul className="grid gap-1">
          {questions.map((question) => (
            <li key={question.kind}>
              <button
                type="button"
                className="link text-left text-sm"
                onClick={() => onQuestion(question)}
              >
                {text(question)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
