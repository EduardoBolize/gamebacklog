import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_NAME } from '@gamebacklog/shared';
import { Entry } from '@napi-rs/keyring';

/**
 * Where API keys and tokens live. They are never written to the database, the export file,
 * logs or error messages.
 */
export interface SecretStore {
  readonly kind: 'keychain' | 'file';
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  delete(name: SecretName): void;
}

export const SECRET_NAMES = [
  'igdb.client_id',
  'igdb.client_secret',
  'steam.api_key',
  'rawg.api_key',
  'retroachievements.username',
  'retroachievements.api_key',
  'psn.npsso',
  'psn.refresh_token',
  'xbox.openxbl_api_key',
  'ai.anthropic.api_key',
  'ai.openai.api_key',
  'ai.google.api_key',
  'ai.openrouter.api_key',
  'search.brave.api_key',
  'search.tavily.api_key',
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/** OS keychain: Credential Manager (Windows), Keychain (macOS), Secret Service (Linux). */
export class KeychainSecretStore implements SecretStore {
  readonly kind = 'keychain';

  get(name: SecretName): string | null {
    return new Entry(APP_NAME, name).getPassword();
  }

  set(name: SecretName, value: string): void {
    new Entry(APP_NAME, name).setPassword(value);
  }

  delete(name: SecretName): void {
    try {
      new Entry(APP_NAME, name).deletePassword();
    } catch {
      // Deleting a secret that is not there is fine.
    }
  }
}

/**
 * Fallback for systems without a keychain (e.g. a headless Linux box): a JSON file in the data
 * folder, readable only by the owner where the OS supports file modes.
 */
export class FileSecretStore implements SecretStore {
  readonly kind = 'file';
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'secrets.json');
  }

  private read(): Partial<Record<SecretName, string>> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Record<SecretName, string>>;
    } catch {
      return {};
    }
  }

  private write(values: Partial<Record<SecretName, string>>): void {
    writeFileSync(this.file, JSON.stringify(values, null, 2), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  get(name: SecretName): string | null {
    return this.read()[name] ?? null;
  }

  set(name: SecretName, value: string): void {
    this.write({ ...this.read(), [name]: value });
  }

  delete(name: SecretName): void {
    const values = this.read();
    delete values[name];
    this.write(values);
  }
}

/** In-memory store for tests. */
export class MemorySecretStore implements SecretStore {
  readonly kind = 'file';
  private readonly values = new Map<SecretName, string>();

  get(name: SecretName): string | null {
    return this.values.get(name) ?? null;
  }

  set(name: SecretName, value: string): void {
    this.values.set(name, value);
  }

  delete(name: SecretName): void {
    this.values.delete(name);
  }
}

function keychainWorks(): boolean {
  try {
    // Read-only probe: throws when the platform has no usable keychain backend.
    new Entry(APP_NAME, 'probe').getPassword();
    return true;
  } catch {
    return false;
  }
}

/**
 * Uses the OS keychain when there is one, otherwise the restricted file.
 * `GAMEBACKLOG_SECRET_STORE=file` forces the file (used by the end-to-end tests).
 */
export function createSecretStore(dataDir: string, preference?: string): SecretStore {
  if (preference !== 'file' && keychainWorks()) return new KeychainSecretStore();
  return new FileSecretStore(dataDir);
}
