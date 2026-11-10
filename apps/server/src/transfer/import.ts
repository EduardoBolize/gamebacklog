import type {
  ExportFile,
  ImportChangeCounts,
  ImportMode,
  ImportPreviewResponse,
} from '@gamebacklog/shared';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { conflict } from '../errors.ts';
import { MACHINE_SETTING_PREFIXES } from '../settings/store.ts';
import { readTable } from './export.ts';
import {
  CACHE_TABLES,
  DATA_TABLES,
  columnsOf,
  deserializeRow,
  pkOf,
  type ExportRow,
  type TableSpec,
} from './tables.ts';

type Tx = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete'>;

interface Operation {
  spec: TableSpec;
  kind: 'insert' | 'update';
  row: ExportRow;
}

export interface ImportPlan {
  mode: ImportMode;
  preview: ImportPreviewResponse;
  /** Merge: the inserts and updates to run. Replace: unused, the file is loaded as is. */
  operations: Operation[];
  file: ExportFile;
}

const MAX_TITLES = 50;
const emptyCounts = (): ImportChangeCounts => ({ added: 0, updated: 0, unchanged: 0, removed: 0 });

/** Rows are the same when everything but the bookkeeping timestamp matches. */
function sameContent(a: ExportRow, b: ExportRow): boolean {
  const strip = ({ updatedAt: _updatedAt, ...rest }: ExportRow) => rest;
  const stable = (row: ExportRow) =>
    JSON.stringify(Object.entries(strip(row)).sort(([x], [y]) => x.localeCompare(y)));
  return stable(a) === stable(b);
}

function incomingIsNewer(incoming: ExportRow, local: ExportRow): boolean {
  if (typeof incoming.updatedAt !== 'string' || typeof local.updatedAt !== 'string') return false;
  return incoming.updatedAt > local.updatedAt;
}

function incomingRows(file: ExportFile, spec: TableSpec): ExportRow[] {
  const data = file.data as Record<string, ExportRow[]>;
  const caches = (file.caches ?? {}) as Record<string, ExportRow[]>;
  return data[spec.name] ?? caches[spec.name] ?? [];
}

const isMachineSetting = (row: ExportRow) =>
  MACHINE_SETTING_PREFIXES.some((prefix) => String(row.key).startsWith(prefix));

// --- Replace -----------------------------------------------------------------------

function planReplace(db: AppDatabase, file: ExportFile, specs: TableSpec[]) {
  const tables: Record<string, ImportChangeCounts> = {};
  for (const spec of specs) {
    const counts = emptyCounts();
    const local = new Map(readTable(db, spec).map((row) => [pkOf(spec, row), row]));
    const seen = new Set<string>();
    for (const row of incomingRows(file, spec)) {
      const id = pkOf(spec, row);
      seen.add(id);
      const existing = local.get(id);
      if (!existing) counts.added++;
      else if (sameContent(row, existing)) counts.unchanged++;
      else counts.updated++;
    }
    counts.removed = [...local.keys()].filter((id) => !seen.has(id)).length;
    tables[spec.name] = counts;
  }
  return tables;
}

// --- Merge -------------------------------------------------------------------------

/**
 * Works out what a merge would do, without writing.
 *
 * Rows are matched by primary key first and by natural key second. A natural-key match means
 * both sides created the same thing independently; the incoming row then takes the local ID and
 * every later reference to it is rewritten. On a match, the newer `updatedAt` wins. Nothing is
 * ever removed by a merge.
 */
function planMerge(db: AppDatabase, file: ExportFile, specs: TableSpec[]) {
  const tables: Record<string, ImportChangeCounts> = {};
  const operations: Operation[] = [];
  const idMaps = new Map<string, Map<string, string>>();
  const mapFor = (table: string) => {
    let map = idMaps.get(table);
    if (!map) {
      map = new Map<string, string>();
      idMaps.set(table, map);
    }
    return map;
  };

  // Two installs know they hold the same game when it has the same ID on some source (IGDB,
  // Steam…). Games added by hand have no such ID, so those fall back to title and year.
  const gamesSpec = DATA_TABLES[0] as TableSpec;
  const linksSpec = DATA_TABLES[1] as TableSpec;
  const localLinks = new Map(
    readTable(db, linksSpec).map((row) => [
      `${String(row.source)}|${String(row.externalId)}`,
      String(row.gameId),
    ]),
  );
  const localLinkedGames = new Set(localLinks.values());
  const localGameIds = new Set(readTable(db, gamesSpec).map((row) => String(row.id)));
  const incomingLinkedGames = new Set<string>();
  for (const link of file.data.gameExternalIds) {
    incomingLinkedGames.add(link.gameId);
    const localGameId = localLinks.get(`${link.source}|${link.externalId}`);
    if (localGameId && localGameId !== link.gameId && !localGameIds.has(link.gameId)) {
      mapFor('games').set(link.gameId, localGameId);
    }
  }
  const titleAndYear = (row: ExportRow) =>
    `${String(row.title).toLowerCase()}|${String(row.releaseYear)}`;

  for (const spec of specs) {
    const counts = emptyCounts();
    const localRows = readTable(db, spec);
    const byPk = new Map(localRows.map((row) => [pkOf(spec, row), row]));
    const isGames = spec.name === 'games';
    const naturalKeyOf = (row: ExportRow, linkedGames: Set<string>): string | null => {
      if (!isGames) return spec.naturalKey?.(row) ?? null;
      return linkedGames.has(String(row.id)) ? null : titleAndYear(row);
    };
    const byNatural = new Map<string, ExportRow>();
    for (const row of localRows) {
      const natural = naturalKeyOf(row, localLinkedGames);
      if (natural) byNatural.set(natural, row);
    }

    for (const original of incomingRows(file, spec)) {
      if (spec.name === 'settings') {
        // Preferences belong to each install; a merge keeps the local ones.
        counts.unchanged++;
        continue;
      }

      let row: ExportRow = { ...original };
      for (const [column, target] of Object.entries(spec.fks)) {
        const value = row[column];
        if (typeof value === 'string') row[column] = idMaps.get(target)?.get(value) ?? value;
      }
      if (isGames) {
        const mapped = mapFor('games').get(String(row.id));
        if (mapped) row.id = mapped;
      }

      let local = byPk.get(pkOf(spec, row));
      if (!local) {
        const natural = naturalKeyOf(isGames ? original : row, incomingLinkedGames);
        const twin = natural ? byNatural.get(natural) : undefined;
        if (twin && typeof row.id === 'string' && typeof twin.id === 'string') {
          mapFor(spec.name).set(row.id, twin.id);
          row = { ...row, id: twin.id };
          local = twin;
        }
      }

      if (!local) {
        operations.push({ spec, kind: 'insert', row });
        byPk.set(pkOf(spec, row), row);
        const natural = naturalKeyOf(isGames ? original : row, incomingLinkedGames);
        if (natural) byNatural.set(natural, row);
        counts.added++;
      } else if (!sameContent(row, local) && incomingIsNewer(row, local)) {
        operations.push({ spec, kind: 'update', row });
        counts.updated++;
      } else {
        counts.unchanged++;
      }
    }
    tables[spec.name] = counts;
  }
  return { tables, operations };
}

// --- Preview -----------------------------------------------------------------------

function libraryPreview(
  db: AppDatabase,
  file: ExportFile,
  mode: ImportMode,
  operations: Operation[],
  tables: Record<string, ImportChangeCounts>,
) {
  const titleByGame = new Map<string, string>();
  for (const row of readTable(db, DATA_TABLES[0] as TableSpec)) {
    titleByGame.set(String(row.id), String(row.title));
  }
  for (const game of file.data.games) titleByGame.set(game.id, game.title);
  for (const op of operations) {
    if (op.spec.name === 'games') titleByGame.set(String(op.row.id), String(op.row.title));
  }

  const localEntries = new Map(
    readTable(db, DATA_TABLES.find((spec) => spec.name === 'libraryEntries') as TableSpec).map(
      (row) => [String(row.id), row],
    ),
  );
  const entryGame = new Map<string, string>(
    [...localEntries.values()].map((row) => [String(row.id), String(row.gameId)]),
  );
  const added = new Set<string>();
  const changed = new Set<string>();

  if (mode === 'replace') {
    for (const entry of file.data.libraryEntries) {
      entryGame.set(entry.id, entry.gameId);
      const local = localEntries.get(entry.id);
      if (!local) added.add(entry.id);
      else if (!sameContent(entry, local)) changed.add(entry.id);
    }
  } else {
    const entryOfRun = new Map<string, string>(
      readTable(db, DATA_TABLES.find((spec) => spec.name === 'playthroughs') as TableSpec).map(
        (row) => [String(row.id), String(row.libraryEntryId)],
      ),
    );
    for (const op of operations) {
      if (op.spec.name === 'playthroughs') {
        entryOfRun.set(String(op.row.id), String(op.row.libraryEntryId));
      }
    }
    for (const op of operations) {
      if (op.spec.name === 'libraryEntries') {
        entryGame.set(String(op.row.id), String(op.row.gameId));
        (op.kind === 'insert' ? added : changed).add(String(op.row.id));
        continue;
      }
      // A new session, review or unlock counts as a change to the game it belongs to.
      const entryId =
        typeof op.row.libraryEntryId === 'string'
          ? op.row.libraryEntryId
          : typeof op.row.playthroughId === 'string'
            ? entryOfRun.get(op.row.playthroughId)
            : undefined;
      if (entryId) changed.add(entryId);
    }
    for (const entryId of added) changed.delete(entryId);
  }

  const titles = (ids: Set<string>) =>
    [...ids]
      .map((entryId) => titleByGame.get(entryGame.get(entryId) ?? '') ?? '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_TITLES);

  const removed = mode === 'replace' ? (tables.libraryEntries?.removed ?? 0) : 0;
  const total =
    mode === 'replace' ? file.data.libraryEntries.length : localEntries.size + added.size;
  return {
    library: {
      added: added.size,
      updated: changed.size,
      unchanged: Math.max(0, total - added.size - changed.size),
      removed,
    },
    addedTitles: titles(added),
    updatedTitles: titles(changed),
  };
}

export function planImport(
  db: AppDatabase,
  file: ExportFile,
  mode: ImportMode,
  originalVersion: number,
): ImportPlan {
  const specs: TableSpec[] = [...DATA_TABLES, ...(file.caches ? CACHE_TABLES : [])];
  const { tables, operations } =
    mode === 'replace'
      ? { tables: planReplace(db, file, specs), operations: [] }
      : planMerge(db, file, specs);

  return {
    mode,
    file,
    operations,
    preview: {
      mode,
      fileSchemaVersion: originalVersion,
      exportedAt: file.exportedAt,
      includesCaches: Boolean(file.caches),
      tables,
      ...libraryPreview(db, file, mode, operations, tables),
    },
  };
}

// --- Apply -------------------------------------------------------------------------

function insertRows(tx: Tx, spec: TableSpec, rows: ExportRow[]): void {
  // SQLite caps the number of bound parameters per statement, so insert in small batches.
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map((row) => deserializeRow(spec, row));
    tx.insert(spec.table).values(batch).run();
  }
}

function updateRow(tx: Tx, spec: TableSpec, row: ExportRow): void {
  const columns = columnsOf(spec);
  const where = and(
    ...spec.pk.map((name) => {
      const column = columns[name];
      if (!column) throw new Error(`Unknown key column ${name} on ${spec.name}`);
      return eq(column, row[name]);
    }),
  );
  tx.update(spec.table).set(deserializeRow(spec, row)).where(where).run();
}

/**
 * Runs the plan in a single transaction: either the whole import lands or nothing changes.
 * A replace wipes the user data and loads the file as is; machine-specific settings (backup
 * folder, Steam sync state) are kept from the current install.
 */
export function applyImport(db: AppDatabase, plan: ImportPlan): void {
  const { file } = plan;
  try {
    db.transaction((tx) => {
      if (plan.mode === 'merge') {
        for (const op of plan.operations) {
          if (op.kind === 'insert') insertRows(tx, op.spec, [op.row]);
          else updateRow(tx, op.spec, op.row);
        }
        return;
      }

      const settingsSpec = DATA_TABLES.find((spec) => spec.name === 'settings') as TableSpec;
      const machineSettings = readTable(db, settingsSpec).filter(isMachineSetting);

      // Children first, so no foreign key is left dangling on the way down.
      for (const spec of [...CACHE_TABLES, ...DATA_TABLES].reverse()) tx.delete(spec.table).run();

      for (const spec of DATA_TABLES) {
        const rows =
          spec.name === 'settings'
            ? [
                ...incomingRows(file, spec).filter((row) => !isMachineSetting(row)),
                ...machineSettings,
              ]
            : incomingRows(file, spec);
        insertRows(tx, spec, rows);
      }
      if (file.caches) {
        for (const spec of CACHE_TABLES) insertRows(tx, spec, incomingRows(file, spec));
      }
    });
  } catch (error) {
    if (error instanceof Error && /constraint failed/i.test(error.message)) {
      throw conflict(
        'import_conflict',
        'The file conflicts with the data already here. Nothing was changed.',
      );
    }
    throw error;
  }
}
