// §6.1 — the uniform wrapper around EVERY REST response.
// `description` is ALREADY localized server-side per X-Language — safe to show to the user.
export type ApiStatus = 'success' | 'error' | (string & {});

export interface ApiResponse<T> {
  status: ApiStatus;
  code: number; // HTTP-ish code
  description: string; // localized
  data: T | null;
}

// §7.1 supported X-Language codes (+ client-only `tk`), with the documented
// server-side fallback mapping for unsupported/extended locales.
export const SUPPORTED_LANGUAGES = ['ru', 'uz', 'oz', 'en', 'tr', 'zh', 'kk', 'tg', 'ky', 'tk'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_FALLBACK: Record<string, SupportedLanguage> = {
  kk: 'ru',
  ky: 'ru',
  tk: 'ru',
  tg: 'ru',
  lv: 'en',
  lt: 'en',
  et: 'en',
  pl: 'en',
  de: 'en',
};

/** Resolve any incoming X-Language / ?language= value to a supported code (§7.1 fallback map). */
export function resolveLanguage(raw: string | null | undefined, fallback: SupportedLanguage = 'ru'): SupportedLanguage {
  if (!raw) return fallback;
  const code = raw.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(code)) return code as SupportedLanguage;
  return LANGUAGE_FALLBACK[code] ?? fallback;
}
