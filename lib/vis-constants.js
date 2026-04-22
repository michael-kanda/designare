// lib/vis-constants.js - Zentrale Konstanten für den KI-Sichtbarkeits-Check
// Alle geteilten Patterns an EINER Stelle → keine Divergenz mehr

// =================================================================
// CACHE VERSION — bei Code-Änderungen hochzählen!
// Alte Cache-Einträge mit anderer Version werden ignoriert.
// =================================================================
export const CACHE_VERSION = 'v4';

// =================================================================
// NOT-FOUND PATTERNS
// Verwendet in: domain-detection.js, sentiment.js
// =================================================================
export const NOT_FOUND_PATTERNS = {
  // Allgemein (alle Test-Typen)
  general: [
    'keine informationen gefunden',
    'habe ich keine informationen',
    'keine daten verfügbar',
    'kann ich keine angaben',
    'mir nicht bekannt',
    'wurden keine informationen',
    'no information found',
    'i don\'t have information',
    'nicht gefunden',
  ],
  
  // Reviews-spezifisch
  reviews: [
    'keine bewertungen gefunden',
    'keine online-bewertungen',
    'keine rezensionen gefunden',
    'keine bewertungen',
    'keine rezensionen',
    'wurden keine bewertungen',
    'wurden keine online-bewertungen',
    'keine bewertungen auf',
  ],
  
  // Mentions-spezifisch
  mentions: [
    'keine externen erwähnungen',
    'keine erwähnungen gefunden',
    'wurden keine erwähnungen',
    'keine externen erwähnungen auf anderen',
  ],
};

// Helper: Alle notFound-Patterns für einen bestimmten Test-Typ
export function getNotFoundPatterns(testType) {
  const patterns = [...NOT_FOUND_PATTERNS.general];
  if (testType && NOT_FOUND_PATTERNS[testType]) {
    patterns.push(...NOT_FOUND_PATTERNS[testType]);
  }
  return patterns;
}

// =================================================================
// NEGATION PATTERNS
// Verwendet in: domain-detection.js (isNegationContext)
// =================================================================
export const NEGATION_PATTERNS = {
  // Definitiv: IMMER eine harte Negation (kein Substanz-Check)
  definitive: [
    'keine bewertungen gefunden',
    'keine rezensionen gefunden',
    'keine erwähnungen gefunden',
    'beziehen sich jedoch nicht auf',
  ],
  
  // Test-spezifisch: nur im passenden Kontext, MIT Substanz-Check
  testSpecific: {
    reviews: [
      'keine online-bewertungen',
      'keine bewertungen auf',
      'wurden keine bewertungen',
      'wurden keine online-bewertungen',
    ],
    mentions: [
      'keine externen erwähnungen',
      'wurden keine erwähnungen',
      'keine externen erwähnungen auf anderen',
    ],
    knowledge: [],
  },
  
  // Allgemein: immer geprüft, immer mit Substanz-Check
  general: [
    'keine informationen',
    'nicht bekannt',
    'nichts bekannt',
    'keine daten',
    'keine kenntnis',
    'nicht gefunden',
    'keine ergebnisse',
    'mir nicht bekannt',
    'habe ich keine',
    'kann ich keine',
    'wurden keine informationen',
    'no information',
    'not familiar',
  ],
};

// =================================================================
// SUBSTANZ-KEYWORDS
// Verwendet in: domain-detection.js (checkSubstanceForTestType, isSubstantialBusinessResponse)
// =================================================================
export const SUBSTANCE_KEYWORDS = {
  // Basis-Keywords (für alle Test-Typen)
  base: [
    'bietet', 'dienstleistung', 'unternehmen', 'spezialisiert',
    'tätig', 'anbieter', 'standort', 'gelistet', 'profil',
    'gegründet', 'gmbh', 'agentur', 'service', 'branche',
  ],
  
  // Erweitert für knowledge (isSubstantialBusinessResponse)
  knowledge: [
    'bietet', 'anbieter', 'dienstleistung', 'produkt', 'unternehmen',
    'firma', 'standort', 'spezialisiert', 'tätig', 'gegründet', 'gmbh',
    'agentur', 'vermittlung', 'betreuung', 'service', 'branche',
    'mitarbeiter', 'geschäftsführ', 'inhaber', 'sitz in', 'ansässig',
  ],
  
  // Reviews
  reviews: [
    'bewertung', 'rezension', 'sterne', 'stars', 'rating', 'review',
    'google reviews', 'trustpilot', 'provenexpert', 'kununu',
    'zufrieden', 'empfehlen', 'erfahrung', 'kundenmeinung',
    'positiv', 'von 5', 'durchschnitt', 'feedback',
  ],
  
  // Mentions
  mentions: [
    'herold', 'wko', 'gelbe seiten', 'firmenabc', 'branchenverzeichnis',
    'facebook', 'instagram', 'linkedin', 'xing', 'erwähnt', 'gelistet',
    'verzeichnis', 'profil', 'eintrag', 'social media', 'verlinkt',
  ],
};

// Helper: Keywords für Substanz-Check (base + testType-spezifisch)
export function getSubstanceKeywords(testType) {
  const base = [...SUBSTANCE_KEYWORDS.base];
  if (testType && SUBSTANCE_KEYWORDS[testType]) {
    // Merge und deduplizieren
    return [...new Set([...base, ...SUBSTANCE_KEYWORDS[testType]])];
  }
  return base;
}

// =================================================================
// SENTIMENT FALLBACK KEYWORDS
// Verwendet in: sentiment.js
// =================================================================
export const SENTIMENT_KEYWORDS = {
  notFound: [
    'keine informationen', 'nicht gefunden', 'keine ergebnisse',
    'nicht bekannt', 'konnte ich keine', 'wurden keine',
    'nichts gefunden', 'nicht zu finden', 'keine daten', 'nicht auffindbar',
  ],
  
  substantialInfo: [
    'bietet', 'anbieter', 'dienstleistung', 'produkt',
    'unternehmen', 'firma', 'standort', 'spezialisiert',
    'tätig', 'gegründet', 'seit', 'agentur', 'service',
  ],
  
  positiveReviewWords: [
    'zufrieden', 'empfehlen', 'positiv', 'sehr gut', 'hervorragend', 'ausgezeichnet',
  ],
  
  reviewNegation: [
    'keine bewertungen', 'keine rezensionen', 'keine online-bewertungen',
    'wurden keine bewertungen', 'keine bewertungen gefunden', 'keine rezensionen gefunden',
  ],
  
  mentionSources: [
    'herold', 'wko', 'gelbe seiten', 'facebook', 'instagram', 'linkedin',
    'twitter', 'xing', 'trustpilot', 'provenexpert', 'branchenverzeichnis',
    'artikel', 'blog', 'presse', 'erwähnung', 'youtube', 'firmenabc',
    'meinanwalt', 'anwalt.de', 'kununu', 'yelp',
  ],
};

// =================================================================
// GENERISCHE WÖRTER (für Domain-Proximity-Check)
// Verwendet in: domain-detection.js
// =================================================================
export const GENERIC_DOMAIN_WORDS = new Set([
  // Branchen & Berufe
  'auto', 'hotel', 'shop', 'design', 'digital', 'online', 'service',
  'agentur', 'group', 'media', 'consulting', 'tech', 'studio', 'team',
  'partner', 'expert', 'profi', 'center', 'haus', 'werk', 'plus',
  'best', 'first', 'smart', 'easy', 'global', 'premium', 'prime',
  'rechtsanwalt', 'steuerberater', 'immobilien', 'versicherung',
  'marketing', 'software', 'development', 'solutions', 'systems',
  'handwerk', 'elektro', 'transport', 'logistik', 'bauer', 'garten',
  'restaurant', 'gastro', 'sport', 'fitness', 'beauty', 'dental',
  // Orte (DACH)
  'wien', 'graz', 'linz', 'salzburg', 'innsbruck', 'bregenz', 'klagenfurt',
  'berlin', 'hamburg', 'münchen', 'muenchen', 'frankfurt', 'köln', 'koeln',
  'stuttgart', 'düsseldorf', 'duesseldorf', 'dortmund', 'essen', 'leipzig',
  'zürich', 'zuerich', 'bern', 'basel', 'genf',
  'austria', 'österreich', 'oesterreich', 'deutschland', 'germany', 'schweiz',
  // Generische Begriffe
  'info', 'data', 'home', 'page', 'site', 'mail', 'news', 'blog',
  'book', 'deal', 'sale', 'fair', 'pure', 'real', 'true', 'good',
  'north', 'south', 'east', 'west', 'city', 'land', 'park',
]);

// =================================================================
// SCORE GEWICHTUNG
// Verwendet in: ai-visibility-check.js (Phase 3)
// =================================================================
export const SCORE_WEIGHTS = {
  withChatGPT: {
    gemini: 35,
    chatgpt: 35,
    tech: 15,
    reputation: 15,
  },
  withoutChatGPT: {
    gemini: 54,
    chatgpt: 0,
    tech: 23,
    reputation: 23,
  },
  // Gewichtung innerhalb jeder Engine
  testWeights: {
    knowledge: 0.60,
    reviews: 0.15,
    mentions: 0.25,
  },
};

// =================================================================
// PLATTFORM-NAMEN (für extractCompanyName — zum Überspringen)
// =================================================================
export const PLATFORM_NAMES = new Set([
  'google', 'trustpilot', 'provenexpert', 'herold', 'wko',
  'kununu', 'facebook', 'linkedin', 'instagram', 'twitter',
  'xing', 'yelp', 'firmenabc', 'gelbe seiten',
]);
