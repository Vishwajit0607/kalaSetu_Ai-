import { STRINGS, type StringKey, type UiLanguage } from './strings';

/**
 * Pure translation lookup - no React, no store, no network.
 *
 * Kept separate from `i18n/index.ts` (which has the `useT` hook and imports
 * the store) so that low-level modules like the API client can translate
 * without importing the store, which would close an import cycle:
 * store -> speech -> apiClient -> store.
 */

export type Translator = (key: StringKey, vars?: Record<string, string | number>) => string;

/** Two languages: `en-IN` gets English, everything else gets Hindi. */
export function uiLanguageFor(languageCode: string | undefined): UiLanguage {
  return languageCode === 'en-IN' ? 'en' : 'hi';
}

/** Substitute {placeholders}. Missing values collapse to an empty string. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    vars[key] === undefined ? '' : String(vars[key]),
  );
}

/**
 * One translator per language, created once and reused.
 *
 * This is deliberate and load-bearing. `tFor` used to build a fresh closure on
 * every call, and `useT()` calls it on every render - so `t` was a brand-new
 * function each time. Four screens listed `t` in a `useEffect` dependency
 * array alongside a `speak()` call, which meant the effect re-ran, and the
 * prompt was spoken again, on *every re-render*: the profile screen re-spoke
 * its question on each keystroke, and the studio and voice screens re-spoke
 * whenever any state changed. A stable identity per language fixes the whole
 * class of bug at the source instead of at each call site.
 */
const translators = new Map<UiLanguage, Translator>();

export function tFor(languageCode: string | undefined): Translator {
  const language = uiLanguageFor(languageCode);
  let translator = translators.get(language);
  if (!translator) {
    const dict = STRINGS[language];
    translator = (key, vars) => interpolate(dict[key] ?? STRINGS.en[key] ?? key, vars);
    translators.set(language, translator);
  }
  return translator;
}
