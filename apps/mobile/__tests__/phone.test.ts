import { isValidPassword, isValidPhone, normalizePhone } from '../services/phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['98765', '12345678901234', '1234567890', 'hello', ''])('rejects %p', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('agrees with the server on what a valid number is', () => {
    // Indian mobiles start 6-9. A landline-style or leading-5 number is not one.
    expect(isValidPhone('5876543210')).toBe(false);
    expect(isValidPhone('6876543210')).toBe(true);
  });
});

describe('isValidPassword', () => {
  it('requires six characters, matching the server', () => {
    expect(isValidPassword('12345')).toBe(false);
    expect(isValidPassword('123456')).toBe(true);
  });
});
