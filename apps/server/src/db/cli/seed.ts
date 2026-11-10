import path from 'node:path';
import { loadConfig, loadEnvFile } from '../../config.ts';
import { DATABASE_FILE_NAME } from '../../paths.ts';
import { openAppDatabase } from '../client.ts';
import { runMigrations } from '../migrate.ts';
import { seedDatabase } from '../seed.ts';

// `pnpm db:seed` — adds the example data. Idempotent: existing rows are left untouched.
loadEnvFile();
const config = loadConfig();
const database = openAppDatabase(config.dataDir);
try {
  runMigrations(database.db);
  seedDatabase(database.db);
  console.log(`Example data added to ${path.join(config.dataDir, DATABASE_FILE_NAME)}.`);
} finally {
  database.close();
}
