import {
  TASTE_DIMENSIONS,
  type CatalogReach,
  type ExplainRecommendationsRequest,
  type ExplainRecommendationsResponse,
  type FavoriteGenreResponse,
  type LibraryStatus,
  type PlayNextResponse,
  type Provenance,
  type RecommendationList,
  type RecommendedGame,
  type SimilarCompletionResponse,
  type SimilarGamesResponse,
  type TasteProfileResponse,
} from '@gamebacklog/shared';
import { eq, inArray } from 'drizzle-orm';
import { readAiCache, runAiTask } from '../ai/pipeline.ts';
import {
  RECOMMENDATION_REASONS_PROMPT_VERSION,
  buildRecommendationReasonsPrompt,
  recommendationReasonsSchema,
  type RecommendationFacts,
  type RecommendationReasons,
} from '../ai/prompts/recommendation-reasons.ts';
import type { AppContext } from '../context.ts';
import type { AppDatabase } from '../db/client.ts';
import {
  achievements,
  gameExternalIds,
  gameTimes,
  games,
  libraryEntries,
  playthroughs,
  reviews,
} from '../db/schema/index.ts';
import { badRequest, notFound } from '../errors.ts';
import { pickEffectiveTimes } from '../library/times.ts';
import { SourceError } from '../sources/adapter.ts';
import type { CatalogGameData } from '../sources/types.ts';
import {
  buildTasteProfile,
  scoreGame,
  topFeatures,
  type GameFeatures,
  type TasteProfile,
  type TasteSignal,
} from './profile.ts';
import { achievementShape, featureSimilarity, shapeSimilarity } from './similarity.ts';

/**
 * Recommendations. Everything here is computed from the library and the catalog; the only
 * thing the AI may add is one line of text per game, on request and cached.
 */

type Locale = ExplainRecommendationsRequest['locale'];

const eqText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// --- Library snapshot ------------------------------------------------------------

interface LibraryGame {
  entryId: string;
  gameId: string;
  status: LibraryStatus;
  isFavorite: boolean;
  /** Platform the user plays it on. */
  platform: string | null;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  features: GameFeatures;
  score: number | null;
  igdbId: string | null;
  steamAppIds: string[];
  playedMinutes: number | null;
  mainMinutes: number | null;
  completionistMinutes: number | null;
}

interface Snapshot {
  library: LibraryGame[];
  profile: TasteProfile;
  /** False while no game says anything about taste. */
  ready: boolean;
  byIgdbId: Map<string, LibraryGame>;
  bySteamAppId: Map<string, LibraryGame>;
}

function group<T, K>(rows: T[], keyOf: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/** The score that represents an entry: its game-level review, else the mean of its run reviews. */
function entryScore(rows: { playthroughId: string | null; score: number | null }[]): number | null {
  const scored = rows.filter((row) => row.score !== null);
  const gameLevel = scored.find((row) => row.playthroughId === null);
  if (gameLevel) return gameLevel.score;
  if (scored.length === 0) return null;
  return scored.reduce((sum, row) => sum + (row.score ?? 0), 0) / scored.length;
}

function loadSnapshot(db: AppDatabase): Snapshot {
  const rows = db
    .select({ entry: libraryEntries, game: games })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .orderBy(games.title, libraryEntries.id)
    .all();

  const reviewsByEntry = group(
    db
      .select({
        entryId: reviews.libraryEntryId,
        playthroughId: reviews.playthroughId,
        score: reviews.score,
      })
      .from(reviews)
      .all(),
    (row) => row.entryId,
  );
  const idsByGame = group(
    db
      .select()
      .from(gameExternalIds)
      .where(inArray(gameExternalIds.source, ['igdb', 'steam']))
      .all(),
    (row) => row.gameId,
  );
  const runsByEntry = group(db.select().from(playthroughs).all(), (row) => row.libraryEntryId);
  const timesByGame = group(db.select().from(gameTimes).all(), (row) => row.gameId);

  const library = rows.map(({ entry, game }): LibraryGame => {
    const ids = idsByGame.get(game.id) ?? [];
    // The latest run is the one the user would go back to.
    const latestRun = [...(runsByEntry.get(entry.id) ?? [])].sort((a, b) => b.number - a.number)[0];
    const times = pickEffectiveTimes(timesByGame.get(game.id) ?? []);
    return {
      entryId: entry.id,
      gameId: game.id,
      status: entry.status,
      isFavorite: entry.isFavorite,
      platform: entry.platform,
      title: game.title,
      coverUrl: game.coverUrl,
      releaseYear: game.releaseYear,
      features: {
        genres: game.genres,
        themes: game.themes,
        tags: game.tags,
        franchise: game.franchise,
        platforms: game.platforms,
      },
      score: entryScore(reviewsByEntry.get(entry.id) ?? []),
      igdbId: ids.find((row) => row.source === 'igdb')?.externalId ?? null,
      steamAppIds: ids.filter((row) => row.source === 'steam').map((row) => row.externalId),
      playedMinutes: latestRun?.playtimeMinutes ?? null,
      mainMinutes: times?.mainMinutes ?? null,
      completionistMinutes: times?.completionistMinutes ?? null,
    };
  });

  const profile = buildTasteProfile(
    library.map((game): TasteSignal => ({
      ...game.features,
      entryId: game.entryId,
      title: game.title,
      status: game.status,
      isFavorite: game.isFavorite,
      score: game.score,
      platform: game.platform,
    })),
  );

  const byIgdbId = new Map<string, LibraryGame>();
  const bySteamAppId = new Map<string, LibraryGame>();
  for (const game of library) {
    if (game.igdbId) byIgdbId.set(game.igdbId, game);
    for (const appId of game.steamAppIds) bySteamAppId.set(appId, game);
  }
  return { library, profile, ready: profile.signalGames > 0, byIgdbId, bySteamAppId };
}

function requireGame(snapshot: Snapshot, entryId: string): LibraryGame {
  const game = snapshot.library.find((candidate) => candidate.entryId === entryId);
  if (!game) throw notFound('Library entry');
  return game;
}

const ownedCopy = (snapshot: Snapshot, data: CatalogGameData): LibraryGame | undefined =>
  snapshot.byIgdbId.get(data.externalId) ??
  data.steamAppIds.map((appId) => snapshot.bySteamAppId.get(appId)).find(Boolean);

// --- Building recommended games ----------------------------------------------------

const BLANK = {
  similarity: null,
  shared: [],
  listedBySource: false,
  shape: null,
  playedPercent: null,
  line: null,
  source: null,
} satisfies Partial<RecommendedGame>;

function fromLibrary(snapshot: Snapshot, game: LibraryGame): RecommendedGame {
  // A library game never counts as evidence for itself.
  const fit = scoreGame(
    snapshot.profile,
    { ...game.features, platform: game.platform },
    { excludeEntryId: game.entryId },
  );
  return {
    ...BLANK,
    key: `entry:${game.entryId}`,
    libraryEntryId: game.entryId,
    status: game.status,
    igdbId: game.igdbId,
    title: game.title,
    coverUrl: game.coverUrl,
    releaseYear: game.releaseYear,
    genres: game.features.genres,
    affinity: snapshot.ready ? fit.affinity : null,
    reasons: snapshot.ready ? fit.reasons : [],
  };
}

function fromCatalog(
  snapshot: Snapshot,
  data: CatalogGameData,
  provenance: Provenance,
): RecommendedGame {
  const fit = scoreGame(snapshot.profile, data);
  return {
    ...BLANK,
    key: `igdb:${data.externalId}`,
    libraryEntryId: null,
    status: null,
    igdbId: data.externalId,
    title: data.title,
    coverUrl: data.coverUrl,
    releaseYear: data.releaseYear,
    genres: data.genres,
    affinity: snapshot.ready ? fit.affinity : null,
    reasons: snapshot.ready ? fit.reasons : [],
    source: { ...provenance, url: data.url ?? provenance.url },
  };
}

const NEUTRAL_AFFINITY = 50;
const affinityOf = (item: RecommendedGame) => item.affinity ?? NEUTRAL_AFFINITY;
const byTitle = (a: RecommendedGame, b: RecommendedGame) =>
  a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
const byAffinity = (a: RecommendedGame, b: RecommendedGame) =>
  affinityOf(b) - affinityOf(a) || byTitle(a, b);
const bySimilarity = (a: RecommendedGame, b: RecommendedGame) =>
  (b.similarity ?? 0) - (a.similarity ?? 0) || byAffinity(a, b);

const MAX_ITEMS = 24;

// --- AI one-liners -----------------------------------------------------------------

/** What it takes to explain a list: which games, in which order, about what. */
interface ExplainSpec {
  list: RecommendationList;
  /** Text for the prompt: the reference game's title, or the genre. */
  reference: string | null;
  gameId: string | null;
  /** The lists shown on screen; the first games of each are the ones explained. */
  groups: RecommendedGame[][];
}

const MAX_EXPLAINED = 12;

function factsOf(item: RecommendedGame): RecommendationFacts {
  return {
    title: item.title,
    genres: item.genres,
    likes: item.reasons
      .filter((reason) => reason.weight > 0)
      .map((reason) => ({ value: reason.value, because: reason.because })),
    dislikes: item.reasons.filter((reason) => reason.weight < 0).map((reason) => reason.value),
    shared: item.shared,
    status: item.status === 'paused' || item.status === 'dropped' ? item.status : null,
    playedPercent: item.playedPercent,
  };
}

function explainTask(spec: ExplainSpec, locale: Locale) {
  const groups = spec.groups.filter((items) => items.length > 0);
  const perGroup = Math.ceil(MAX_EXPLAINED / Math.max(1, groups.length));
  const top = groups.flatMap((items) => items.slice(0, perGroup)).slice(0, MAX_EXPLAINED);
  const facts = top.map(factsOf);
  return {
    top,
    facts,
    identity: {
      feature: 'recommendation_reasons',
      gameId: spec.gameId,
      // The facts are part of the key: when the profile moves, the old lines stop applying.
      cacheKeyParts: [spec.list, spec.reference, locale, JSON.stringify(facts)],
      promptVersion: RECOMMENDATION_REASONS_PROMPT_VERSION,
      schema: recommendationReasonsSchema,
    },
  };
}

function linesByKey(top: RecommendedGame[], output: RecommendationReasons): Map<string, string> {
  const lines = new Map<string, string>();
  for (const { game, line } of output.lines) {
    const item = top[game - 1];
    if (item) lines.set(item.key, line);
  }
  return lines;
}

/** Fills in the lines the AI already wrote for this exact list. Costs nothing. */
function attachCachedLines(ctx: AppContext, spec: ExplainSpec, locale: Locale): void {
  const task = explainTask(spec, locale);
  if (task.top.length === 0) return;
  const cached = readAiCache(ctx, task.identity);
  if (!cached) return;
  const lines = linesByKey(task.top, cached);
  for (const item of task.top) item.line = lines.get(item.key) ?? null;
}

// --- Taste profile -------------------------------------------------------------------

export function getTasteProfile(ctx: AppContext): TasteProfileResponse {
  const { profile } = loadSnapshot(ctx.db);
  return {
    ratedGames: profile.ratedGames,
    signalGames: profile.signalGames,
    dimensions: TASTE_DIMENSIONS.map((dimension) => ({
      dimension,
      ...topFeatures(profile, dimension, { liked: 8, disliked: 4 }),
    })),
  };
}

// --- "What to play now" --------------------------------------------------------------

/** Scores from 6 up count for going back to a game; below that, the user said no. */
const RESUME_MIN_SCORE = 6;

function buildPlayNext(ctx: AppContext): { response: PlayNextResponse; spec: ExplainSpec } {
  const snapshot = loadSnapshot(ctx.db);

  const backlog = snapshot.library
    .filter((game) => game.status === 'backlog')
    .map((game) => fromLibrary(snapshot, game))
    .sort(byAffinity);

  const resume = snapshot.library
    .filter((game) => game.status === 'paused' || game.status === 'dropped')
    .flatMap((game) => {
      const item = fromLibrary(snapshot, game);
      const dropped = game.status === 'dropped';
      // A dropped game comes back only if nothing says the user disliked it.
      if (dropped && game.score !== null && game.score < RESUME_MIN_SCORE) return [];
      if (dropped && affinityOf(item) < NEUTRAL_AFFINITY) return [];

      const played =
        game.playedMinutes !== null && game.mainMinutes
          ? Math.min(1, game.playedMinutes / game.mainMinutes)
          : null;
      item.playedPercent = played === null ? null : Math.round(played * 100);
      // Potential to resume: fits the taste, already well under way, and liked while it lasted.
      const rank =
        affinityOf(item) +
        15 * (played ?? 0) +
        (game.score === null ? 0 : (game.score - RESUME_MIN_SCORE) * 2.5) -
        (dropped ? 10 : 0);
      return [{ item, rank }];
    })
    .sort((a, b) => b.rank - a.rank || byTitle(a.item, b.item))
    .map(({ item }) => item);

  const response = {
    profileReady: snapshot.ready,
    backlog: backlog.slice(0, MAX_ITEMS),
    resume: resume.slice(0, MAX_ITEMS),
  };
  return {
    response,
    spec: {
      list: 'play_next',
      reference: null,
      gameId: null,
      groups: [response.backlog, response.resume],
    },
  };
}

export function getPlayNext(ctx: AppContext, locale: Locale): PlayNextResponse {
  const { response, spec } = buildPlayNext(ctx);
  attachCachedLines(ctx, spec, locale);
  return response;
}

// --- "Similar to this game" ------------------------------------------------------------

interface CatalogSimilar {
  reach: CatalogReach;
  games: CatalogGameData[];
  provenance: Provenance;
}

/** What the catalog lists as similar to a library game. Never throws for a source problem. */
async function catalogSimilar(ctx: AppContext, target: LibraryGame): Promise<CatalogSimilar> {
  const none = (reach: CatalogReach): CatalogSimilar => ({
    reach,
    games: [],
    provenance: { origin: 'igdb' },
  });
  if (!target.igdbId) return none('no_catalog_id');
  if (!(await ctx.igdb.isConfigured())) return none('not_configured');
  try {
    const found = await ctx.igdb.getSimilar(target.igdbId);
    return { reach: 'ok', games: found.data, provenance: found.provenance };
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    return none('failed');
  }
}

/** A game IGDB lists as similar starts from here, however little metadata the two share. */
const LISTED_FLOOR = 0.4;
/** Library games below this are not worth calling similar. */
const MIN_SIMILARITY = 0.2;
/** Already finished or abandoned: not something to recommend. */
const DONE: LibraryStatus[] = ['completed', 'completed_100', 'dropped'];

async function buildSimilar(
  ctx: AppContext,
  entryId: string,
): Promise<{ response: SimilarGamesResponse; spec: ExplainSpec }> {
  const snapshot = loadSnapshot(ctx.db);
  const target = requireGame(snapshot, entryId);
  const catalog = await catalogSimilar(ctx, target);

  const toPercent = (value: number, listed: boolean) =>
    Math.round(100 * (listed ? LISTED_FLOOR + (1 - LISTED_FLOOR) * value : value));
  const items: RecommendedGame[] = [];
  const listedEntries = new Set<string>();

  for (const data of catalog.games) {
    const owned = ownedCopy(snapshot, data);
    if (owned) {
      listedEntries.add(owned.entryId);
      continue;
    }
    const { similarity, shared } = featureSimilarity(target.features, data);
    items.push({
      ...fromCatalog(snapshot, data, catalog.provenance),
      similarity: toPercent(similarity, true),
      shared,
      listedBySource: true,
    });
  }

  for (const game of snapshot.library) {
    if (game.entryId === target.entryId || DONE.includes(game.status)) continue;
    const listed = listedEntries.has(game.entryId);
    const { similarity, shared } = featureSimilarity(target.features, game.features);
    if (!listed && similarity < MIN_SIMILARITY) continue;
    items.push({
      ...fromLibrary(snapshot, game),
      similarity: toPercent(similarity, listed),
      shared,
      listedBySource: listed,
    });
  }

  const response = {
    game: { libraryEntryId: target.entryId, title: target.title },
    catalog: catalog.reach,
    items: items.sort(bySimilarity).slice(0, MAX_ITEMS),
  };
  return {
    response,
    spec: {
      list: 'similar',
      reference: target.title,
      gameId: target.gameId,
      groups: [response.items],
    },
  };
}

export async function getSimilarGames(
  ctx: AppContext,
  entryId: string,
  locale: Locale,
): Promise<SimilarGamesResponse> {
  const { response, spec } = await buildSimilar(ctx, entryId);
  attachCachedLines(ctx, spec, locale);
  return response;
}

// --- "Similar to this platinum / 100%" -----------------------------------------------------

/** Games outside the library need one request each for their achievement data. */
const MAX_OUTSIDE_SHAPES = 12;
const MIN_SHAPE_SIMILARITY = 0.5;
/** Nothing left to complete, or no wish to. */
const NOT_A_TARGET: LibraryStatus[] = ['completed_100', 'dropped'];

async function buildSimilarCompletion(
  ctx: AppContext,
  entryId: string,
): Promise<{ response: SimilarCompletionResponse; spec: ExplainSpec }> {
  const snapshot = loadSnapshot(ctx.db);
  const target = requireGame(snapshot, entryId);
  const reference = { libraryEntryId: target.entryId, title: target.title };

  const percentsByGame = group(
    ctx.db
      .select({ gameId: achievements.gameId, percent: achievements.globalPercent })
      .from(achievements)
      .all(),
    (row) => row.gameId,
  );
  const shapeOf = (game: LibraryGame) =>
    achievementShape(
      (percentsByGame.get(game.gameId) ?? []).map((row) => row.percent),
      game,
    );

  const spec = (items: RecommendedGame[]): ExplainSpec => ({
    list: 'completion',
    reference: target.title,
    gameId: target.gameId,
    groups: [items],
  });
  const shape = shapeOf(target);
  if (!shape) {
    // Nothing to compare against: do not spend a catalog request on it.
    const catalog: CatalogReach = target.igdbId ? 'ok' : 'no_catalog_id';
    return { response: { game: reference, shape: null, catalog, items: [] }, spec: spec([]) };
  }

  const items: RecommendedGame[] = [];
  const add = (item: RecommendedGame, other: NonNullable<ReturnType<typeof shapeOf>>) => {
    const similarity = shapeSimilarity(shape, other);
    if (similarity < MIN_SHAPE_SIMILARITY) return;
    items.push({ ...item, similarity: Math.round(similarity * 100), shape: other });
  };

  for (const game of snapshot.library) {
    if (game.entryId === target.entryId || NOT_A_TARGET.includes(game.status)) continue;
    const other = shapeOf(game);
    if (other) add(fromLibrary(snapshot, game), other);
  }

  // Outside the library, the only achievement data that needs no key is Steam's global
  // percentages, so only the catalog's similar games that exist on Steam can be compared.
  const catalog = await catalogSimilar(ctx, target);
  const outside = catalog.games
    .filter((data) => !ownedCopy(snapshot, data) && data.steamAppIds.length > 0)
    .slice(0, MAX_OUTSIDE_SHAPES);
  const outsideShapes = await Promise.all(
    outside.map(async (data) => {
      const percentages = await ctx.steam
        .getGlobalPercentages(data.steamAppIds[0] ?? '')
        .catch(() => ({}));
      return achievementShape(Object.values(percentages));
    }),
  );
  outside.forEach((data, index) => {
    const other = outsideShapes[index];
    if (!other) return;
    add({ ...fromCatalog(snapshot, data, catalog.provenance), listedBySource: true }, other);
  });

  const sorted = items.sort(bySimilarity).slice(0, MAX_ITEMS);
  return {
    response: { game: reference, shape, catalog: catalog.reach, items: sorted },
    spec: spec(sorted),
  };
}

export async function getSimilarCompletion(
  ctx: AppContext,
  entryId: string,
  locale: Locale,
): Promise<SimilarCompletionResponse> {
  const { response, spec } = await buildSimilarCompletion(ctx, entryId);
  attachCachedLines(ctx, spec, locale);
  return response;
}

// --- "From your favourite genre" -------------------------------------------------------------

const MAX_GENRE_CHOICES = 12;
const MAX_DISCOVERIES = 20;
/** Not played to the end yet: worth suggesting. */
const OPEN: LibraryStatus[] = ['backlog', 'wishlist', 'paused'];

async function buildFavoriteGenre(
  ctx: AppContext,
  requested: string | undefined,
): Promise<{ response: FavoriteGenreResponse; spec: ExplainSpec }> {
  const snapshot = loadSnapshot(ctx.db);

  // Favourite first; then whatever the library has most of, so there is always a choice.
  const liked = topFeatures(snapshot.profile, 'genre', {
    liked: MAX_GENRE_CHOICES,
    disliked: 0,
  }).liked.map((feature) => feature.value);
  const frequency = new Map<string, { value: string; count: number }>();
  for (const game of snapshot.library) {
    for (const value of game.features.genres) {
      const key = value.trim().toLowerCase();
      const entry = frequency.get(key) ?? { value: value.trim(), count: 0 };
      entry.count++;
      frequency.set(key, entry);
    }
  }
  const common = [...frequency.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .map((entry) => entry.value);
  const genres = [
    ...liked,
    ...common.filter((value) => !liked.some((item) => eqText(item, value))),
  ].slice(0, MAX_GENRE_CHOICES);

  const genre =
    (requested && genres.find((value) => eqText(value, requested))) || (genres[0] ?? null);
  const empty = (catalog: CatalogReach): FavoriteGenreResponse => ({
    genre,
    genres,
    catalog,
    inLibrary: [],
    discover: [],
  });
  if (!genre) {
    return {
      response: empty('ok'),
      spec: { list: 'genre', reference: null, gameId: null, groups: [] },
    };
  }

  const inLibrary = snapshot.library
    .filter(
      (game) =>
        OPEN.includes(game.status) && game.features.genres.some((value) => eqText(value, genre)),
    )
    .map((game) => fromLibrary(snapshot, game))
    .sort(byAffinity)
    .slice(0, MAX_ITEMS);

  let catalog: CatalogReach = 'not_configured';
  let discover: RecommendedGame[] = [];
  if (await ctx.igdb.isConfigured()) {
    try {
      const found = await ctx.igdb.getTopByGenre(genre);
      catalog = 'ok';
      discover = found.data
        .filter((data) => !ownedCopy(snapshot, data))
        .map((data, index) => ({ item: fromCatalog(snapshot, data, found.provenance), index }))
        // Among equal fits, the catalog's own order (best rated first) decides.
        .sort((a, b) => affinityOf(b.item) - affinityOf(a.item) || a.index - b.index)
        .map(({ item }) => item)
        .slice(0, MAX_DISCOVERIES);
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      catalog = 'failed';
    }
  }

  return {
    response: { ...empty(catalog), inLibrary, discover },
    spec: { list: 'genre', reference: genre, gameId: null, groups: [inLibrary, discover] },
  };
}

export async function getFavoriteGenre(
  ctx: AppContext,
  requested: string | undefined,
  locale: Locale,
): Promise<FavoriteGenreResponse> {
  const { response, spec } = await buildFavoriteGenre(ctx, requested);
  attachCachedLines(ctx, spec, locale);
  return response;
}

// --- Asking the AI ---------------------------------------------------------------------------

async function specFor(
  ctx: AppContext,
  request: ExplainRecommendationsRequest,
): Promise<ExplainSpec> {
  const needsGame = () => {
    if (!request.libraryEntryId)
      throw badRequest('reference_game_required', 'This list needs a reference game');
    return request.libraryEntryId;
  };
  switch (request.list) {
    case 'play_next':
      return buildPlayNext(ctx).spec;
    case 'similar':
      return (await buildSimilar(ctx, needsGame())).spec;
    case 'completion':
      return (await buildSimilarCompletion(ctx, needsGame())).spec;
    case 'genre':
      return (await buildFavoriteGenre(ctx, request.genre)).spec;
  }
}

/**
 * Has the AI write one line per recommendation, all in a single request. The app has already
 * decided what to recommend and why; the AI only turns those reasons into a sentence.
 */
export async function explainRecommendations(
  ctx: AppContext,
  request: ExplainRecommendationsRequest,
): Promise<ExplainRecommendationsResponse> {
  const spec = await specFor(ctx, request);
  const task = explainTask(spec, request.locale);
  if (task.top.length === 0) return { lines: {}, cached: true };

  const result = await runAiTask<null, RecommendationReasons>(ctx, {
    ...task.identity,
    maxTokens: 1500,
    collect: () => Promise.resolve(null),
    build: () =>
      buildRecommendationReasonsPrompt({
        list: spec.list,
        reference: spec.reference,
        locale: request.locale,
        games: task.facts,
      }),
  });
  return {
    lines: Object.fromEntries(linesByKey(task.top, result.output)),
    cached: result.cached,
  };
}
