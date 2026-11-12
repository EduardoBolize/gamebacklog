import type { ChapterMapResponse, Checkpoint, Provenance } from '@gamebacklog/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useApiMutation } from '../../api.ts';
import { assistApi, useMap } from '../../api-assist.ts';
import { ErrorNote, Loading, Modal } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/index.tsx';

export function SourceList({ sources, label }: { sources: Provenance[]; label: string }) {
  const linked = sources.filter((source) => source.url);
  if (linked.length === 0) return null;
  return (
    <p className="note">
      {label}:{' '}
      {linked.map((source, index) => (
        <span key={source.url}>
          {index > 0 && ', '}
          <a href={source.url} target="_blank" rel="noreferrer" className="link break-all">
            {source.url
              ? new URL(source.url).hostname + decodeURIComponent(new URL(source.url).pathname)
              : ''}
          </a>
        </span>
      ))}
    </p>
  );
}

interface DraftStep {
  id?: string;
  key: string;
  name: string;
  aliases: string;
  isPointOfNoReturn: boolean;
  bossName: string;
}

let draftCounter = 0;
const newKey = () => `new-${++draftCounter}`;

function MapEditor({
  entryId,
  checkpoints,
  onDone,
}: {
  entryId: string;
  checkpoints: Checkpoint[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      key: checkpoint.id,
      name: checkpoint.name,
      aliases: checkpoint.aliases.join(', '),
      isPointOfNoReturn: checkpoint.isPointOfNoReturn,
      bossName: checkpoint.bossName ?? '',
    })),
  );
  const save = useApiMutation((body: Parameters<typeof assistApi.saveMap>[1]) =>
    assistApi.saveMap(entryId, body),
  );

  const change = (index: number, patch: Partial<DraftStep>) =>
    setSteps(steps.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    setSteps(next);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      {
        checkpoints: steps
          .filter((step) => step.name.trim())
          .map((step) => ({
            id: step.id,
            name: step.name.trim(),
            aliases: step.aliases
              .split(',')
              .map((alias) => alias.trim())
              .filter(Boolean),
            isPointOfNoReturn: step.isPointOfNoReturn,
            bossName: step.bossName.trim() || null,
          })),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <ol className="grid gap-4">
        {steps.map((step, index) => {
          const label = step.name || String(index + 1);
          return (
            <li key={step.key} className="grid gap-2 border-b border-line pb-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <label>
                  <span className="label">
                    {index + 1}. {t('map.name')}
                  </span>
                  <input
                    className="field"
                    maxLength={120}
                    value={step.name}
                    onChange={(event) => change(index, { name: event.target.value })}
                  />
                </label>
                <label>
                  <span className="label">{t('map.bossField')}</span>
                  <input
                    className="field"
                    maxLength={120}
                    value={step.bossName}
                    onChange={(event) => change(index, { bossName: event.target.value })}
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className="label">{t('map.aliases')}</span>
                  <input
                    className="field"
                    value={step.aliases}
                    onChange={(event) => change(index, { aliases: event.target.value })}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={step.isPointOfNoReturn}
                    onChange={(event) => change(index, { isPointOfNoReturn: event.target.checked })}
                  />
                  {t('map.isPointOfNoReturn')}
                </label>
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={t('map.moveUp', { name: label })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={t('map.moveDown', { name: label })}
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={t('map.removeStep', { name: label })}
                  onClick={() => setSteps(steps.filter((_, position) => position !== index))}
                >
                  {t('app.remove')}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn justify-self-start"
        onClick={() =>
          setSteps([
            ...steps,
            { key: newKey(), name: '', aliases: '', isPointOfNoReturn: false, bossName: '' },
          ])
        }
      >
        + {t('map.addStep')}
      </button>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t('app.save')}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t('app.cancel')}
        </button>
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}

function WikiField({ entryId, wikiUrl }: { entryId: string; wikiUrl: string | null }) {
  const { t } = useI18n();
  const [value, setValue] = useState(wikiUrl ?? '');
  const save = useApiMutation((url: string | null) => assistApi.setWiki(entryId, url));
  return (
    <form
      className="grid gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate(value.trim() || null);
      }}
    >
      <label>
        <span className="label">
          {t('map.wiki')} {!wikiUrl && `(${t('map.wikiNone')})`}
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="field font-mono"
            type="url"
            placeholder={t('map.wikiPlaceholder')}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" className="btn shrink-0" disabled={save.isPending}>
            {t('map.wikiSave')}
          </button>
        </div>
      </label>
      <ErrorNote error={save.error} />
    </form>
  );
}

/**
 * The chapter map in the Progress tab. Steps beyond the next one stay hidden until the user asks
 * for the whole map: area names are spoilers too.
 */
export function ChapterMapSection({
  entryId,
  runId,
  onMove,
}: {
  entryId: string;
  runId: string;
  /** Called when the user says "I'm here" on a step. */
  onMove: (checkpointId: string) => void;
}) {
  const { t, tn, locale } = useI18n();
  const map = useMap(runId);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const generate = useApiMutation((force: boolean) =>
    assistApi.generateMap(entryId, force, locale),
  );
  const markDone = useApiMutation((input: { checkpointId: string; done: boolean }) =>
    assistApi.setCheckpointDone(runId, input.checkpointId, input.done),
  );

  if (map.isPending) return <Loading />;
  if (map.isError) return <ErrorNote error={map.error} />;

  const data: ChapterMapResponse = map.data;
  const steps = data.map?.checkpoints ?? [];
  const current = steps.find((step) => step.id === data.currentCheckpointId);
  const currentPosition = current?.position ?? 0;
  const completed = new Set(data.completedCheckpointIds);
  const reachable = new Set(current?.leadsTo ?? []);
  // Up to the step right after the current one, plus what is finished or one branch away.
  const visible = showAll
    ? steps
    : steps.filter(
        (step) =>
          step.position <= currentPosition + 1 || completed.has(step.id) || reachable.has(step.id),
      );
  const hiddenCount = steps.length - visible.length;

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="section-title">{t('map.title')}</h2>
        {data.map && (
          <span className="note">
            {t(`map.origin.${data.map.origin}`)}
            {data.map.isUserEdited && ` · ${t('map.edited')}`}
          </span>
        )}
      </div>

      {steps.length === 0 ? (
        <p className="text-muted">
          {t('map.none')} {data.aiConnected ? t('map.noneWithAi') : t('map.noneWithoutAi')}
        </p>
      ) : (
        <ol className="grid gap-1">
          {visible.map((step) => {
            const isCurrent = step.id === data.currentCheckpointId;
            const isDone = completed.has(step.id);
            return (
              <li
                key={step.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  aria-label={t('map.markDone', { name: step.name })}
                  checked={isDone}
                  disabled={markDone.isPending}
                  onChange={(event) =>
                    markDone.mutate({ checkpointId: step.id, done: event.target.checked })
                  }
                />
                <span className="w-6 tabular-nums text-muted">{step.position}</span>
                <span
                  className={`min-w-0 flex-1 ${isCurrent ? 'font-semibold' : ''} ${isDone && !isCurrent ? 'text-muted' : ''}`}
                >
                  {step.name}
                  {isDone && !isCurrent && <span className="ml-2">✓ {t('map.done')}</span>}
                  {isCurrent && <span className="ml-2 text-accent">← {t('map.youAreHere')}</span>}
                  {step.isPointOfNoReturn && (
                    <span className="ml-2 text-danger">{t('map.pointOfNoReturn')}</span>
                  )}
                  {step.requirement && !isDone && (
                    <span className="ml-2 font-normal text-muted">
                      {t('map.needs', { name: step.requirement })}
                    </span>
                  )}
                  {step.bossName && (step.position <= currentPosition || isDone) && (
                    <span className="ml-2 font-normal text-muted">
                      {t('map.boss', { name: step.bossName })}
                    </span>
                  )}
                </span>
                {!isCurrent && (
                  <button type="button" className="btn-quiet" onClick={() => onMove(step.id)}>
                    {t('map.setHere')}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hiddenCount > 0 && (
        <p className="note">
          {tn('map.hiddenAhead', hiddenCount)}{' '}
          <button type="button" className="btn-quiet" onClick={() => setShowAll(true)}>
            {t('map.showAll')}
          </button>
        </p>
      )}

      {data.map && <SourceList sources={data.map.sources} label={t('map.sources')} />}
      <ErrorNote error={markDone.error} />

      <div className="flex flex-wrap gap-2">
        {data.aiConnected && (
          <button
            type="button"
            className="btn"
            disabled={generate.isPending}
            onClick={() => {
              if (steps.length > 0 && !window.confirm(t('map.confirmRegenerate'))) return;
              generate.mutate(steps.length > 0);
            }}
          >
            {generate.isPending
              ? t('map.generating')
              : steps.length > 0
                ? t('map.regenerate')
                : t('map.generate')}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          {steps.length > 0 ? t('map.edit') : t('map.write')}
        </button>
      </div>
      <ErrorNote error={generate.error} />
      <p className="note">{t('map.mapsElsewhere')}</p>

      <WikiField key={data.wikiUrl ?? 'none'} entryId={entryId} wikiUrl={data.wikiUrl} />

      <Modal open={editing} onClose={() => setEditing(false)} title={t('map.editTitle')}>
        <MapEditor entryId={entryId} checkpoints={steps} onDone={() => setEditing(false)} />
      </Modal>
    </section>
  );
}
