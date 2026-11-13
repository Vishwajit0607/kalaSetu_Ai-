import { parseSpokenCosts } from '../services/costParser';

/**
 * These are the utterances Saaras V4 actually returns for artisans speaking
 * costs aloud - mixed script, mixed numerals, no punctuation.
 */
describe('parseSpokenCosts', () => {
  it('reads Latin digits with रुपये and घंटे', () => {
    expect(parseSpokenCosts('400 रुपये का कपड़ा और 6 घंटे की मेहनत')).toEqual({
      materialCostInr: 400,
      laborHours: 6,
    });
  });

  it('reads romanised Hindi (code-mixed)', () => {
    expect(parseSpokenCosts('1200 rupaye ka raw material, 18 ghante laga')).toEqual({
      materialCostInr: 1200,
      laborHours: 18,
    });
  });

  it('reads Devanagari numerals', () => {
    expect(parseSpokenCosts('८०० रुपये और ४ घंटे')).toEqual({
      materialCostInr: 800,
      laborHours: 4,
    });
  });

  it('reads spoken number words like "चार सौ"', () => {
    const result = parseSpokenCosts('चार सौ रुपये का सामान, छह घंटे');
    expect(result.materialCostInr).toBe(400);
    expect(result.laborHours).toBe(6);
  });

  it('handles a rupee symbol before the digits', () => {
    expect(parseSpokenCosts('₹2,500 ka silk thread liya').materialCostInr).toBe(2500);
  });

  it('accepts fractional hours', () => {
    expect(parseSpokenCosts('500 rupees material and 2.5 hours work').laborHours).toBe(2.5);
  });

  it('returns an empty object when nothing numeric was said', () => {
    expect(parseSpokenCosts('बहुत अच्छा कपड़ा है')).toEqual({});
  });

  it('reads just one field when only one was spoken', () => {
    expect(parseSpokenCosts('सिर्फ आठ घंटे लगे')).toEqual({ laborHours: 8 });
  });

  it('does not mistake the hours figure for the material cost', () => {
    const result = parseSpokenCosts('6 घंटे लगे');
    expect(result.materialCostInr).toBeUndefined();
    expect(result.laborHours).toBe(6);
  });
});
