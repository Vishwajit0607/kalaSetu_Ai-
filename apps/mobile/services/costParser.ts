/**
 * Spoken cost entry parser.
 *
 * Lives outside the screen because this is the one place a mis-read turns
 * directly into an artisan underpricing their own work, so it is unit-tested
 * against real utterances rather than trusted.
 */

/** Devanagari digits and the spoken number words an artisan actually uses. */
const NUMBER_WORDS: Record<string, number> = {
  एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  बारह: 12, पंद्रह: 15, बीस: 20, पच्चीस: 25, तीस: 30, चालीस: 40, पचास: 50,
  सौ: 100, हज़ार: 1000, हजार: 1000,
};

/**
 * Pull a material cost and a labour-hours figure out of free speech.
 *
 * Exported for the test suite - this parser is the one place a mis-read turns
 * directly into the artisan underpricing their work, so it is unit-tested
 * against real utterances rather than trusted.
 */
export function parseSpokenCosts(transcript: string): {
  materialCostInr?: number;
  laborHours?: number;
} {
  const normalized = transcript
    .toLowerCase()
    .replace(/[०-९]/g, (digit) => String('०१२३४५६७८९'.indexOf(digit)));

  const result: { materialCostInr?: number; laborHours?: number } = {};

  // Hours: a number immediately before घंटे / ghante / hour(s).
  const hourMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:घंटे|घंटा|ghante|ghanta|hours?|hrs?)/,
  );
  if (hourMatch?.[1]) result.laborHours = Number(hourMatch[1]);

  // Cost: a number near रुपये / rupaye / rs, or the first large number.
  const costMatch = normalized.match(
    /(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(?:रुपये|रुपए|rupaye|rupees|rs\.?|₹)/,
  );
  if (costMatch?.[1]) {
    result.materialCostInr = Number(costMatch[1].replace(/,/g, ''));
  } else {
    // "₹400 ka kapda" - currency marker before the digits.
    const prefixed = normalized.match(/(?:₹|rs\.?)\s*(\d+(?:,\d{2,3})*)/);
    if (prefixed?.[1]) result.materialCostInr = Number(prefixed[1].replace(/,/g, ''));
  }

  // Spoken-word fallback: "चार सौ रुपये" -> 400.
  if (result.materialCostInr === undefined) {
    const words = normalized.split(/\s+/);
    for (let i = 0; i < words.length; i += 1) {
      const unit = words[i + 1];
      const base = NUMBER_WORDS[words[i] ?? ''];
      const multiplier = unit ? NUMBER_WORDS[unit] : undefined;
      if (base && multiplier && multiplier >= 100) {
        result.materialCostInr = base * multiplier;
        break;
      }
    }
  }

  if (result.laborHours === undefined) {
    const words = normalized.split(/\s+/);
    const hourIndex = words.findIndex((word) =>
      ['घंटे', 'घंटा', 'ghante', 'ghanta'].includes(word),
    );
    const spoken = hourIndex > 0 ? NUMBER_WORDS[words[hourIndex - 1] ?? ''] : undefined;
    if (spoken) result.laborHours = spoken;
  }

  return result;
}
