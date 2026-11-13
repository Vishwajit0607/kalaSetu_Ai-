/**
 * Spoken strings the server sends back to be read aloud.
 *
 * These are not UI chrome - they are what Bulbul TTS actually speaks into an
 * artisan's ear, so they are phrased for listening. Same policy as the mobile
 * dictionary: real `en` and `hi`, everything else falls back to Hindi rather
 * than being machine-translated unreviewed.
 */

const SPOKEN = {
  en: {
    'err.validation': 'Some details are missing. Please try again.',
    'err.upstreamDown':
      'The connection is slow. Your work is saved and will finish by itself later.',
    'err.upstreamRejected': 'That could not be completed. Please try once more.',
    'err.server': 'Something went wrong. Please try again in a moment.',
    'err.request': 'That could not be completed. Please try again.',
    'err.notFound': 'That feature is not available.',
    'err.unauthorized': 'Please log in again.',
    'auth.invalidCredentials': 'Wrong phone number or password. Please try again.',
    'auth.phoneTaken': 'This phone number already has an account. Please log in.',
    'auth.invalidPhone': 'Please enter a valid 10-digit mobile number.',
    'auth.weakPassword': 'Your password must be at least 6 characters.',
    'auth.sessionExpired': 'Your session has ended. Please log in again.',
    'auth.accountDeleted': 'Your account has been deleted.',
    'auth.wrongPassword': 'Your current password is not correct. Please try again.',
    'auth.samePassword': 'Please choose a new password that is different from the old one.',
    'auth.passwordChanged': 'Your password has been changed.',

    'stock.whichItem': 'Which item was sold? Please say it again.',
    'stock.reduced': 'Reduced {qty} {title}. {left} left now.',
    'stock.reducedLow': 'Reduced {qty} {title}. Only {left} left now, please make more.',
    'stock.lowAlert': 'Please note. {count} items are running low. {items}.',
    'stock.lowAlertItem': '{title} has {count} left',

    'price.material': 'Material cost {amount} rupees.',
    'price.labour': 'Your labour {amount} rupees.',
    'price.packaging': 'Packaging {amount} rupees.',
    'price.total': 'Total cost came to {amount} rupees.',
    'price.wholesale': 'Sell wholesale at {amount} rupees,',
    'price.retail': 'and direct to customers at {amount} rupees.',
    'price.profit': 'That gives you {amount} rupees profit on every piece.',

    'catalog.offlineRationale': 'The price will be checked again when you are online.',
    'catalog.draftTitle': 'Draft product',
  },
  hi: {
    'err.validation': 'कुछ जानकारी अधूरी है। दोबारा कोशिश कीजिए।',
    'err.upstreamDown': 'इंटरनेट धीमा है। आपका काम सेव हो गया है, बाद में अपने आप पूरा हो जाएगा।',
    'err.upstreamRejected': 'यह काम पूरा नहीं हो सका। एक बार दोबारा कोशिश कीजिए।',
    'err.server': 'कुछ गड़बड़ हुई। थोड़ी देर में दोबारा कोशिश कीजिए।',
    'err.request': 'यह काम पूरा नहीं हो सका। दोबारा कोशिश कीजिए।',
    'err.notFound': 'यह सुविधा उपलब्ध नहीं है।',
    'err.unauthorized': 'कृपया दोबारा लॉग इन कीजिए।',
    'auth.invalidCredentials': 'फ़ोन नंबर या पासवर्ड गलत है। दोबारा कोशिश कीजिए।',
    'auth.phoneTaken': 'इस फ़ोन नंबर से खाता पहले से है। कृपया लॉग इन कीजिए।',
    'auth.invalidPhone': 'कृपया 10 अंकों का सही मोबाइल नंबर लिखिए।',
    'auth.weakPassword': 'पासवर्ड कम से कम 6 अक्षर का होना चाहिए।',
    'auth.sessionExpired': 'आपका सत्र खत्म हो गया है। कृपया दोबारा लॉग इन कीजिए।',
    'auth.accountDeleted': 'आपका खाता हटा दिया गया है।',
    'auth.wrongPassword': 'आपका मौजूदा पासवर्ड सही नहीं है। दोबारा कोशिश कीजिए।',
    'auth.samePassword': 'कृपया ऐसा नया पासवर्ड चुनिए जो पुराने से अलग हो।',
    'auth.passwordChanged': 'आपका पासवर्ड बदल दिया गया है।',

    'stock.whichItem': 'कौन सा सामान बिका, दोबारा बोलिए।',
    'stock.reduced': '{qty} {title} कम कर दिया। अब {left} बचे हैं।',
    'stock.reducedLow': '{qty} {title} कम कर दिया। अब सिर्फ {left} बचे हैं, और बनाइए।',
    'stock.lowAlert': 'ध्यान दीजिए। {count} सामान खत्म होने वाले हैं। {items}।',
    'stock.lowAlertItem': '{title} के {count} बचे',

    'price.material': 'सामान की लागत {amount} रुपये।',
    'price.labour': 'आपकी मेहनत {amount} रुपये।',
    'price.packaging': 'पैकिंग {amount} रुपये।',
    'price.total': 'कुल लागत {amount} रुपये हुई।',
    'price.wholesale': 'थोक में बेचने पर {amount} रुपये लीजिए,',
    'price.retail': 'और सीधे ग्राहक को {amount} रुपये में बेचिए।',
    'price.profit': 'इससे आपको हर पीस पर {amount} रुपये का फायदा होगा।',

    'catalog.offlineRationale': 'इंटरनेट आने पर कीमत दोबारा जाँची जाएगी।',
    'catalog.draftTitle': 'ड्राफ्ट उत्पाद',
  },
} as const;

export type SpokenKey = keyof (typeof SPOKEN)['en'];

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_m, key: string) =>
    vars[key] === undefined ? '' : String(vars[key]),
  );
}

export function spokenFor(
  languageCode: string | undefined,
): (key: SpokenKey, vars?: Record<string, string | number>) => string {
  const dict = languageCode === 'en-IN' ? SPOKEN.en : SPOKEN.hi;
  return (key, vars) => interpolate(dict[key] ?? SPOKEN.en[key] ?? key, vars);
}

/**
 * Human-readable language name, for telling an LLM which language to write
 * its rationale in.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  'hi-IN': 'Hindi (Devanagari script)',
  'en-IN': 'English',
};

export function languageName(code: string | undefined): string {
  return LANGUAGE_NAMES[code ?? 'hi-IN'] ?? 'Hindi (Devanagari script)';
}
