import { openDatabase, type AppDatabase, type DatabaseHandle } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import type { FetchLike } from '../sources/http.ts';

/** Fresh migrated in-memory database. Call `close()` in `afterEach`. */
export function createTestDatabase(): DatabaseHandle & { db: AppDatabase } {
  const handle = openDatabase(':memory:');
  runMigrations(handle.db);
  return handle;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FakeResponse {
  status?: number;
  json?: unknown;
}

export type FakeRoute = (call: RecordedCall) => FakeResponse | undefined;

/**
 * `fetch` stand-in: each route gets the call and answers or passes. Unmatched calls answer 599,
 * so a test never reaches the network by accident. Every call is recorded for assertions.
 */
export function createFakeFetch(...routes: FakeRoute[]): FetchLike & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fake: FetchLike = (input, init) => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    for (const route of routes) {
      const answer = route(call);
      if (answer) {
        return Promise.resolve(
          new Response(answer.json === undefined ? '' : JSON.stringify(answer.json), {
            status: answer.status ?? 200,
          }),
        );
      }
    }
    return Promise.resolve(new Response('', { status: 599 }));
  };
  return Object.assign(fake, { calls });
}

/** Route that answers when the URL contains `fragment`. */
export const whenUrl =
  (fragment: string, answer: FakeResponse | ((call: RecordedCall) => FakeResponse)): FakeRoute =>
  (call) =>
    call.url.includes(fragment)
      ? typeof answer === 'function'
        ? answer(call)
        : answer
      : undefined;
