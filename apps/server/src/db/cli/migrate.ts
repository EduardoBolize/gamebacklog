import path from 'node:path';
import { loadConfig, loadEnvFile } from '../../config.ts';
import { DATABASE_FILE_NAME } from '../../paths.ts';
import { openAppDatabase } from '../client.ts';
import { readDataSchemaVersion, runMigrations } from '../migrate.ts';

// `pnpm db:migrate` — creates or updates the database in the data folder.
loadEnvFile();
const config = loadConfig();
const database = openAppDatabase(config.dataDir);
try {
  runMigrations(database.db);
  const version = readDataSchemaVersion(database.db);
  console.log(
    `Database ready at ${path.join(config.dataDir, DATABASE_FILE_NAME)} (data schema v${version}).`,
  );
} finally {
  database.close();
}
