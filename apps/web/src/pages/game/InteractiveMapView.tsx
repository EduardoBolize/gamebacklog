import type { InteractiveMap } from '@gamebacklog/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { useI18n } from '../../i18n/index.tsx';

/**
 * Draws a wiki's interactive map with no map library: the background image inside a box that
 * is moved and scaled with a CSS transform, and the markers placed on it as buttons that keep
 * their size on screen. Drag to pan, wheel or keys to zoom; everything also has a button.
 */

type Marker = InteractiveMap['markers'][number];
interface View {
  scale: number;
  x: number;
  y: number;
}

/** How far in a zoom goes: twice the size of the image the wiki served. */
const MAX_SCALE = 2;
const STEP = 1.4;
const PAN = 80;
const MAX_RESULTS = 30;

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function InteractiveMapView({ map }: { map: InteractiveMap }) {
  const { t, tn } = useI18n();
  const searchId = useId();
  const here = useMemo(() => new Set(map.highlights.here), [map.highlights.here]);
  const next = useMemo(() => new Set(map.highlights.next), [map.highlights.next]);
  const hereMarker = map.markers.find((marker) => here.has(marker.id)) ?? null;

  const [layerId, setLayerId] = useState(() => hereMarker?.layerId ?? map.layers[0]?.id ?? '');
  const layer = map.layers.find((option) => option.id === layerId) ?? map.layers[0];
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedLayer, setLoadedLayer] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  const viewLayer = useRef<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);

  const categories = useMemo(
    () => new Map(map.categories.map((category) => [category.id, category])),
    [map.categories],
  );

  // Track the size of the frame, which follows the page width.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitScale = layer ? Math.min(size.width / layer.width, size.height / layer.height) || 1 : 1;
  const minScale = fitScale * 0.8;
  const clamp = (scale: number) =>
    Math.min(Math.max(scale, minScale), Math.max(MAX_SCALE, fitScale));

  function fitted(): View {
    if (!layer) return { scale: 1, x: 0, y: 0 };
    return {
      scale: fitScale,
      x: (size.width - layer.width * fitScale) / 2,
      y: (size.height - layer.height * fitScale) / 2,
    };
  }

  function centeredOn(marker: Marker, scale: number, target = layer): View {
    if (!target) return fitted();
    return {
      scale,
      x: size.width / 2 - marker.x * target.width * scale,
      y: size.height / 2 - marker.y * target.height * scale,
    };
  }

  // First view of a layer: centred on where the run is, when the map knows; else the whole map.
  useEffect(() => {
    if (!layer || size.width === 0 || viewLayer.current === layer.id) return;
    viewLayer.current = layer.id;
    const marker = hereMarker && (hereMarker.layerId ?? layer.id) === layer.id ? hereMarker : null;
    setView(marker ? centeredOn(marker, clamp(fitScale * 3)) : fitted());
    // Only when the layer changes or the frame first gets a size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, size.width > 0]);

  function zoomAt(factor: number, cx = size.width / 2, cy = size.height / 2) {
    setView((current) => {
      if (!current) return current;
      const scale = clamp(current.scale * factor);
      const ratio = scale / current.scale;
      return { scale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    });
  }

  // The wheel listener has to be non-passive to keep the page from scrolling while zooming.
  const zoomRef = useRef(zoomAt);
  useEffect(() => {
    zoomRef.current = zoomAt;
  });
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomRef.current(
        event.deltaY < 0 ? 1.2 : 1 / 1.2,
        event.clientX - box.left,
        event.clientY - box.top,
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!view || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    setView(
      (current) =>
        current && {
          ...current,
          x: start.x + event.clientX - start.startX,
          y: start.y + event.clientY - start.startY,
        },
    );
  }
  function onPointerUp() {
    drag.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [PAN, 0],
      ArrowRight: [-PAN, 0],
      ArrowUp: [0, PAN],
      ArrowDown: [0, -PAN],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setView(
        (current) => current && { ...current, x: current.x + move[0], y: current.y + move[1] },
      );
    } else if (event.key === '+' || event.key === '=') {
      zoomAt(STEP);
    } else if (event.key === '-') {
      zoomAt(1 / STEP);
    } else if (event.key === '0') {
      setView(fitted());
    }
  }

  function focus(marker: Marker) {
    const target = map.layers.find((option) => option.id === marker.layerId) ?? layer;
    if (target && target.id !== layer?.id) {
      viewLayer.current = target.id;
      setLayerId(target.id);
    }
    const scale = clamp(Math.max(view?.scale ?? 0, fitScale * 3));
    setView(centeredOn(marker, scale, target));
    setSelectedId(marker.id);
    if (hidden.has(marker.categoryId)) {
      setHidden(new Set([...hidden].filter((id) => id !== marker.categoryId)));
    }
  }

  const visible = useMemo(
    () =>
      map.markers.filter(
        (marker) =>
          (marker.layerId === null || marker.layerId === layer?.id) &&
          !hidden.has(marker.categoryId),
      ),
    [map.markers, layer?.id, hidden],
  );

  // Markers do not depend on the view, so dragging does not rebuild them.
  const markerButtons = useMemo(
    () =>
      layer &&
      visible.map((marker) => {
        const category = categories.get(marker.categoryId);
        const isHere = here.has(marker.id);
        const isNext = next.has(marker.id);
        const ring = isHere
          ? 'outline-3 outline-accent'
          : isNext
            ? 'outline-2 outline-dashed outline-accent'
            : selectedId === marker.id
              ? 'outline-2 outline-text'
              : '';
        return (
          <button
            key={marker.id}
            type="button"
            title={marker.title}
            aria-label={isHere ? `${marker.title} (${t('gameMaps.here')})` : marker.title}
            aria-pressed={selectedId === marker.id}
            onClick={() => setSelectedId(marker.id)}
            className={`absolute grid h-7 w-7 cursor-pointer place-items-center rounded-full ${ring} ${isHere || isNext ? 'z-10' : ''}`}
            style={{
              left: marker.x * layer.width,
              top: marker.y * layer.height,
              transform: 'translate(-50%, -50%) scale(var(--marker-scale))',
            }}
          >
            {category?.iconUrl ? (
              <img
                src={category.iconUrl}
                alt=""
                width={24}
                height={24}
                draggable={false}
                referrerPolicy="no-referrer"
                className="pointer-events-none h-6 w-6 object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-full border-2 border-black/60"
                style={{ background: category?.color ?? 'var(--color-accent)' }}
              />
            )}
            {isHere && (
              <span className="pointer-events-none absolute top-full mt-1 whitespace-nowrap rounded-base bg-bg px-1.5 text-xs font-semibold text-accent">
                {t('gameMaps.here')}
              </span>
            )}
          </button>
        );
      }),
    [visible, categories, here, next, selectedId, layer, t],
  );

  const results = useMemo(() => {
    const wanted = fold(query.trim());
    if (!wanted) return [];
    return map.markers.filter((marker) => fold(marker.title).includes(wanted));
  }, [map.markers, query]);
  const selected = map.markers.find((marker) => marker.id === selectedId) ?? null;

  if (!layer) return null;
  const frameStyle = { '--marker-scale': view ? 1 / view.scale : 1 } as CSSProperties;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="grid min-w-0 content-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {map.layers.length > 1 && (
            <label className="flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto">
              <span className="text-muted">{t('gameMaps.layer')}</span>
              <select
                className="field min-w-0 flex-1 sm:flex-none sm:!w-auto"
                value={layer.id}
                onChange={(event) => setLayerId(event.target.value)}
              >
                {map.layers.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn"
            aria-label={t('gameMaps.zoomIn')}
            onClick={() => zoomAt(STEP)}
          >
            +
          </button>
          <button
            type="button"
            className="btn"
            aria-label={t('gameMaps.zoomOut')}
            onClick={() => zoomAt(1 / STEP)}
          >
            −
          </button>
          <button type="button" className="btn" onClick={() => setView(fitted())}>
            {t('gameMaps.fit')}
          </button>
          {hereMarker && (
            <button type="button" className="btn" onClick={() => focus(hereMarker)}>
              {t('gameMaps.goHere')}
            </button>
          )}
        </div>

        <div
          ref={frame}
          role="group"
          tabIndex={0}
          aria-label={t('gameMaps.canvas', { name: map.title })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          style={frameStyle}
          className="relative h-[65vh] min-h-72 cursor-grab touch-none select-none overflow-hidden rounded-base border border-line bg-surface active:cursor-grabbing"
        >
          {view && (
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: layer.width,
                height: layer.height,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
            >
              <img
                key={layer.id}
                src={layer.imageUrl}
                alt=""
                width={layer.width}
                height={layer.height}
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={() => setLoadedLayer(layer.id)}
                className="pointer-events-none block max-w-none"
                style={{ width: layer.width, height: layer.height }}
              />
              {markerButtons}
            </div>
          )}
          {loadedLayer !== layer.id && (
            <p className="note absolute inset-x-0 top-3 text-center" role="status">
              {t('gameMaps.loadingImage')}
            </p>
          )}
        </div>
        <p className="note">{t('gameMaps.help')}</p>
        <p className="note">
          {t('gameMaps.credit', { wiki: map.wikiName })}{' '}
          <a href={map.pageUrl} target="_blank" rel="noreferrer" className="link">
            {t('gameMaps.openMapPage')}
          </a>
        </p>
      </div>

      <aside className="grid min-w-0 content-start gap-4">
        <div className="grid gap-1">
          <label htmlFor={searchId} className="label">
            {t('gameMaps.search')}
          </label>
          <input
            id={searchId}
            type="search"
            className="field"
            placeholder={t('gameMaps.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.trim() && (
            <>
              <p className="note" role="status">
                {tn('gameMaps.results', results.length)}
              </p>
              <ul className="grid max-h-56 gap-0.5 overflow-y-auto text-sm">
                {results.slice(0, MAX_RESULTS).map((marker) => (
                  <li key={marker.id}>
                    <button
                      type="button"
                      className="btn-quiet w-full text-left"
                      onClick={() => focus(marker)}
                    >
                      {marker.title}
                      <span className="ml-1 text-muted">
                        · {categories.get(marker.categoryId)?.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {selected && (
          <div className="grid gap-2 rounded-base border border-line p-3" aria-live="polite">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">
                {selected.title}
                {here.has(selected.id) && (
                  <span className="ml-2 text-sm font-normal text-accent">{t('gameMaps.here')}</span>
                )}
                {next.has(selected.id) && (
                  <span className="ml-2 text-sm font-normal text-muted">{t('gameMaps.next')}</span>
                )}
              </p>
              <button
                type="button"
                className="btn-quiet"
                aria-label={t('gameMaps.close')}
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
            </div>
            <p className="note">{categories.get(selected.categoryId)?.name}</p>
            {selected.imageUrl && (
              <img
                src={selected.imageUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="max-h-40 w-full rounded-base object-cover"
              />
            )}
            {selected.description && (
              <p className="whitespace-pre-line text-sm">{selected.description}</p>
            )}
            {selected.link && (
              <a href={selected.link} target="_blank" rel="noreferrer" className="link text-sm">
                {t('gameMaps.openOnWiki')}
              </a>
            )}
          </div>
        )}

        {map.categories.length > 1 && (
          <fieldset className="grid gap-1">
            <legend className="label">{t('gameMaps.categories')}</legend>
            <div className="flex gap-3 text-sm">
              <button type="button" className="btn-quiet" onClick={() => setHidden(new Set())}>
                {t('gameMaps.all')}
              </button>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => setHidden(new Set(map.categories.map((category) => category.id)))}
              >
                {t('gameMaps.noneShown')}
              </button>
            </div>
            <ul className="grid max-h-80 gap-0.5 overflow-y-auto text-sm">
              {map.categories.map((category) => (
                <li key={category.id}>
                  <label className="flex min-h-9 items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={!hidden.has(category.id)}
                      onChange={(event) => {
                        const nextHidden = new Set(hidden);
                        if (event.target.checked) nextHidden.delete(category.id);
                        else nextHidden.add(category.id);
                        setHidden(nextHidden);
                      }}
                    />
                    {category.iconUrl ? (
                      <img
                        src={category.iconUrl}
                        alt=""
                        width={20}
                        height={20}
                        referrerPolicy="no-referrer"
                        className="h-5 w-5 object-contain"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-full border border-black/60"
                        style={{ background: category.color ?? 'var(--color-accent)' }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{category.name}</span>
                    <span className="tabular-nums text-muted">{category.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </aside>
    </div>
  );
}
