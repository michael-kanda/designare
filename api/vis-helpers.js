// api/vis-helpers.js
// Geteilte Helpers zwischen Check-Endpoint und Test-Runner
// (vermeidet zirkuläre Dependency)

import { signReportToken } from './signed-report.js';

export const REPORT_CACHE_TTL = 60 * 60 * 24 * 7;   // 7 Tage für E-Mail-Versand
export const PRIMARY_CACHE_TTL = 60 * 60 * 24;      // 24h für Frontend-Rendering

export const CRAWL_USER_AGENT =
  'Mozilla/5.0 (compatible; AIVisibilityCheck/2.0; +https://designare.at/ki-sichtbarkeit)';

export const EXCLUDED_DOMAINS = [
  'google', 'schema.org', 'openai', 'facebook.com', 'instagram.com', 'linkedin.com',
  'xing.com', 'twitter.com', 'x.com', 'youtube.com', 'wikipedia.org',
  'trustpilot.com', 'provenexpert.com', 'kununu.com', 'yelp.com', 'tripadvisor.com',
  'herold.at', 'gelbeseiten.de', 'wko.at', 'firmenabc.at', 'foursquare.com',
  'jameda.de', 'docfinder.at', 'anwalt.de', 'rechtsanwalt.com',
];

export const VALUABLE_SCHEMA_TYPES = new Set([
  'faqpage', 'howto', 'article', 'newsarticle', 'blogposting',
  'product', 'service', 'review', 'aggregaterating',
  'localbusiness', 'organization', 'person', 'breadcrumblist',
]);

// Token-Signierung mit Fallback falls Secret fehlt
export function safeSignToken(cacheKey) {
  try {
    return signReportToken(cacheKey);
  } catch (e) {
    console.warn(`⚠️ Token-Signierung fehlgeschlagen (${e.message}) — Report-Endpoint wird ablehnen.`);
    return null;
  }
}

// Erkennt "nicht gefunden"-Aussagen der KI
export function isNegativeResponse(text) {
  const lower = String(text).toLowerCase();
  const negativePatterns = [
    'keine informationen', 'keine ergebnisse', 'keine bewertungen',
    'nicht gefunden', 'nicht bekannt', 'nichts gefunden', 'nichts bekannt',
    'habe ich keine', 'liegen mir keine', 'sind mir keine',
    'konnte ich nicht finden', 'keine daten', 'keine treffer',
    'no information', 'not found', 'no results',
    'leider keine', 'dazu liegen keine', 'existiert nicht',
    'ist mir nicht bekannt', 'kann ich nicht bestätigen',
    'mir nicht bekannt', 'keine hinweise', 'keine erwähnungen',
    'keine relevanten', 'wurden keine', 'habe keine',
    'liegen keine informationen vor', 'nicht verifizieren',
  ];
  return negativePatterns.some(p => lower.includes(p));
}

// Competitor-Extraktion: bevorzugt Grounding-Metadaten, Regex als Fallback
export function extractCompetitors(groundingMetadata, fallbackText, ownDomainBase) {
  const domains = new Set();

  // 1. Primärquelle: Gemini Grounding-Metadaten (zuverlässige URLs)
  if (groundingMetadata?.groundingChunks?.length) {
    for (const chunk of groundingMetadata.groundingChunks) {
      const uri = chunk?.web?.uri || chunk?.retrievedContext?.uri || '';
      try {
        const host = new URL(uri).hostname.replace(/^www\./, '').toLowerCase();
        if (host) domains.add(host);
      } catch { /* ignore */ }
    }
  }

  // 2. Fallback / Ergänzung: Regex auf Text (für ChatGPT-Responses ohne Grounding)
  const regex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/gi;
  const matches = String(fallbackText || '').match(regex) || [];
  for (const m of matches) {
    const clean = m.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase().replace(/[.,;:!?)\]]+$/, '');
    if (clean) domains.add(clean);
  }

  return [...domains]
    .filter(c => (!ownDomainBase || !c.includes(ownDomainBase)))
    .filter(c => !EXCLUDED_DOMAINS.some(ex => c.includes(ex)))
    .slice(0, 8);
}
