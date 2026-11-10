import { healthResponseSchema, type HealthResponse } from '@gamebacklog/shared';
import { useEffect, useState } from 'react';

type ServerState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { signal });
  if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
  return healthResponseSchema.parse(await response.json());
}

export function App() {
  const [server, setServer] = useState<ServerState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setServer({ kind: 'ok', health }))
      .catch(() => {
        if (!controller.signal.aborted) setServer({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <h1 className="text-3xl font-semibold tracking-tight">Hello, GameBacklog</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400" role="status">
        {server.kind === 'loading' && 'Conectando ao servidor local…'}
        {server.kind === 'ok' &&
          `Servidor local no ar — ${server.health.app} v${server.health.version}, schema v${server.health.schemaVersion}.`}
        {server.kind === 'error' && 'Não foi possível falar com o servidor local.'}
      </p>
    </main>
  );
}
