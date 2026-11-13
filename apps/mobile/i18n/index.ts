import { useArtisanStore } from '@/store/useArtisanStore';
import { tFor, uiLanguageFor, type Translator } from './translate';
import type { StringKey, UiLanguage } from './strings';

/**
 * Screen-level translator, bound to the artisan's chosen language.
 *
 * Returns `lang` too, because almost every caller that needs a string also
 * needs the language code right after it - to pass to `speak()`, so the
 * spoken line and the line on screen are always the same language.
 *
 * `t` is referentially stable for a given language (see translate.ts), so it
 * is safe in dependency arrays.
 */
export function useT(): { t: Translator; lang: string; isEnglish: boolean } {
  const lang = useArtisanStore((state) => state.uiLanguage);
  return { t: tFor(lang), lang, isEnglish: lang === 'en-IN' };
}

export { tFor, uiLanguageFor };
export type { StringKey, UiLanguage, Translator };
