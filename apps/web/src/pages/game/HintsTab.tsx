import { HINT_LEVELS, type HintKind, type HintLevel, type HintResponse } from '@gamebacklog/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutation } from '../../api.ts';
import { assistApi, useHints } from '../../api-assist.ts';
import { Spoiler } from '../../components/Spoiler.tsx';
import { ErrorNote, Loading } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';
import { AreaMedia } from './AreaMedia.tsx';
import { SourceList } from './ChapterMapSection.tsx';
import { VoiceButton } from '../../components/VoiceButton.tsx';
import { appendDictation } from '../../voice/engine.ts';

const KINDS: [
  HintKind,
  'hintLadder.kindGeneral' | 'hintLadder.kindPuzzle' | 'hintLadder.kindBoss',
][] = [
  ['general', 'hintLadder.kindGeneral'],
  ['puzzle', 'hintLadder.kindPuzzle'],
  ['boss', 'hintLadder.kindBoss'],
];
const LEVEL_LABEL = {
  1: 'hintLadder.level1',
  2: 'hintLadder.level2',
  3: 'hintLadder.level3',
  4: 'hintLadder.level4',
} as const;

function HintText({
  hint,
}: {
  hint: Pick<HintResponse, 'level' | 'text' | 'basis' | 'sources'> & { cached?: boolean };
}) {
  const { t } = useI18n();
  const body = (
    <div className="grid gap-2">
      <p className="max-w-prose whitespace-pre-wrap">{hint.text}</p>
      {/* A hint from what the AI knows of the game says so: there is no page to check it on. */}
      {hint.basis === 'knowledge' && hint.sources.length === 0 ? (
        <p className="note">{t('hintLadder.fromKnowledge')}</p>
      ) : (
        <SourceList sources={hint.sources} label={t('hintLadder.sources')} />
      )}
    </div>
  );
  return (
    <div className="grid gap-2">
      {/* The full solution stays behind the shield until the user asks for it. */}
      {hint.level === 4 ? (
        <Spoiler label={t('hintLadder.spoiler')} action={t('hintLadder.reveal')}>
          {body}
        </Spoiler>
      ) : (
        body
      )}
      {hint.cached && <p className="note">{t('hintLadder.cached')}</p>}
    </div>
  );
}

/**
 * The hint ladder. Each level is fetched only when the user asks for it. Puzzles and general
 * help are climbed one level at a time; a boss can open at any level.
 */
function Ladder({ runId, kind, stuckOn }: { runId: string; kind: HintKind; stuckOn: string }) {
  const { t, locale } = useI18n();
  const [revealed, setRevealed] = useState<Partial<Record<HintLevel, HintResponse>>>({});
  const [loading, setLoading] = useState<HintLevel | null>(null);
  const ask = useApiMutation((level: HintLevel) =>
    assistApi.requestHint(runId, { kind, level, stuckOn: stuckOn.trim() || undefined, locale }),
  );

  const highest = Math.max(0, ...Object.keys(revealed).map(Number));
  const canOpen = (level: HintLevel) => kind === 'boss' || level <= highest + 1;

  return (
    <ol className="grid gap-4">
      {HINT_LEVELS.map((level) => {
        const hint = revealed[level];
        const label = t(LEVEL_LABEL[level]);
        return (
          <li key={level} className="grid gap-2 border-b border-line pb-4">
            <h3 className="font-medium">{label}</h3>
            {hint ? (
              <HintText hint={hint} />
            ) : loading === level ? (
              <p className="note" role="status">
                {t('hintLadder.loading')}
              </p>
            ) : canOpen(level) ? (
              <button
                type="button"
                className="btn justify-self-start"
                disabled={ask.isPending}
                onClick={() => {
                  setLoading(level);
                  ask.mutate(level, {
                    onSuccess: (response) =>
                      setRevealed((current) => ({ ...current, [level]: response })),
                    onSettled: () => setLoading(null),
                  });
                }}
              >
                {t('hintLadder.show', { level: label })}
              </button>
            ) : (
              <p className="note">{t('hintLadder.lockedLevel')}</p>
            )}
          </li>
        );
      })}
      <li aria-live="polite">
        <ErrorNote error={ask.error} />
      </li>
    </ol>
  );
}

export function HintsTab({ runId, initialKind }: { runId: string; initialKind: HintKind }) {
  const { t, locale } = useI18n();
  const hints = useHints(runId, locale);
  const [kind, setKind] = useState<HintKind>(initialKind);
  const [stuckOn, setStuckOn] = useState('');
  const stuckOnId = useId();
  // The ladder is tied to what was asked: changing the question starts a new one.
  const [asked, setAsked] = useState<{ kind: HintKind; stuckOn: string } | null>(null);

  if (hints.isPending) return <Loading />;
  if (hints.isError) return <ErrorNote error={hints.error} />;

  if (!hints.data.aiConnected) {
    return (
      <div className="grid gap-6">
        <section className="grid max-w-prose justify-items-start gap-3">
          <h2 className="section-title">{t('hintLadder.lockedTitle')}</h2>
          <p>{t('hintLadder.locked')}</p>
          <Link to="/settings#ai" className="btn btn-primary">
            {t('hintLadder.connect')}
          </Link>
        </section>
        {/* Maps and videos need no AI. */}
        <AreaMedia runId={runId} checkpointId={null} />
      </div>
    );
  }

  const earlier = hints.data.items;

  return (
    <div className="grid gap-6">
      <p className="note">
        {hints.data.checkpoint
          ? t('hintLadder.where', { name: hints.data.checkpoint })
          : t('hintLadder.whereUnknown')}
      </p>

      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setAsked({ kind, stuckOn });
        }}
      >
        <fieldset>
          <legend className="label">{t('hintLadder.kind')}</legend>
          <div className="flex flex-wrap gap-x-5">
            {KINDS.map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <input
                  type="radio"
                  name="hint-kind"
                  className="accent-accent"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {t(label)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={stuckOnId} className="label">
            {t('hintLadder.stuckOn')} ({t('app.optional')})
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={stuckOnId}
              className="field min-w-0 flex-1"
              maxLength={300}
              placeholder={t('hintLadder.stuckOnPlaceholder')}
              value={stuckOn}
              onChange={(event) => setStuckOn(event.target.value)}
            />
            <VoiceButton
              fieldLabel={t('hintLadder.stuckOn')}
              onText={(text) => setStuckOn((current) => appendDictation(current, text, 300))}
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary justify-self-start">
          {t('hintLadder.stuck')}
        </button>
      </form>

      {asked && (
        <Ladder
          key={`${asked.kind}|${asked.stuckOn}`}
          runId={runId}
          kind={asked.kind}
          stuckOn={asked.stuckOn}
        />
      )}

      {!asked && earlier.length > 0 && (
        <section className="grid gap-3">
          <h2 className="section-title">{t('hintLadder.earlier')}</h2>
          <ul className="grid gap-4">
            {earlier.map((item, index) => (
              <li key={index} className="grid gap-1 border-b border-line pb-4">
                <p className="text-sm text-muted">
                  {t(LEVEL_LABEL[item.level])}
                  {item.stuckOn && ` · ${item.stuckOn}`}
                </p>
                <HintText hint={item} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <AreaMedia runId={runId} checkpointId={null} />
    </div>
  );
}
