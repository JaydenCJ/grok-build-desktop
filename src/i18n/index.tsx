// Lightweight, dependency-free i18n layer.
//
// `en.ts` is the single source locale; keys are typed via `keyof typeof en`,
// so a missing or misspelled key is a compile error at the call site.
// Interpolation uses `{name}` placeholders. A React context/provider exists
// so a future locale switch can re-render the tree; today components bind the
// module-level `t` directly (single locale, zero overhead).
import { createContext, useContext, type ReactNode } from 'react';
import { en, type MessageKey } from './en';

export type { MessageKey } from './en';
export { en } from './en';

type Messages = Record<MessageKey, string>;
type Params = Record<string, string | number>;

const locales: Record<string, Messages> = { en };
let current: Messages = en;

/** Switch the active locale. Unknown names fall back to `en`. */
export function setLocale(name: string): void {
  current = locales[name] ?? en;
}

/**
 * Resolve `{name}` placeholders in a template. Placeholders without a
 * matching param are left intact so a missing param is visible, not silent.
 */
export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Translate a message key. Falls back to the `en` template, then to the key
 * itself, so a runtime-missing key (only possible via casts) never crashes.
 */
export function t(key: MessageKey, params?: Params): string {
  const template = current[key] ?? en[key] ?? key;
  return format(template, params);
}

interface I18nValue {
  locale: string;
  t: typeof t;
}

const I18nContext = createContext<I18nValue>({ locale: 'en', t });

/**
 * Provides the active locale to the tree. Wrap the app root; when more
 * locales exist, switching the `locale` prop re-renders consumers of
 * `useI18n()`.
 */
export function I18nProvider({
  locale = 'en',
  children,
}: {
  locale?: string;
  children: ReactNode;
}) {
  setLocale(locale);
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
