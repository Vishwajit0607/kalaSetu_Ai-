import type { StringKey } from '@/i18n';
import { MIN_PASSWORD_LENGTH } from './phone';

/**
 * Password rules for the account screens, kept pure so the boundaries are tested.
 *
 * The server is the authority (6 to 72 characters, and a new password must differ
 * from the current one); this mirrors it so the form can say what is wrong before a
 * round trip on a slow connection, and adds a strength hint, which is advice and
 * never a rule - a 6-character password is allowed because artisans choose
 * passwords they must remember and type on a phone, not that they are forced to.
 */

export const MAX_PASSWORD_LENGTH = 72;

export type StrengthLevel = 'empty' | 'weak' | 'fair' | 'strong';

export interface Strength {
  level: StrengthLevel;
  /** 0-4, for drawing a meter. */
  score: number;
  hints: StringKey[];
}

const COMMON = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000', '123123',
  'password', 'password1', 'qwerty', 'abc123', 'iloveyou', 'admin', 'welcome',
]);

const LETTER = /[A-Za-zऀ-ॿ]/; // Latin or Devanagari
const DIGIT = /\d/;

export function passwordStrength(password: string): Strength {
  if (password.length === 0) return { level: 'empty', score: 0, hints: [] };

  // The weakest passwords are weak whatever else is true of them.
  if (COMMON.has(password.toLowerCase()) || /^(.)\1+$/u.test(password)) {
    return { level: 'weak', score: 1, hints: ['password.hint.common'] };
  }

  const hasMix = LETTER.test(password) && DIGIT.test(password);
  const hasCaseOrSymbol =
    (/[a-z]/.test(password) && /[A-Z]/.test(password)) || /[^A-Za-z0-9ऀ-ॿ\s]/.test(password);

  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 10) score += 1;
  if (hasMix) score += 1;
  if (hasCaseOrSymbol) score += 1;

  const hints: StringKey[] = [];
  if (password.length < 10) hints.push('password.hint.longer');
  if (!hasMix) hints.push('password.hint.mix');

  return { level: score <= 1 ? 'weak' : score === 2 ? 'fair' : 'strong', score, hints };
}

export const STRENGTH_LABEL: Record<Exclude<StrengthLevel, 'empty'>, StringKey> = {
  weak: 'password.strength.weak',
  fair: 'password.strength.fair',
  strong: 'password.strength.strong',
};

export type PasswordFormError =
  | 'password.err.current'
  | 'password.err.short'
  | 'password.err.long'
  | 'password.err.same'
  | 'password.err.mismatch';

export interface PasswordFormInput {
  current: string;
  next: string;
  confirm: string;
}

export type PasswordFormResult =
  | { ok: true }
  | { ok: false; errors: Partial<Record<'current' | 'next' | 'confirm', PasswordFormError>> };

/** Everything wrong with the change-password form, all at once. */
export function validatePasswordForm({ current, next, confirm }: PasswordFormInput): PasswordFormResult {
  const errors: Partial<Record<'current' | 'next' | 'confirm', PasswordFormError>> = {};

  if (current.length === 0) errors.current = 'password.err.current';

  if (next.length < MIN_PASSWORD_LENGTH) errors.next = 'password.err.short';
  else if (next.length > MAX_PASSWORD_LENGTH) errors.next = 'password.err.long';
  else if (next === current) errors.next = 'password.err.same';

  // Only worth complaining about once there is a valid new password to compare with.
  if (!errors.next && confirm !== next) errors.confirm = 'password.err.mismatch';

  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}
