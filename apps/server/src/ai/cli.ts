import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Running an AI CLI safely: never through a shell, prompt on stdin, hard timeout, cancellable.
 */

export interface ResolvedCommand {
  /** Executable to spawn. */
  file: string;
  /** Arguments that go before the caller's own (the script path, for npm shims). */
  prefixArgs: string[];
}

export interface CliRunOptions {
  command: ResolvedCommand;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Working directory. An empty folder keeps the CLI from picking up project files. */
  cwd: string;
}

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Why the process did not end by itself, if it did not. */
  stopped: 'timeout' | 'cancelled' | null;
}

export type CliRunner = (options: CliRunOptions) => Promise<CliResult>;
export type CommandResolver = (name: string) => ResolvedCommand | null;

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/**
 * npm installs a `.cmd` shim on Windows, which cannot be spawned without a shell. The shim only
 * forwards to `node <script>` or, for tools shipped as a native binary, to an `.exe` inside the
 * package. Read that target out of the shim and run it directly.
 */
function resolveNpmShim(shimPath: string): ResolvedCommand | null {
  let content: string;
  try {
    content = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  const match = /"%~?dp0%?\\([^"]+?\.(?:(?:c|m)?js|exe))"/i.exec(content);
  if (!match?.[1]) return null;
  const target = path.join(path.dirname(shimPath), match[1]);
  if (!existsSync(target)) return null;
  return target.toLowerCase().endsWith('.exe')
    ? { file: target, prefixArgs: [] }
    : { file: process.execPath, prefixArgs: [target] };
}

/** Finds a command on PATH without asking a shell. Returns null when it is not installed. */
export function resolveCommand(
  name: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand | null {
  const directories = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      if (!existsSync(candidate)) continue;
      if (extension === '.cmd' || extension === '.bat') {
        const shim = resolveNpmShim(candidate);
        if (shim) return shim;
        continue;
      }
      return { file: candidate, prefixArgs: [] };
    }
  }
  return null;
}

export const runCli: CliRunner = (options) =>
  new Promise((resolve) => {
    const child = spawn(options.command.file, [...options.command.prefixArgs, ...options.args], {
      shell: false,
      windowsHide: true,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stopped: CliResult['stopped'] = null;
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, stdout, stderr, stopped });
    };
    const stop = (reason: 'timeout' | 'cancelled') => {
      stopped ??= reason;
      child.kill();
    };
    const onAbort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs);

    if (options.signal?.aborted) stop('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8');
    });
    // "Not found" and similar arrive as an error event instead of an exit code.
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));

    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin ?? '');
  });
