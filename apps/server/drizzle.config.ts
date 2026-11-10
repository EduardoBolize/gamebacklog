import { defineConfig } from 'drizzle-kit';

// Only used by `drizzle-kit generate`, which diffs the schema and needs no database.
// At runtime the server applies the generated migrations itself (see src/db/migrate.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
});
