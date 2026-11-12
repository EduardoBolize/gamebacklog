import { z } from 'zod';

/**
 * Reads the two interactive map formats MediaWiki game wikis use, and turns both into one
 * shape the web draws without any map library: image layers, categories, and markers placed
 * as fractions of the image.
 *
 * - Fandom "Interactive Maps": one JSON page per map in the `Map:` namespace, content model
 *   `interactivemap` (mapImage, mapBounds, coordinateOrder, origin, categories, markers).
 * - DataMaps (wiki.gg and others): JSON page with content model `datamap` (crs, backgrounds,
 *   groups) plus the extension's `queryDataMap` API, which returns the markers already in
 *   [y, x] order with rendered descriptions.
 *
 * Both formats are edited by hand on the wikis, so parsing is lenient: anything unexpected is
 * skipped instead of failing the whole map.
 */

/** A map with file names still to be turned into image URLs. */
export interface MapDraft {
  layers: { id: string; name: string; file: string }[];
  categories: { id: string; name: string; color: string | null; iconFile: string | null }[];
  markers: {
    id: string;
    categoryId: string;
    layerId: string | null;
    x: number;
    y: number;
    title: string;
    description: string | null;
    imageUrl: string | null;
    /** Full URL, or a page title of the same wiki. */
    link: string | null;
  }[];
}

const point = z.tuple([z.number(), z.number()]);
const box = z.tuple([point, point]);

/** Keeps markers that fall on the image (a little slack for markers on the very edge). */
const onImage = (x: number, y: number) =>
  Number.isFinite(x) && Number.isFinite(y) && x >= -0.01 && x <= 1.01 && y >= -0.01 && y <= 1.01;

/** Plain text from the small bits of HTML or wiki markup marker descriptions carry. */
export function plainText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
  // Editors leave placeholders such as "INSERTDESCRIPTIONHERE" in unfinished markers.
  if (!text || /^[A-Z_]{12,}$/.test(text)) return null;
  return text.slice(0, 600);
}

// --- Fandom ----------------------------------------------------------------------------------

const fandomSchema = z.object({
  mapImage: z.string().min(1),
  mapBounds: box,
  coordinateOrder: z.enum(['xy', 'yx']).catch('yx').default('yx'),
  origin: z.enum(['top-left', 'bottom-left']).catch('bottom-left').default('bottom-left'),
  categories: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        name: z.string().catch(''),
        color: z.string().nullish().catch(null),
      }),
    )
    .catch([])
    .default([]),
  markers: z
    .array(
      z
        .object({
          id: z.union([z.string(), z.number()]).transform(String).optional(),
          categoryId: z.union([z.string(), z.number()]).transform(String),
          position: point,
          popup: z
            .object({
              title: z.string().catch(''),
              description: z.string().nullish().catch(null),
              link: z
                .object({ url: z.string().nullish().catch(null) })
                .nullish()
                .catch(null),
            })
            .catch({ title: '', description: null, link: null }),
        })
        .nullable()
        .catch(null),
    )
    .catch([])
    .default([]),
});

export function parseFandomMap(raw: unknown, title: string): MapDraft | null {
  const parsed = fandomSchema.safeParse(raw);
  if (!parsed.success) return null;
  const map = parsed.data;
  const swap = (value: [number, number]) =>
    map.coordinateOrder === 'xy' ? value : ([value[1], value[0]] as [number, number]);
  const [a, b] = map.mapBounds.map(swap) as [[number, number], [number, number]];
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  if (maxX === minX || maxY === minY) return null;

  const markers: MapDraft['markers'] = [];
  map.markers.forEach((marker, index) => {
    if (!marker) return;
    const [x, y] = swap(marker.position);
    const fx = (x - minX) / (maxX - minX);
    const fy =
      map.origin === 'bottom-left' ? (maxY - y) / (maxY - minY) : (y - minY) / (maxY - minY);
    if (!onImage(fx, fy)) return;
    markers.push({
      id: marker.id ?? String(index + 1),
      categoryId: marker.categoryId,
      layerId: null,
      x: fx,
      y: fy,
      title: marker.popup.title.trim() || title,
      description: plainText(marker.popup.description),
      imageUrl: null,
      link: marker.popup.link?.url?.trim() || null,
    });
  });

  return {
    layers: [{ id: 'main', name: title, file: map.mapImage }],
    categories: map.categories.map((category) => ({
      id: category.id,
      name: category.name || category.id,
      color: category.color?.trim() || null,
      iconFile: null,
    })),
    markers,
  };
}

// --- DataMaps --------------------------------------------------------------------------------

const crsObject = z.object({
  order: z.enum(['yx', 'latlon', 'xy', 'lonlat']).catch('yx').optional(),
  topLeft: point.optional(),
  bottomRight: point.optional(),
  origin: z.enum(['topLeft', 'bottomLeft']).catch('topLeft').optional(),
});

const dataMapSchema = z.object({
  crs: z.union([box, crsObject]).optional().catch(undefined),
  coordinateOrder: z.enum(['yx', 'latlon', 'xy', 'lonlat']).optional().catch(undefined),
  image: z.string().optional().catch(undefined),
  backgrounds: z
    .array(
      z.object({
        name: z.string().optional().catch(undefined),
        image: z.string().optional().catch(undefined),
        at: box.optional().catch(undefined),
        associatedLayer: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
  groups: z
    .record(
      z.string(),
      z.object({
        name: z.string().catch(''),
        icon: z.string().optional().catch(undefined),
        fillColor: z.string().optional().catch(undefined),
        pinColor: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
});

/** Markers as `queryDataMap` returns them: `{ "group layer bg:x": [[y, x, props], …] }`. */
const dataMapMarkersSchema = z.record(
  z.string(),
  z.array(
    z
      .tuple([
        z.number(),
        z.number(),
        z
          .object({
            uid: z.union([z.string(), z.number()]).transform(String).optional(),
            label: z.string().optional().catch(undefined),
            desc: z.string().optional().catch(undefined),
            image: z.array(z.unknown()).optional().catch(undefined),
            article: z.string().optional().catch(undefined),
          })
          .catch({}),
      ])
      .nullable()
      .catch(null),
  ),
);
export type DataMapMarkers = z.infer<typeof dataMapMarkersSchema>;
export const parseDataMapMarkers = (raw: unknown): DataMapMarkers =>
  dataMapMarkersSchema.catch({}).parse(raw);

const DEFAULT_BOX: [[number, number], [number, number]] = [
  [0, 0],
  [100, 100],
];

export function parseDataMap(
  raw: unknown,
  markersByKey: DataMapMarkers,
  title: string,
  wikiOrigin: string,
): MapDraft | null {
  const parsed = dataMapSchema.safeParse(raw);
  if (!parsed.success) return null;
  const map = parsed.data;

  // Coordinates of the corners, in [y, x] once the declared order is applied.
  const crs = map.crs;
  const order = (Array.isArray(crs) ? map.coordinateOrder : crs?.order) ?? map.coordinateOrder;
  const flip = order === 'xy' || order === 'lonlat';
  const yx = (value: [number, number]): [number, number] => (flip ? [value[1], value[0]] : value);
  const corners: [[number, number], [number, number]] = Array.isArray(crs)
    ? [yx(crs[0]), yx(crs[1])]
    : [yx(crs?.topLeft ?? DEFAULT_BOX[0]), yx(crs?.bottomRight ?? DEFAULT_BOX[1])];
  const [topLeft, bottomRight] = corners;
  const declaredOrigin = Array.isArray(crs) ? undefined : crs?.origin;
  // Older maps say where the origin is by which corner holds the smaller numbers.
  const bottomOrigin = declaredOrigin
    ? declaredOrigin === 'bottomLeft'
    : !(topLeft[0] < bottomRight[0] && topLeft[1] < bottomRight[1]);

  const backgrounds =
    map.backgrounds && map.backgrounds.length > 0
      ? map.backgrounds
      : map.image
        ? [{ name: title, image: map.image, at: undefined, associatedLayer: undefined }]
        : [];
  const layers = backgrounds.flatMap((background, index) =>
    background.image
      ? [
          {
            id: background.associatedLayer ?? `bg${index}`,
            name: background.name ?? title,
            file: background.image,
            at: background.at ? ([yx(background.at[0]), yx(background.at[1])] as const) : null,
          },
        ]
      : [],
  );
  if (layers.length === 0) return null;

  const frameOf = (layerId: string | null) => {
    const at = layers.find((layer) => layer.id === layerId)?.at ?? null;
    const [a, b] = at ?? corners;
    return {
      minY: Math.min(a[0], b[0]),
      maxY: Math.max(a[0], b[0]),
      minX: Math.min(a[1], b[1]),
      maxX: Math.max(a[1], b[1]),
    };
  };

  const counts = new Map<string, number>();
  const markers: MapDraft['markers'] = [];
  for (const [key, list] of Object.entries(markersByKey)) {
    const tokens = key.split(/\s+/).filter(Boolean);
    const groupId = tokens[0];
    if (!groupId) continue;
    const background = tokens.find((token) => token.startsWith('bg:'))?.slice(3) ?? null;
    const layerId =
      background && layers.some((layer) => layer.id === background) ? background : null;
    const frame = frameOf(layerId);
    if (frame.maxX === frame.minX || frame.maxY === frame.minY) continue;

    list.forEach((entry, index) => {
      if (!entry) return;
      const [y, x, props] = entry;
      const fx = (x - frame.minX) / (frame.maxX - frame.minX);
      const fy = bottomOrigin
        ? (frame.maxY - y) / (frame.maxY - frame.minY)
        : (y - frame.minY) / (frame.maxY - frame.minY);
      if (!onImage(fx, fy)) return;
      const image = typeof props.image?.[0] === 'string' ? props.image[0] : null;
      markers.push({
        id: props.uid ?? `${groupId}-${index}`,
        categoryId: groupId,
        layerId,
        x: fx,
        y: fy,
        title: plainText(props.label) ?? map.groups?.[groupId]?.name ?? groupId,
        description: plainText(props.desc),
        imageUrl: image ? new URL(image, wikiOrigin).toString() : null,
        link: props.article?.trim() || null,
      });
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    });
  }

  const groups = map.groups ?? {};
  const categoryIds = [...new Set([...Object.keys(groups), ...counts.keys()])];
  return {
    layers: layers.map(({ id, name, file }) => ({ id, name, file })),
    categories: categoryIds.map((id) => ({
      id,
      name: groups[id]?.name || id,
      color: groups[id]?.fillColor ?? groups[id]?.pinColor ?? null,
      iconFile: groups[id]?.icon?.replace(/^(File|Arquivo|Ficheiro):/i, '') ?? null,
    })),
    markers,
  };
}
