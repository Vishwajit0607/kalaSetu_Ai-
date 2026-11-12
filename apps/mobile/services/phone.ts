/**
 * Indian mobile number handling, mirrored from the server's `normalizePhone`.
 *
 * The server is authoritative; this exists so the form can say "that is not a
 * valid number" the instant the artisan stops typing, instead of after a
 * network round trip on a slow link.
 */

/** Returns +91XXXXXXXXXX, or null if this is not a valid Indian mobile number. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  let national: string;

  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  else return null;

  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

export const MIN_PASSWORD_LENGTH = 6;

export function isValidPassword(input: string): boolean {
  return input.length >= MIN_PASSWORD_LENGTH;
}
