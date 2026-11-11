import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en.ts';
import { ptBR } from './pt-BR.ts';

/**
 * Small typed i18n: nested dictionaries, `{name}` placeholders and `_one` / `_other` plurals.
 * Portuguese (Brazil) is the default; every other locale must match its shape.
 */

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof ptBR>;

type Leaves<T, Prefix extends string = ''> = T extends string
  ? Prefix
  : {
      [K in keyof T & string]: Leaves<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>;
    }[keyof T & string];

export type MessageKey = Leaves<typeof ptBR>;
/** Keys that exist as `<key>_one` and `<key>_other`. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}_one`
    ? Base
    : never
  : never;

export const LOCALES = ['pt-BR', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
};

const DICTIONARIES: Record<Locale, Messages> = { 'pt-BR': ptBR, en };
const STORAGE_KEY = 'gamebacklog.locale';

type Vars = Record<string, string | number>;

function lookup(messages: Messages, key: string): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural form for `count`, which is also available as `{count}`. */
  tn: (key: PluralKey, count: number, vars?: Vars) => string;
  formatDate: (iso: string) => string;
  formatDateTime: (iso: string) => string;
  formatNumber: (value: number, fractionDigits?: number) => string;
  /** "9h 10min", "9h" or "45min". */
  formatMinutes: (minutes: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return 'pt-BR';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies to this session.
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const messages = DICTIONARIES[locale];
    const plural = new Intl.PluralRules(locale);
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'short' });
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
    const t = (key: MessageKey, vars?: Vars) => interpolate(lookup(messages, key), vars);

    return {
      locale,
      setLocale,
      t,
      tn: (key, count, vars) => {
        // Zero reads as a plural in both languages ("0 jogos"), whatever the plural rules say.
        const form = count !== 0 && plural.select(count) === 'one' ? 'one' : 'other';
        return interpolate(lookup(messages, `${key}_${form}`), { count, ...vars });
      },
      // A date-only string is a calendar date: show it as written, not shifted by the time zone.
      formatDate: (iso) =>
        date.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso)),
      formatDateTime: (iso) => dateTime.format(new Date(iso)),
      formatNumber: (value, fractionDigits = 1) =>
        new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits }).format(value),
      formatMinutes: (total) => {
        const hours = Math.floor(total / 60);
        const minutes = Math.round(total % 60);
        if (hours === 0) return t('time.minutes', { minutes });
        if (minutes === 0) return t('time.hours', { hours });
        return t('time.hoursMinutes', { hours, minutes });
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
