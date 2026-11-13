import { MAX_PASSWORD_LENGTH, passwordStrength, validatePasswordForm } from '../services/password';

describe('passwordStrength', () => {
  it('says nothing for an empty box', () => {
    expect(passwordStrength('')).toEqual({ level: 'empty', score: 0, hints: [] });
  });

  it.each([
    ['abc', 'weak'], // too short
    ['abcdef', 'weak'], // long enough to be allowed, but no variety
    ['abcdef12', 'fair'], // letters and digits
    ['abcdefgh12', 'strong'], // 10+ characters and a mix
    ['Abcdef12', 'strong'], // mixed case and digits
    ['abcdef!', 'fair'], // a symbol is variety
    ['पासवर्ड12', 'fair'], // a Hindi password counts: Devanagari letters plus digits
  ])('rates %j as %s', (password, level) => {
    expect(passwordStrength(password).level).toBe(level);
  });

  it.each(['123456', 'password', 'QWERTY', '111111', 'aaaaaaaa', '000000000'])('rates the common or repeated %j as weak, with a specific hint', (password) => {
    const result = passwordStrength(password);
    expect(result.level).toBe('weak');
    expect(result.hints).toEqual(['password.hint.common']);
  });

  it('suggests what would help, and only what is missing', () => {
    expect(passwordStrength('abcdef').hints).toEqual(['password.hint.longer', 'password.hint.mix']);
    expect(passwordStrength('abcdefghij').hints).toEqual(['password.hint.mix']);
    expect(passwordStrength('abcdef12').hints).toEqual(['password.hint.longer']);
    expect(passwordStrength('abcdefgh12').hints).toEqual([]);
  });

  it('scores higher for stronger passwords, never above 4', () => {
    expect(passwordStrength('abcdef').score).toBeLessThan(passwordStrength('Abcdefgh12!').score);
    expect(passwordStrength('Abcdefgh12!').score).toBeLessThanOrEqual(4);
  });
});

describe('validatePasswordForm', () => {
  const ok = { current: 'old-pass-1', next: 'new-pass-2', confirm: 'new-pass-2' };

  it('accepts a valid change', () => {
    expect(validatePasswordForm(ok)).toEqual({ ok: true });
  });

  it('requires the current password', () => {
    expect(validatePasswordForm({ ...ok, current: '' })).toEqual({ ok: false, errors: { current: 'password.err.current' } });
  });

  it('rejects a new password shorter than 6, and says nothing about the confirmation yet', () => {
    expect(validatePasswordForm({ ...ok, next: 'abc', confirm: 'different' })).toEqual({ ok: false, errors: { next: 'password.err.short' } });
  });

  it('accepts exactly 6 and exactly 72 characters, and rejects 73', () => {
    expect(validatePasswordForm({ ...ok, next: 'a'.repeat(6), confirm: 'a'.repeat(6) }).ok).toBe(true);
    expect(validatePasswordForm({ ...ok, next: 'a'.repeat(MAX_PASSWORD_LENGTH), confirm: 'a'.repeat(MAX_PASSWORD_LENGTH) }).ok).toBe(true);
    expect(validatePasswordForm({ ...ok, next: 'a'.repeat(MAX_PASSWORD_LENGTH + 1), confirm: 'a'.repeat(MAX_PASSWORD_LENGTH + 1) })).toEqual({
      ok: false,
      errors: { next: 'password.err.long' },
    });
  });

  it('rejects a new password the same as the current one', () => {
    expect(validatePasswordForm({ current: 'same-pass', next: 'same-pass', confirm: 'same-pass' })).toEqual({
      ok: false,
      errors: { next: 'password.err.same' },
    });
  });

  it('rejects a confirmation that does not match', () => {
    expect(validatePasswordForm({ ...ok, confirm: 'new-pass-3' })).toEqual({ ok: false, errors: { confirm: 'password.err.mismatch' } });
  });

  it('reports the current-password problem together with a new-password problem', () => {
    expect(validatePasswordForm({ current: '', next: 'abc', confirm: '' })).toEqual({
      ok: false,
      errors: { current: 'password.err.current', next: 'password.err.short' },
    });
  });
});
