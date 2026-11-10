import type {
  CreateProgressRequest,
  CreateSessionRequest,
  ProgressEvent,
  Review,
  SaveReviewRequest,
  Session,
  UpdateSessionRequest,
} from '@gamebacklog/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { playthroughs, progressEvents, reviews, sessions } from '../db/schema/index.ts';
import { badRequest, notFound } from '../errors.ts';
import { requireEntry, requirePlaythrough } from './service.ts';

type Queryable = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete'>;

// --- "Where am I?" ---------------------------------------------------------------

export function listProgress(db: AppDatabase, playthroughId: string): ProgressEvent[] {
  requirePlaythrough(db, playthroughId);
  return db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.playthroughId, playthroughId))
    .orderBy(desc(progressEvents.occurredAt))
    .all()
    .map((row) => ({ id: row.id, rawText: row.rawText, occurredAt: row.occurredAt.toISOString() }));
}

/** Without AI the text is stored exactly as typed; Phase 2 resolves it to a checkpoint. */
export function addProgress(
  db: AppDatabase,
  playthroughId: string,
  request: CreateProgressRequest,
  now: Date,
): ProgressEvent {
  requirePlaythrough(db, playthroughId);
  const row = db
    .insert(progressEvents)
    .values({ playthroughId, rawText: request.rawText, occurredAt: now })
    .returning()
    .get();
  return { id: row.id, rawText: row.rawText, occurredAt: row.occurredAt.toISOString() };
}

// --- Sessions ----------------------------------------------------------------------

type SessionRow = typeof sessions.$inferSelect;

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    playthroughId: row.playthroughId,
    startedAt: row.startedAt.toISOString(),
    durationMinutes: row.durationMinutes,
    note: row.note,
    origin: row.origin,
  };
}

/** A playthrough's playtime is its starting hours plus every session logged against it. */
export function addPlaytime(db: Queryable, playthroughId: string | null, minutes: number): void {
  if (!playthroughId || minutes === 0) return;
  db.update(playthroughs)
    .set({
      playtimeMinutes: sql`max(0, coalesce(${playthroughs.playtimeMinutes}, 0) + ${minutes})`,
    })
    .where(eq(playthroughs.id, playthroughId))
    .run();
}

export function listSessions(db: AppDatabase, entryId: string): Session[] {
  requireEntry(db, entryId);
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.libraryEntryId, entryId))
    .orderBy(desc(sessions.startedAt))
    .all()
    .map(toSession);
}

function assertPlaythroughOfEntry(db: Queryable, entryId: string, playthroughId: string | null) {
  if (!playthroughId) return;
  if (requirePlaythrough(db, playthroughId).libraryEntryId !== entryId) {
    throw badRequest('playthrough_mismatch', 'The playthrough belongs to another game');
  }
}

export function createSession(
  db: AppDatabase,
  entryId: string,
  request: CreateSessionRequest,
): Session {
  return db.transaction((tx) => {
    requireEntry(tx, entryId);
    assertPlaythroughOfEntry(tx, entryId, request.playthroughId);
    const row = tx
      .insert(sessions)
      .values({
        libraryEntryId: entryId,
        playthroughId: request.playthroughId,
        startedAt: new Date(request.startedAt),
        durationMinutes: request.durationMinutes,
        note: request.note || null,
      })
      .returning()
      .get();
    addPlaytime(tx, row.playthroughId, row.durationMinutes);
    return toSession(row);
  });
}

function requireSession(db: Queryable, sessionId: string): SessionRow {
  const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!row) throw notFound('Session');
  return row;
}

export function updateSession(
  db: AppDatabase,
  sessionId: string,
  request: UpdateSessionRequest,
): Session {
  return db.transaction((tx) => {
    const before = requireSession(tx, sessionId);
    const change: Partial<SessionRow> = {};
    if (request.startedAt !== undefined) change.startedAt = new Date(request.startedAt);
    if (request.durationMinutes !== undefined) change.durationMinutes = request.durationMinutes;
    if (request.note !== undefined) change.note = request.note || null;
    if (Object.keys(change).length > 0) {
      tx.update(sessions).set(change).where(eq(sessions.id, sessionId)).run();
    }
    const after = requireSession(tx, sessionId);
    addPlaytime(tx, after.playthroughId, after.durationMinutes - before.durationMinutes);
    return toSession(after);
  });
}

export function deleteSession(db: AppDatabase, sessionId: string): void {
  db.transaction((tx) => {
    const row = requireSession(tx, sessionId);
    tx.delete(sessions).where(eq(sessions.id, sessionId)).run();
    addPlaytime(tx, row.playthroughId, -row.durationMinutes);
  });
}

// --- Reviews -----------------------------------------------------------------------

type ReviewRow = typeof reviews.$inferSelect;

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    playthroughId: row.playthroughId,
    score: row.score,
    difficultyScore: row.difficultyScore,
    storyScore: row.storyScore,
    gameplayScore: row.gameplayScore,
    levelDesignScore: row.levelDesignScore,
    soundtrackScore: row.soundtrackScore,
    visualsScore: row.visualsScore,
    perceivedLengthScore: row.perceivedLengthScore,
    body: row.body,
    pros: row.pros,
    cons: row.cons,
    hasSpoilers: row.hasSpoilers,
    timeToBeatMinutes: row.timeToBeatMinutes,
    reviewedAt: row.reviewedAt.toISOString(),
  };
}

export function listReviews(db: AppDatabase, entryId: string): Review[] {
  requireEntry(db, entryId);
  return db
    .select()
    .from(reviews)
    .where(eq(reviews.libraryEntryId, entryId))
    .orderBy(desc(reviews.reviewedAt))
    .all()
    .map(toReview);
}

/** One review per playthrough, plus one for the game as a whole: saving again edits it. */
export function saveReview(
  db: AppDatabase,
  entryId: string,
  request: SaveReviewRequest,
  now: Date,
): Review {
  return db.transaction((tx) => {
    requireEntry(tx, entryId);
    assertPlaythroughOfEntry(tx, entryId, request.playthroughId);

    const existing = tx
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.libraryEntryId, entryId),
          request.playthroughId
            ? eq(reviews.playthroughId, request.playthroughId)
            : isNull(reviews.playthroughId),
        ),
      )
      .get();

    const values = { ...request, body: request.body || null };
    const row = existing
      ? tx.update(reviews).set(values).where(eq(reviews.id, existing.id)).returning().get()
      : tx
          .insert(reviews)
          .values({ ...values, libraryEntryId: entryId, reviewedAt: now })
          .returning()
          .get();
    return toReview(row);
  });
}

export function deleteReview(db: AppDatabase, reviewId: string): void {
  const deleted = db.delete(reviews).where(eq(reviews.id, reviewId)).returning().all();
  if (deleted.length === 0) throw notFound('Review');
}
