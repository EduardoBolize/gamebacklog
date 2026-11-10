import { buildApp } from './app.ts';
import { loadConfig, loadEnvFile } from './config.ts';
import { createContext } from './context.ts';
import { openAppDatabase } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { createSecretStore } from './secrets/store.ts';
import { startBackupSchedule } from './transfer/backup.ts';

loadEnvFile();
const config = loadConfig();

const database = openAppDatabase(config.dataDir);
runMigrations(database.db);

const ctx = createContext({
  db: database.db,
  dataDir: config.dataDir,
  secrets: createSecretStore(config.dataDir, process.env.GAMEBACKLOG_SECRET_STORE),
});

const app = await buildApp({
  ctx,
  webDistDir: config.production ? config.webDistDir : undefined,
  logger: true,
});
const stopBackups = startBackupSchedule(ctx);
app.addHook('onClose', () => {
  stopBackups();
  database.close();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
app.log.info(`Data folder: ${config.dataDir}`);
if (config.production) {
  app.log.info(`GameBacklog is running at http://${config.host}:${config.port}`);
}
