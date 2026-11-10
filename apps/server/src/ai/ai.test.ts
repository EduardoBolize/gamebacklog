import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AiOverviewResponse, AiUsageResponse } from '@gamebacklog/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestDatabase } from '../test/helpers.ts';
import { createTestApp, type TestApp } from '../test/context.ts';
import { MemorySecretStore } from '../secrets/store.ts';
import { SETTINGS, setSetting } from '../settings/store.ts';
import { resolveCommand, runCli, type CliRunOptions } from './cli.ts';
import { aiCacheKey, fitToBudget, runAiTask, type AiTask } from './pipeline.ts';
import { AiProviderError, defineProvider, extractJson } from './provider.ts';
import { CLI_SPECS, billingWarning, createCliProvider } from './providers/cli.ts';
import { createAiService } from './service.ts';

const tempDirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gamebacklog-ai-test-'));
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('extractJson', () => {
  it('reads bare JSON, fenced JSON and JSON with chatter around it', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here it is:\n{"a":{"b":[1,2]}}\nHope it helps.')).toEqual({
      a: { b: [1, 2] },
    });
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('fails clearly when there is no JSON', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/No JSON/);
    expect(() => extractJson('{"a": 1')).toThrow();
  });
});

describe('structured completion', () => {
  const schema = z.object({ hint: z.string().min(1), level: z.number().int() });
  const provider = (text: string) =>
    defineProvider({
      id: 'ollama',
      displayName: 'Test',
      kind: 'local',
      capabilities: { structuredOutput: false, maxContextTokens: 8000, costHint: 'free' },
      detect: () => Promise.resolve({ status: 'ok', message: '' }),
      generate: () => Promise.resolve({ text, model: 'm' }),
    });

  it('returns the validated object and estimates tokens when the provider reports none', async () => {
    const result = await provider('{"hint":"look up","level":1}').complete({
      system: 'sys',
      prompt: 'p'.repeat(400),
      schema,
      maxTokens: 100,
    });
    expect(result.output).toEqual({ hint: 'look up', level: 1 });
    expect(result.usage.inputTokensEstimated).toBeGreaterThan(100);
    expect(result.usage.outputTokensEstimated).toBeGreaterThan(0);
  });

  it.each([
    ['not JSON at all', 'did not answer with JSON'],
    ['{"hint":"","level":1}', 'wrong shape'],
    ['{"hint":"x","level":"one"}', 'wrong shape'],
    ['{"level":1}', 'wrong shape'],
  ])('rejects %j as an invalid response, with the reason attached', async (text, message) => {
    const error = await provider(text)
      .complete({ system: 's', prompt: 'p', schema, maxTokens: 100 })
      .then(
        () => null,
        (caught: unknown) => caught as AiProviderError,
      );
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error?.code).toBe('invalid_response');
    expect(error?.message).toContain(message);
    expect(error?.detail).toBeTruthy();
  });

  it('returns plain text when no schema is given', async () => {
    const result = await provider('just text').complete({
      system: 's',
      prompt: 'p',
      maxTokens: 10,
    });
    expect(result.output).toBe('just text');
  });
});

describe('data-first pipeline', () => {
  let t: TestApp;
  const schema = z.object({ answer: z.string() });
  const collect = vi.fn(() => Promise.resolve('context from the wiki'));

  const task = (overrides: Partial<AiTask<string, { answer: string }>> = {}) => ({
    feature: 'test_feature',
    gameId: null,
    cacheKeyParts: ['checkpoint-1', 'finish', 2],
    promptVersion: 'v1',
    schema,
    maxTokens: 200,
    collect,
    build: (context: string) => ({ system: 'system', prompt: `Use this: ${context}` }),
    ...overrides,
  });
  const usage = async () =>
    (await t.app.inject({ method: 'GET', url: '/api/ai/usage' })).json<AiUsageResponse>();

  beforeEach(async () => {
    t = await createTestApp();
    collect.mockClear();
  });
  afterEach(() => t.close());

  it('answers the second identical request from the cache, with zero tokens', async () => {
    t.ai.answers = [{ answer: 'first' }];
    const first = await runAiTask(t.ctx, task());
    expect(first).toMatchObject({ output: { answer: 'first' }, cached: false });
    expect(t.ai.requests[0]?.prompt).toBe('Use this: context from the wiki');

    const second = await runAiTask(t.ctx, task());
    expect(second).toMatchObject({ output: { answer: 'first' }, cached: true, context: null });
    // Nothing was collected and nothing was asked the second time.
    expect(collect).toHaveBeenCalledTimes(1);
    expect(t.ai.requests).toHaveLength(1);

    const log = await usage();
    expect(log.totals).toMatchObject({ requests: 2, cacheHits: 1 });
    const [hit, miss] = log.items;
    expect(hit).toMatchObject({
      cacheHit: true,
      inputTokensEstimated: 0,
      outputTokensEstimated: 0,
    });
    expect(miss?.cacheHit).toBe(false);
    expect(miss?.inputTokensEstimated).toBeGreaterThan(0);
    expect(miss).toMatchObject({ providerId: 'ollama', model: 'fake-model', success: true });
  });

  it('treats a different checkpoint, level or prompt version as a different request', async () => {
    t.ai.answers = [{ answer: 'a' }];
    await runAiTask(t.ctx, task());
    await runAiTask(t.ctx, task({ cacheKeyParts: ['checkpoint-2', 'finish', 2] }));
    await runAiTask(t.ctx, task({ cacheKeyParts: ['checkpoint-1', 'finish', 3] }));
    await runAiTask(t.ctx, task({ promptVersion: 'v2' }));
    expect(t.ai.requests).toHaveLength(4);
    expect(aiCacheKey(task())).not.toBe(aiCacheKey(task({ promptVersion: 'v2' })));
  });

  it('retries once with the validation error attached when the JSON is invalid', async () => {
    t.ai.answers = ['Here you go: {"answer": 42}', { answer: 'fixed' }];
    const result = await runAiTask(t.ctx, task());
    expect(result.output).toEqual({ answer: 'fixed' });
    expect(t.ai.requests).toHaveLength(2);
    expect(t.ai.requests[1]?.prompt).toContain('Your previous answer was rejected');
    expect(t.ai.requests[1]?.prompt).toContain('answer');

    const log = await usage();
    expect(log.items.map((item) => [item.success, item.errorCode])).toEqual([
      [true, null],
      [false, 'invalid_response'],
    ]);
  });

  it('gives up with a clear error after the second invalid answer, and caches nothing', async () => {
    t.ai.answers = ['nope', 'still nope'];
    await expect(runAiTask(t.ctx, task())).rejects.toMatchObject({
      statusCode: 502,
      code: 'ai_invalid_response',
    });
    expect(t.ai.requests).toHaveLength(2);

    t.ai.answers = [{ answer: 'works now' }];
    expect((await runAiTask(t.ctx, task())).cached).toBe(false);
  });

  it('needs a connected AI on a miss, but still serves the cache without one', async () => {
    t.ai.answers = [{ answer: 'cached earlier' }];
    await runAiTask(t.ctx, task());

    t.ai.connected = false;
    expect((await runAiTask(t.ctx, task())).output).toEqual({ answer: 'cached earlier' });
    await expect(runAiTask(t.ctx, task({ cacheKeyParts: ['other'] }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ai_not_connected',
    });
  });

  it('honours the TTL when one is set', async () => {
    t.ai.answers = [{ answer: 'short-lived' }];
    await runAiTask(t.ctx, task({ ttlMs: 60_000 }));
    t.setNow('2026-11-10T12:02:00.000Z');
    expect((await runAiTask(t.ctx, task({ ttlMs: 60_000 }))).cached).toBe(false);
  });

  it('passes the configured context budget to the prompt builder', async () => {
    setSetting(t.ctx.db, SETTINGS.aiContextBudget, 1234);
    t.ai.answers = [{ answer: 'ok' }];
    const build = vi.fn(() => ({ system: 's', prompt: 'p' }));
    await runAiTask(t.ctx, task({ build }));
    expect(build).toHaveBeenCalledWith('context from the wiki', 1234);
  });
});

describe('fitToBudget', () => {
  it('keeps short text and cuts long text on a line break', () => {
    expect(fitToBudget('short', 100)).toBe('short');
    const long = Array.from({ length: 200 }, (_, index) => `line number ${index}`).join('\n');
    const cut = fitToBudget(long, 100);
    expect(cut.length).toBeLessThanOrEqual(400);
    expect(long.startsWith(cut)).toBe(true);
    expect(cut.endsWith('line number 2')).toBe(false);
    expect(cut).toMatch(/line number \d+$/);
  });
});

describe('running a CLI', () => {
  // "--" ends node's own options, so what follows reaches the script as plain arguments.
  const node = (script: string) => ({ file: process.execPath, prefixArgs: ['-e', script, '--'] });
  const cwd = os.tmpdir();

  it('passes the prompt on stdin and arguments untouched, without a shell', async () => {
    const result = await runCli({
      command: node(
        'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({stdin:s,args:process.argv.slice(1)})))',
      ),
      // Shell metacharacters must arrive as plain text.
      args: ['--tools', '', '--system-prompt', 'a "quoted" $HOME & | ; `x` value'],
      stdin: 'prompt with\nnew lines',
      timeoutMs: 20_000,
      cwd,
    });
    expect(result).toMatchObject({ exitCode: 0, stopped: null });
    expect(JSON.parse(result.stdout)).toEqual({
      stdin: 'prompt with\nnew lines',
      args: ['--tools', '', '--system-prompt', 'a "quoted" $HOME & | ; `x` value'],
    });
  });

  it('kills the process on timeout', async () => {
    const result = await runCli({
      command: node('setTimeout(()=>{}, 60000)'),
      args: [],
      timeoutMs: 300,
      cwd,
    });
    expect(result.stopped).toBe('timeout');
  });

  it('kills the process when the request is cancelled', async () => {
    const controller = new AbortController();
    const running = runCli({
      command: node('setTimeout(()=>{}, 60000)'),
      args: [],
      timeoutMs: 60_000,
      signal: controller.signal,
      cwd,
    });
    setTimeout(() => controller.abort(), 200);
    expect((await running).stopped).toBe('cancelled');
  });

  it('reports a missing executable instead of throwing', async () => {
    const result = await runCli({
      command: { file: path.join(cwd, 'definitely-not-here.exe'), prefixArgs: [] },
      args: [],
      timeoutMs: 5000,
      cwd,
    });
    expect(result.exitCode).not.toBe(0);
  });
});

describe('resolveCommand', () => {
  it('finds an executable on PATH and returns null when it is not installed', () => {
    const bin = tempDir();
    writeFileSync(path.join(bin, 'mytool.exe'), '');
    writeFileSync(path.join(bin, 'mytool'), '');
    expect(resolveCommand('mytool', { PATH: bin }, 'win32')).toEqual({
      file: path.join(bin, 'mytool.exe'),
      prefixArgs: [],
    });
    expect(resolveCommand('mytool', { PATH: bin }, 'linux')?.file).toBe(path.join(bin, 'mytool'));
    expect(resolveCommand('other', { PATH: bin }, 'win32')).toBeNull();
  });

  it('unwraps an npm .cmd shim into "node script", so no shell is needed', () => {
    const bin = tempDir();
    const script = path.join(bin, 'node_modules', '@scope', 'tool', 'cli.js');
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, '');
    writeFileSync(
      path.join(bin, 'tool.cmd'),
      '@ECHO off\r\nGOTO start\r\n:start\r\n"%_prog%"  "%dp0%\\node_modules\\@scope\\tool\\cli.js" %*\r\n',
    );
    expect(resolveCommand('tool', { PATH: bin }, 'win32')).toEqual({
      file: process.execPath,
      prefixArgs: [script],
    });
  });
});

describe('CLI providers', () => {
  const spec = (id: string) => {
    const found = CLI_SPECS.find((candidate) => candidate.id === id);
    if (!found) throw new Error(id);
    return found;
  };
  const installed = () => ({ file: '/usr/bin/tool', prefixArgs: [] });

  function provider(
    id: string,
    respond: (options: CliRunOptions) => {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
      stopped?: 'timeout' | 'cancelled';
    },
    model: string | null = null,
  ) {
    const calls: CliRunOptions[] = [];
    const core = createCliProvider({
      spec: spec(id),
      resolve: installed,
      run: (options) => {
        calls.push(options);
        const answer = respond(options);
        return Promise.resolve({
          exitCode: answer.exitCode === undefined ? 0 : answer.exitCode,
          stdout: answer.stdout ?? '',
          stderr: answer.stderr ?? '',
          stopped: answer.stopped ?? null,
        });
      },
      getModel: () => model,
      timeoutMs: () => 30_000,
    });
    return { core, calls };
  }
  const request = { system: 'You give hints.', prompt: 'Where is the key?', maxTokens: 100 };

  it('runs Claude Code with every tool switched off and the prompt on stdin', async () => {
    const { core, calls } = provider(
      'claude_cli',
      () => ({
        stdout: JSON.stringify({
          type: 'result',
          is_error: false,
          result: 'Look behind the waterfall.',
          usage: { input_tokens: 40, cache_read_input_tokens: 10, output_tokens: 8 },
          modelUsage: { 'claude-sonnet-5-5': {} },
        }),
      }),
      'sonnet',
    );
    const result = await core.generate(request);

    expect(result).toEqual({
      text: 'Look behind the waterfall.',
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 50, outputTokens: 8 },
    });
    expect(calls[0]?.stdin).toBe('Where is the key?');
    expect(calls[0]?.args).toEqual([
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
      'You give hints.',
      '--model',
      'sonnet',
    ]);
  });

  it('runs Codex read-only, reading the answer from the output file', async () => {
    const { core, calls } = provider('codex_cli', (options) => {
      const outputFile = options.args[options.args.indexOf('--output-last-message') + 1] ?? '';
      writeFileSync(outputFile, 'Try the left door.\n');
      return {};
    });
    const result = await core.generate(request);

    expect(result.text).toBe('Try the left door.');
    expect(calls[0]?.args.slice(0, 7)).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--color',
      'never',
    ]);
    expect(calls[0]?.args.at(-1)).toBe('-');
    expect(calls[0]?.stdin).toBe('You give hints.\n\nWhere is the key?');
  });

  it('runs Gemini headless and reads the JSON response', async () => {
    const { core, calls } = provider('gemini_cli', () => ({
      stdout: JSON.stringify({ response: 'Check the map room.', stats: {} }),
    }));
    expect((await core.generate(request)).text).toBe('Check the map room.');
    expect(calls[0]?.args).toEqual(['--output-format', 'json', '--approval-mode', 'default']);
  });

  it('runs in an empty temporary folder, removed afterwards', async () => {
    const { core, calls } = provider('gemini_cli', () => ({
      stdout: JSON.stringify({ response: 'ok' }),
    }));
    await core.generate(request);
    const cwd = calls[0]?.cwd ?? '';
    expect(cwd.startsWith(os.tmpdir())).toBe(true);
    expect(() => writeFileSync(path.join(cwd, 'x'), '')).toThrow();
  });

  it('maps failures to provider errors without echoing the CLI output', async () => {
    const timeout = provider('claude_cli', () => ({ stopped: 'timeout', exitCode: null }));
    await expect(timeout.core.generate(request)).rejects.toMatchObject({ code: 'timeout' });

    const loggedOut = provider('claude_cli', () => ({
      exitCode: 1,
      stderr: 'Invalid API key · Please run /login',
    }));
    await expect(loggedOut.core.generate(request)).rejects.toMatchObject({
      code: 'not_authenticated',
    });

    const broken = provider('claude_cli', () => ({
      exitCode: 2,
      stderr: 'boom SECRET_VALUE=abc',
    }));
    const error = await broken.core.generate(request).then(
      () => new Error('expected a failure'),
      (caught: unknown) => caught as Error,
    );
    expect(error).toMatchObject({ code: 'provider_error' });
    expect(error.message).not.toContain('SECRET_VALUE');

    const garbage = provider('claude_cli', () => ({ stdout: 'not json' }));
    await expect(garbage.core.generate(request)).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('detects "not installed", "not logged in" and "ready"', async () => {
    const missing = createCliProvider({
      spec: spec('claude_cli'),
      resolve: () => null,
      run: () => Promise.reject(new Error('must not run')),
      getModel: () => null,
      timeoutMs: () => 1000,
    });
    expect((await missing.detect()).status).toBe('not_installed');
    await expect(missing.generate(request)).rejects.toMatchObject({ code: 'unavailable' });

    const loggedOut = provider('claude_cli', () => ({ exitCode: 1 }));
    expect((await loggedOut.core.detect()).status).toBe('not_authenticated');
    expect(loggedOut.calls[0]?.args).toEqual(['auth', 'status']);

    expect((await provider('codex_cli', () => ({})).core.detect()).status).toBe('ok');
  });

  it('warns when an API key in the environment would be billed instead of the subscription', () => {
    expect(billingWarning(spec('claude_cli'), { ANTHROPIC_API_KEY: 'sk-x' })).toBe(
      'ANTHROPIC_API_KEY',
    );
    expect(billingWarning(spec('claude_cli'), { ANTHROPIC_API_KEY: '  ' })).toBeNull();
    expect(billingWarning(spec('codex_cli'), { OPENAI_API_KEY: 'sk-x' })).toBe('OPENAI_API_KEY');
    expect(billingWarning(spec('gemini_cli'), {})).toBeNull();
  });
});

describe('API and local providers', () => {
  const chatCompletion = (content: string) =>
    new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1_794_000_000,
        model: 'llama3.2',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 21, completion_tokens: 5, total_tokens: 26 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  function service(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const handle = createTestDatabase();
    const secrets = new MemorySecretStore();
    const calls: { url: string; init?: RequestInit }[] = [];
    const ai = createAiService({
      db: handle.db,
      secrets,
      env: {},
      resolve: () => null,
      fetch: (input, init) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(respond(String(input), init));
      },
    });
    return { ai, calls, secrets, db: handle.db, close: () => handle.close() };
  }

  it('talks to Ollama through its OpenAI-compatible endpoint', async () => {
    const s = service((url) =>
      url.endsWith('/models')
        ? new Response(JSON.stringify({ data: [{ id: 'llama3.2' }, { id: 'qwen3' }] }))
        : chatCompletion('The key is under the mat.'),
    );
    setSetting(s.db, SETTINGS.aiModels, { ollama: 'llama3.2' });
    const ollama = s.ai.providers.get('ollama');

    expect(await ollama?.listModels?.()).toEqual(['llama3.2', 'qwen3']);
    expect((await ollama?.detect())?.status).toBe('ok');

    const result = await ollama?.complete({ system: 'sys', prompt: 'where?', maxTokens: 100 });
    expect(result?.output).toBe('The key is under the mat.');
    expect(result?.usage).toMatchObject({ inputTokensEstimated: 21, outputTokensEstimated: 5 });

    const call = s.calls.find((item) => item.url.endsWith('/chat/completions'));
    expect(call?.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(call?.init?.body as string) as {
      model: string;
      messages: { role: string; content: unknown }[];
      temperature?: number;
    };
    expect(body.model).toBe('llama3.2');
    expect(body.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(body.temperature).toBeUndefined();
    s.close();
  });

  it('reports a local server that is not running', async () => {
    const s = service(() => Promise.reject(new Error('ECONNREFUSED')));
    expect((await s.ai.providers.get('lmstudio')?.detect())?.status).toBe('unreachable');
    s.close();
  });

  it('needs a key and a model for a pay-per-use provider, and keeps the key out of errors', async () => {
    const s = service(
      () => new Response('{"error":{"message":"bad key sk-SECRET"}}', { status: 401 }),
    );
    const openai = s.ai.providers.get('openai');
    expect((await openai?.detect())?.status).toBe('not_configured');
    await expect(
      openai?.complete({ system: 's', prompt: 'p', maxTokens: 10 }),
    ).rejects.toMatchObject({ code: 'unavailable' });

    s.secrets.set('ai.openai.api_key', 'sk-SECRET');
    setSetting(s.db, SETTINGS.aiModels, { openai: 'some-model' });
    expect((await openai?.detect())?.status).toBe('ok');
    const error = await openai?.complete({ system: 's', prompt: 'p', maxTokens: 10 }).then(
      () => new Error('expected a failure'),
      (caught: unknown) => caught as Error,
    );
    expect(error).toMatchObject({ code: 'not_authenticated' });
    expect(error?.message).not.toContain('sk-SECRET');
    expect((await openai?.healthCheck())?.status).toBe('not_authenticated');
    s.close();
  });
});

describe('AI routes', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.close());

  const call = async <T>(method: string, url: string, payload?: object) => {
    const response = await t.app.inject({ method: method as 'GET', url, payload });
    return { status: response.statusCode, body: response.json<T>(), raw: response.body };
  };

  it('lists every provider with its kind, cost and state', async () => {
    const { body } = await call<AiOverviewResponse>('GET', '/api/ai');
    expect(body.activeProviderId).toBeNull();
    expect(body.contextBudgetTokens).toBe(6000);
    expect(
      body.providers.map((provider) => [provider.id, provider.kind, provider.costHint]),
    ).toEqual([
      ['claude_cli', 'cli', 'subscription'],
      ['codex_cli', 'cli', 'subscription'],
      ['gemini_cli', 'cli', 'subscription'],
      ['anthropic', 'api', 'pay-per-use'],
      ['openai', 'api', 'pay-per-use'],
      ['google', 'api', 'pay-per-use'],
      ['openrouter', 'api', 'pay-per-use'],
      ['ollama', 'local', 'free'],
      ['lmstudio', 'local', 'free'],
    ]);
    expect(body.providers.find((provider) => provider.id === 'claude_cli')?.status).toBe(
      'not_installed',
    );
    expect(body.providers.find((provider) => provider.id === 'anthropic')).toMatchObject({
      status: 'not_configured',
      model: 'claude-opus-5-5',
      hasKey: false,
    });
  });

  it('stores a key in the secret store and never returns it', async () => {
    const saved = await call<AiOverviewResponse>('PUT', '/api/ai/providers/openai', {
      apiKey: 'sk-VERYSECRET',
      model: 'gpt-something',
    });
    expect(saved.raw).not.toContain('sk-VERYSECRET');
    expect(saved.body.providers.find((provider) => provider.id === 'openai')).toMatchObject({
      hasKey: true,
      model: 'gpt-something',
      status: 'ok',
    });
    expect(t.ctx.secrets.get('ai.openai.api_key')).toBe('sk-VERYSECRET');
    expect((await call('GET', '/api/export')).raw).not.toContain('sk-VERYSECRET');

    await call('DELETE', '/api/ai/providers/openai/key');
    expect(t.ctx.secrets.get('ai.openai.api_key')).toBeNull();
  });

  it('rejects a key for a provider that takes none, and odd model names', async () => {
    expect((await call('PUT', '/api/ai/providers/ollama', { apiKey: 'x' })).status).toBe(400);
    expect(
      (await call('PUT', '/api/ai/providers/claude_cli', { model: '--dangerous flag' })).status,
    ).toBe(400);
    expect((await call('PUT', '/api/ai/providers/nope', { model: 'x' })).status).toBe(400);
  });

  it('chooses the active provider and the context budget', async () => {
    const { body } = await call<AiOverviewResponse>('PUT', '/api/ai/settings', {
      activeProviderId: 'ollama',
      contextBudgetTokens: 3000,
    });
    expect(body).toMatchObject({ activeProviderId: 'ollama', contextBudgetTokens: 3000 });
    expect((await call('PUT', '/api/ai/settings', { contextBudgetTokens: 10 })).status).toBe(400);
  });
});
