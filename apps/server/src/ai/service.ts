import type { AiOverviewResponse, AiProviderId, AiProviderStatus } from '@gamebacklog/shared';
import type { AppDatabase } from '../db/client.ts';
import type { SecretName, SecretStore } from '../secrets/store.ts';
import { SETTINGS, getSetting } from '../settings/store.ts';
import type { FetchLike } from '../sources/http.ts';
import { resolveCommand, runCli, type CliRunner, type CommandResolver } from './cli.ts';
import { defineProvider, type AiProvider } from './provider.ts';
import { API_SPECS, createApiProvider } from './providers/api.ts';
import { CLI_SPECS, billingWarning, createCliProvider } from './providers/cli.ts';

/** Secret that holds the API key of each pay-per-use provider. */
export const AI_KEY_SECRET: Partial<Record<AiProviderId, SecretName>> = {
  anthropic: 'ai.anthropic.api_key',
  openai: 'ai.openai.api_key',
  google: 'ai.google.api_key',
  openrouter: 'ai.openrouter.api_key',
};

export interface AiService {
  providers: Map<AiProviderId, AiProvider>;
  /** The provider the user connected, or null. Features show "connect an AI" when null. */
  getActive(): AiProvider | null;
  overview(): Promise<AiOverviewResponse>;
}

export interface AiServiceOptions {
  db: AppDatabase;
  secrets: SecretStore;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  resolve?: CommandResolver;
  run?: CliRunner;
}

export function createAiService(options: AiServiceOptions): AiService {
  const { db, secrets } = options;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const resolve = options.resolve ?? ((name) => resolveCommand(name, env));
  const run = options.run ?? runCli;

  const modelOf = (id: AiProviderId) => getSetting(db, SETTINGS.aiModels)[id]?.trim() || null;
  const baseUrlOf = (id: AiProviderId) => getSetting(db, SETTINGS.aiBaseUrls)[id]?.trim() || null;
  const timeoutMs = () => getSetting(db, SETTINGS.aiTimeoutMs);

  const providers = new Map<AiProviderId, AiProvider>();
  for (const spec of CLI_SPECS) {
    providers.set(
      spec.id,
      defineProvider(
        createCliProvider({ spec, resolve, run, getModel: () => modelOf(spec.id), timeoutMs }),
      ),
    );
  }
  for (const spec of API_SPECS) {
    const secretName = AI_KEY_SECRET[spec.id];
    providers.set(
      spec.id,
      defineProvider(
        createApiProvider({
          spec,
          getApiKey: () => (secretName ? secrets.get(secretName) : null),
          getModel: () => modelOf(spec.id),
          getBaseUrl: () => baseUrlOf(spec.id),
          timeoutMs,
          fetch: fetchImpl,
        }),
      ),
    );
  }

  return {
    providers,

    getActive() {
      const id = getSetting(db, SETTINGS.aiProvider);
      return id ? (providers.get(id) ?? null) : null;
    },

    async overview(): Promise<AiOverviewResponse> {
      const statuses = await Promise.all(
        [...providers.values()].map(async (provider): Promise<AiProviderStatus> => {
          const health = await provider
            .detect()
            .catch(() => ({ status: 'error' as const, message: 'detect failed' }));
          const secretName = AI_KEY_SECRET[provider.id];
          const apiSpec = API_SPECS.find((spec) => spec.id === provider.id);
          const cliSpec = CLI_SPECS.find((spec) => spec.id === provider.id);
          return {
            id: provider.id,
            displayName: provider.displayName,
            kind: provider.kind,
            costHint: provider.capabilities.costHint,
            status: health.status,
            model: modelOf(provider.id) ?? apiSpec?.defaultModel ?? null,
            baseUrl:
              provider.kind === 'local'
                ? (baseUrlOf(provider.id) ?? apiSpec?.defaultBaseUrl ?? null)
                : null,
            hasKey: secretName ? Boolean(secrets.get(secretName)) : false,
            billingWarning: cliSpec ? billingWarning(cliSpec, env) : null,
          };
        }),
      );
      return {
        activeProviderId: getSetting(db, SETTINGS.aiProvider),
        contextBudgetTokens: getSetting(db, SETTINGS.aiContextBudget),
        providers: statuses,
      };
    },
  };
}
