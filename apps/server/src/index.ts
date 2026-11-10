import { buildApp } from './app.ts';
import { loadConfig, loadEnvFile } from './config.ts';
import { openAppDatabase } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';

loadEnvFile();
const config = loadConfig();

const database = openAppDatabase(config.dataDir);
runMigrations(database.db);

const app = await buildApp({
  db: database.db,
  webDistDir: config.production ? config.webDistDir : undefined,
  logger: true,
});
app.addHook('onClose', () => database.close());

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
