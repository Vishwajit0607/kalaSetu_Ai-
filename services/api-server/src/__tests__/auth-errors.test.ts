import { describe, expect, it } from 'vitest';
import { AUTH_SPOKEN } from '../routes/auth.routes.js';
import { spokenFor } from '../i18n.js';

/**
 * Every account error is read aloud to someone who may not be able to read the
 * screen. A code with no sentence, or one that exists only in English, means
 * silence or the wrong language at exactly the moment they need help.
 */

describe('account error sentences', () => {
  const entries = Object.entries(AUTH_SPOKEN);

  it.each(entries)('%s has a real sentence in English and in Hindi', (_code, key) => {
    const en = spokenFor('en-IN')(key);
    const hi = spokenFor('hi-IN')(key);

    expect(en).not.toBe(key); // not the raw key, i.e. the string exists
    expect(hi).not.toBe(key);
    expect(en.length).toBeGreaterThan(10);
    expect(hi).not.toBe(en); // genuinely translated, not an English fallback
    expect(hi).toMatch(/[ऀ-ॿ]/); // contains Devanagari
  });

  it('covers every code the service can throw', () => {
    expect(Object.keys(AUTH_SPOKEN).sort()).toEqual(
      ['invalid_credentials', 'invalid_phone', 'invalid_token', 'phone_taken', 'same_password', 'upstream', 'weak_password', 'wrong_password'].sort(),
    );
  });

  it('has a spoken confirmation for a changed password', () => {
    expect(spokenFor('en-IN')('auth.passwordChanged')).toMatch(/changed/i);
    expect(spokenFor('hi-IN')('auth.passwordChanged')).toMatch(/[ऀ-ॿ]/);
  });
});
