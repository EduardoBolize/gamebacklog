import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AiProviderId } from '@gamebacklog/shared';
import type { CliResult, CliRunner, CommandResolver } from '../cli.ts';
import {
  AiProviderError,
  type AiHealth,
  type AiProviderCore,
  type AiTextRequest,
  type AiTextResult,
} from '../provider.ts';

/**
 * Providers that drive an AI command-line tool the user already has, so requests are covered by
 * their subscription. Every CLI runs with the tightest settings its documentation offers: no
 * file edits, no commands, no tools of its own — the app does all the searching and only asks
 * for text back. Flags checked against each tool's documentation in November 2026.
 */

interface CliSpec {
  id: AiProviderId;
  displayName: string;
  command: string;
  /** Variables that make the CLI bill an API key instead of the subscription. */
  billingEnvVars: string[];
  /** Subcommand that exits 0 when the user is logged in, when the CLI has one. */
  loginStatusArgs?: string[];
  buildArgs(options: { model: string | null; system: string; outputFile: string }): string[];
  /** What goes to stdin. The system prompt is included for CLIs with no flag for it. */
  buildStdin(request: AiTextRequest): string;
  parse(result: CliResult, outputFile: string): AiTextResult;
}

const NOT_LOGGED_IN =
  /not logged in|log ?in required|please (run|use).{0,20}login|unauthori[sz]ed|authentication|invalid api key|401/i;

function parseJsonLine(stdout: string): Record<string, unknown> | null {
  // Some CLIs print notices before the JSON; the result is the last line that parses.
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object') return value as Record<string, unknown>;
    } catch {
      // Not JSON; keep looking.
    }
  }
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const asNumber = (value: unknown) => (typeof value === 'number' ? value : undefined);

export const CLI_SPECS: CliSpec[] = [
  {
    id: 'claude_cli',
    displayName: 'Claude Code (CLI)',
    command: 'claude',
    billingEnvVars: ['ANTHROPIC_API_KEY'],
    loginStatusArgs: ['auth', 'status'],
    // -p: print and exit. --tools "": no built-in tools. --strict-mcp-config with no
    // --mcp-config: no MCP servers. One turn, nothing saved to disk.
    buildArgs: ({ model, system }) => [
      '-p',
      '--output-format',
      'json',
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--max-turns',
      '1',
      '--system-prompt',
      system,
      ...(model ? ['--model', model] : []),
    ],
    buildStdin: (request) => request.prompt,
    parse(result) {
      const json = parseJsonLine(result.stdout);
      if (!json || typeof json.result !== 'string' || json.is_error === true) {
        throw new Error(typeof json?.result === 'string' ? json.result : result.stderr);
      }
      const usage = (json.usage ?? {}) as Record<string, unknown>;
      const models = Object.keys(json.modelUsage ?? {});
      return {
        text: json.result,
        model: models[0] ?? 'claude',
        usage: {
          inputTokens:
            (asNumber(usage.input_tokens) ?? 0) +
            (asNumber(usage.cache_read_input_tokens) ?? 0) +
            (asNumber(usage.cache_creation_input_tokens) ?? 0),
          outputTokens: asNumber(usage.output_tokens),
        },
      };
    },
  },
  {
    id: 'codex_cli',
    displayName: 'Codex (CLI)',
    command: 'codex',
    billingEnvVars: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
    loginStatusArgs: ['login', 'status'],
    // Read-only sandbox, no session files, final message written to a file; "-" reads stdin.
    buildArgs: ({ model, outputFile }) => [
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--color',
      'never',
      '--output-last-message',
      outputFile,
      ...(model ? ['--model', model] : []),
      '-',
    ],
    buildStdin: (request) => `${request.system}\n\n${request.prompt}`,
    parse(result, outputFile) {
      const text = readFileSync(outputFile, 'utf8').trim();
      if (!text) throw new Error(result.stderr);
      return { text, model: 'codex' };
    },
  },
  {
    id: 'gemini_cli',
    displayName: 'Gemini (CLI)',
    command: 'gemini',
    billingEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    // Piped stdin runs it headless; in that mode anything needing approval is refused.
    buildArgs: ({ model }) => [
      '--output-format',
      'json',
      '--approval-mode',
      'default',
      ...(model ? ['--model', model] : []),
    ],
    buildStdin: (request) => `${request.system}\n\n${request.prompt}`,
    parse(result) {
      const json = parseJsonLine(result.stdout);
      if (!json || typeof json.response !== 'string' || json.error) {
        const error = json?.error as { message?: unknown } | undefined;
        throw new Error(typeof error?.message === 'string' ? error.message : result.stderr);
      }
      return { text: json.response, model: 'gemini' };
    },
  },
];

export interface CliProviderOptions {
  spec: CliSpec;
  resolve: CommandResolver;
  run: CliRunner;
  getModel: () => string | null;
  timeoutMs: () => number;
}

/** Name of the first billing variable present in the environment, or null. */
export function billingWarning(
  spec: Pick<CliSpec, 'billingEnvVars'>,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return spec.billingEnvVars.find((name) => Boolean(env[name]?.trim())) ?? null;
}

export function createCliProvider(options: CliProviderOptions): AiProviderCore {
  const { spec, resolve, run } = options;

  function requireCommand() {
    const command = resolve(spec.command);
    if (!command) {
      throw new AiProviderError(spec.id, 'unavailable', `${spec.displayName} is not installed`);
    }
    return command;
  }

  return {
    id: spec.id,
    displayName: spec.displayName,
    kind: 'cli',
    capabilities: { structuredOutput: false, maxContextTokens: 100_000, costHint: 'subscription' },

    async detect(): Promise<AiHealth> {
      const command = resolve(spec.command);
      if (!command) return { status: 'not_installed', message: `${spec.command} is not on PATH` };
      if (!spec.loginStatusArgs) return { status: 'ok', message: `${spec.command} is installed` };

      const status = await run({
        command,
        args: spec.loginStatusArgs,
        timeoutMs: 15_000,
        cwd: os.tmpdir(),
      });
      if (status.stopped || status.exitCode === null) {
        return { status: 'error', message: `${spec.command} did not answer` };
      }
      return status.exitCode === 0
        ? { status: 'ok', message: `${spec.command} is installed and logged in` }
        : { status: 'not_authenticated', message: `${spec.command} is not logged in` };
    },

    async generate(request): Promise<AiTextResult> {
      const command = requireCommand();
      // A fresh empty folder: nothing for the CLI to read, and a place for its output file.
      const workDir = mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-ai-'));
      const outputFile = path.join(workDir, 'answer.txt');
      try {
        const result = await run({
          command,
          args: spec.buildArgs({ model: options.getModel(), system: request.system, outputFile }),
          stdin: spec.buildStdin(request),
          timeoutMs: options.timeoutMs(),
          signal: request.signal,
          cwd: workDir,
        });
        if (result.stopped === 'timeout') {
          throw new AiProviderError(spec.id, 'timeout', `${spec.displayName} took too long`);
        }
        if (result.stopped === 'cancelled') {
          throw new AiProviderError(spec.id, 'cancelled', 'The request was cancelled');
        }
        try {
          if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
          return spec.parse(result, outputFile);
        } catch (error) {
          // The CLI's own text decides between "log in" and "something else". It is not
          // echoed to the user: it could quote the environment.
          const text = `${error instanceof Error ? error.message : ''} ${result.stderr}`;
          if (NOT_LOGGED_IN.test(text)) {
            throw new AiProviderError(
              spec.id,
              'not_authenticated',
              `${spec.displayName} is not logged in`,
            );
          }
          throw new AiProviderError(
            spec.id,
            'provider_error',
            `${spec.displayName} failed (exit code ${String(result.exitCode)})`,
          );
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  };
}
