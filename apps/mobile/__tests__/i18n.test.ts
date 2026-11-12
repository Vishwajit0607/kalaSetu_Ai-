import { STRINGS } from '../i18n/strings';
import { tFor, uiLanguageFor } from '../i18n/translate';

describe('translator identity', () => {
  it('returns the SAME function for the same language', () => {
    // Regression: `tFor` built a new closure per call, `useT()` called it on
    // every render, and four screens had `t` in a useEffect dependency list next
    // to a speak() call - so spoken prompts re-fired on every re-render (the
    // profile screen re-spoke its question on each keystroke).
    expect(tFor('en-IN')).toBe(tFor('en-IN'));
    expect(tFor('hi-IN')).toBe(tFor('hi-IN'));
  });

  it('treats unknown and undefined languages as Hindi, one shared translator', () => {
    expect(tFor(undefined)).toBe(tFor('hi-IN'));
    expect(tFor('ta-IN')).toBe(tFor('hi-IN'));
  });

  it('keeps the two languages distinct', () => {
    expect(tFor('en-IN')).not.toBe(tFor('hi-IN'));
  });
});

describe('translation', () => {
  it('maps en-IN to English and everything else to Hindi', () => {
    expect(uiLanguageFor('en-IN')).toBe('en');
    expect(uiLanguageFor('hi-IN')).toBe('hi');
    expect(uiLanguageFor(undefined)).toBe('hi');
  });

  it('substitutes placeholders', () => {
    expect(tFor('en-IN')('home.greetingSome', { name: 'Ramesh', count: 4 })).toBe(
      'Ramesh, welcome. You have 4 products on sale.',
    );
  });

  it('collapses a missing placeholder instead of printing "undefined"', () => {
    expect(tFor('en-IN')('profile.gotName', {})).not.toMatch(/undefined|\{name\}/);
  });

  it('speaks truthful offline and timeout messages, never "saved on the phone"', () => {
    for (const lang of ['en-IN', 'hi-IN']) {
      const t = tFor(lang);
      expect(t('err.offline')).not.toMatch(/saved|सेव/i);
      expect(t('err.timeout').length).toBeGreaterThan(0);
    }
  });
});

describe('dictionary parity', () => {
  const en = Object.keys(STRINGS.en).sort();
  const hi = Object.keys(STRINGS.hi).sort();

  it('Hindi has every English key and no extras', () => {
    expect(hi).toEqual(en);
  });

  it('no Hindi value is empty', () => {
    for (const [key, value] of Object.entries(STRINGS.hi)) {
      expect({ key, empty: value.trim() === '' }).toEqual({ key, empty: false });
    }
  });

  it('every placeholder in English also appears in Hindi', () => {
    const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of en as Array<keyof typeof STRINGS.en>) {
      expect({ key, p: placeholders(STRINGS.hi[key]) }).toEqual({ key, p: placeholders(STRINGS.en[key]) });
    }
  });

  it('no claim of 22 languages remains - the product supports two', () => {
    expect(JSON.stringify(STRINGS)).not.toMatch(/22/);
  });
});
