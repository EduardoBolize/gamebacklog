import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig(({ mode }) => {
  // Same optional `.env` at the repo root that the server reads.
  const env = loadEnv(mode, repoRoot, 'GAMEBACKLOG_');
  const serverHost = env.GAMEBACKLOG_HOST || '127.0.0.1';
  const serverPort = env.GAMEBACKLOG_PORT || '3777';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      // In dev the browser talks to Vite, which forwards API calls to the local server.
      proxy: {
        '/api': `http://${serverHost}:${serverPort}`,
      },
    },
  };
});
