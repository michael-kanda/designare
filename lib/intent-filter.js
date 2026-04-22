// lib/intent-filter.js - Intent-Klassifikation VOR dem RAG-Lookup
// Spart Embedding-Kosten + Latenz bei Smalltalk, Grüße, Wetter etc.
// Verbessert gleichzeitig die Antwortqualität: Kein irrelevanter RAG-Kontext bei "Hey!"

// ===================================================================
// INTENT-KATEGORIEN
// ===================================================================
// 'rag'       → Braucht RAG-Kontext (Fachfragen, Website-Fragen)
// 'smalltalk' → Kein RAG nötig (Plauderei, Witze, Alltag)
// 'greeting'  → Begrüßung / Verabschiedung
// 'weather'   → Wetter-Frage (wird via Tool beantwortet)
// 'booking'   → Termin-Intent (Tool-basiert)
// 'email'     → E-Mail-Intent (Tool-basiert)
// 'roast'     → Website-Roast (Tool-basiert, URL erkannt)
// 'meta'      → Fragen über Evita selbst / den Chatbot
// 'news'      → News-Anfragen (hat eigenen Kontext)

// ===================================================================
// GLOBALE NACHRICHT-NORMALISIERUNG
// Korrigiert Typos + Synonyme BEVOR Pattern-Matching greift.
// So müssen Regex-Patterns nicht jeden Tippfehler kennen.
// ===================================================================

// Synonym-Map: Variante → kanonische Form (lowercase)
// Neue Synonyme/Typos einfach hier eintragen – fertig.
const SYNONYM_MAP = {
  // Script-Varianten
  'sript': 'script', 'skript': 'script', 'scirpt': 'script', 'scrip': 'script',
  'srcript': 'script', 'skrip': 'script', 'scripte': 'scripts',
  // SEO-Varianten
  'suchmaschinenoptimierung': 'seo', 'search engine optimization': 'seo',
  // Performance-Varianten
  'ladezeit': 'performance', 'page speed': 'pagespeed', 'pagspeed': 'pagespeed',
  'ladegeschwindigkeit': 'pagespeed',
  // Plugin-Varianten
  'pluggin': 'plugin', 'plug-in': 'plugin', 'pluginn': 'plugin', 'pluign': 'plugin',
  // Website-Varianten
  'webseite': 'website', 'web-seite': 'website', 'netzseite': 'website',
  'internetseite': 'website', 'webiste': 'website', 'webseit': 'website',
  'webeite': 'website', 'hompage': 'homepage', 'hompepage': 'homepage',
  // Wetter-Varianten (nur als eigenständiges Wort → bleibt "wetter")
  'wheather': 'wetter', 'weater': 'wetter', 'wettr': 'wetter',
  // Termin-Varianten
  'termin': 'termin', 'thermin': 'termin', 'terminn': 'termin',
  // Google Ads
  'googel ads': 'google ads', 'google ad': 'google ads', 'adwords': 'google ads',
  'google adwords': 'google ads', 'googel': 'google',
  // Anzeigen
  'anzeige': 'anzeigen', 'anziegen': 'anzeigen', 'anzeign': 'anzeigen',
  // WordPress
  'wordpres': 'wordpress', 'word press': 'wordpress', 'wordress': 'wordpress',
  'worpress': 'wordpress', 'wp': 'wordpress',
  // Hosting
  'hostign': 'hosting', 'hostig': 'hosting',
  // Newsletter
  'newsleter': 'newsletter', 'newletter': 'newsletter', 'newsltter': 'newsletter',
  // Responsive
  'responsiv': 'responsive', 'responive': 'responsive',
  // Automatisierung
  'automatisirung': 'automatisierung', 'automatsierung': 'automatisierung',
  // Sonstiges
  'websiet': 'website', 'analitics': 'analytics', 'analytiks': 'analytics',
  'dsgo': 'dsgvo', 'datenschutzgrundverordnung': 'dsgvo',
};

/**
 * Levenshtein-Distanz (einfach, für kurze Wörter performant genug)
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i-1] === b[j-1]
        ? d[i-1][j-1]
        : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
    }
  }
  return d[m][n];
}

// Alle bekannten kanonischen Begriffe (für Fuzzy-Fallback)
const KNOWN_TERMS = [...new Set(Object.values(SYNONYM_MAP))];
// Plus die Keys selbst, die schon korrekt geschrieben sind
const ALL_CANONICAL = [...KNOWN_TERMS, 
  'script', 'wetter', 'seo', 'plugin', 'website', 'homepage', 'wordpress',
  'hosting', 'newsletter', 'responsive', 'google ads', 'anzeigen', 'termin',
  'performance', 'pagespeed', 'analytics', 'dsgvo', 'schema', 'backup',
  'domain', 'ssl', 'blog', 'artikel', 'react', 'javascript', 'php', 'python',
  'api', 'designare', 'michael', 'kanda', 'datapeak', 'silas', 'evita',
];

/**
 * Normalisiert eine Nachricht: Synonyme ersetzen + Fuzzy-Korrektur.
 * Wird VOR classifyIntent aufgerufen.
 * @param {string} message
 * @returns {string} Normalisierte Nachricht
 */
export function normalizeMessage(message) {
  if (!message) return '';
  let normalized = message.toLowerCase();

  // Pass 1: Exakte Synonym-Ersetzung (Wortgrenzen)
  for (const [variant, canonical] of Object.entries(SYNONYM_MAP)) {
    // Wortgrenzen-sichere Ersetzung
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    normalized = normalized.replace(re, canonical);
  }

  // Pass 2: Fuzzy-Match für unbekannte Wörter (nur Wörter > 4 Zeichen)
  // Prüft ob ein Wort nahe genug an einem bekannten Term ist
  normalized = normalized.replace(/\b[a-zäöüß]{5,}\b/g, (word) => {
    // Bereits ein bekannter Term? → Nichts tun
    if (ALL_CANONICAL.includes(word)) return word;
    if (Object.keys(SYNONYM_MAP).includes(word)) return word; // Schon ersetzt

    // Fuzzy: Levenshtein ≤ 2 zum nächsten bekannten Term?
    let bestMatch = null;
    let bestDist = Infinity;
    for (const term of ALL_CANONICAL) {
      // Nur ähnlich lange Wörter vergleichen (Performance)
      if (Math.abs(term.length - word.length) > 2) continue;
      const dist = levenshtein(word, term);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = term;
      }
    }

    // Max-Distanz: 1 für kurze Wörter (5-6), 2 für längere (7+)
    const maxDist = word.length <= 6 ? 1 : 2;
    if (bestDist <= maxDist && bestMatch) {
      return bestMatch;
    }
    return word;
  });

  return normalized;
}

// ===================================================================
// PATTERN-DEFINITIONEN
// ===================================================================

const GREETING_PATTERNS = [
  /^(h(ey|allo|i)|moin|servus|grüß|guten\s*(morgen|tag|abend)|na\b|yo\b|hi\b|huhu|hoi|seas|griaß)/i,
  /^(tschüss|bye|ciao|bis\s+(bald|dann|später)|pfiat|baba|auf\s+wiedersehen|gute\s+nacht|schlaf\s+gut)/i,
  /^(danke|thx|thanks|dankeschön|vielen\s+dank|merci)\s*[!.]*$/i,
  /^(ja|nein|ok|okay|alles\s+klar|passt|super|cool|nice|top|perfekt|genau|stimmt|klar)\s*[!.]*$/i,
];

const SMALLTALK_PATTERNS = [
  /^wie\s+geht('?s|\s+es)\s*(dir|euch)?/i,
  /^was\s+(geht|machst|treibst|gibt'?s\s+neues)/i,
  /^(erzähl|sag)\s+(mir\s+)?(einen?\s+)?(witz|joke|fun\s*fact)/i,
  /witz|joke|lustig|witzig|humor|spaß|lach/i,
  /^(wer|was)\s+bist\s+du/i,
  /^(bist\s+du|du\s+bist)\s+(ein[e]?\s+)?(ki|ai|bot|robot|mensch|echt)/i,
  /^(kannst|magst|liebst|hasst|denkst)\s+du/i,
  /^(guten?\s+)?(appetit|hunger|essen|mittag|kaffee|pause)/i,
  /^(schöne[sn]?\s+)?(wochenende|feierabend|feiertag|urlaub)/i,
  /langweilig|gelangweilt|müde|motivation/i,
  /lieblingsfarbe|lieblings(film|serie|buch|essen|musik|song|tier|stadt)/i,
  /sinn\s+des\s+lebens|42\b/i,
  /^(test|testing|1\s*2\s*3|hallo\s+welt|hello\s+world)/i,
];

const WEATHER_PATTERNS = [
  // Normalizer korrigiert Typos global → hier nur saubere Patterns nötig
  /\bwetter\b(?![-\s]?(script|tool|api|widget|code|plugin|modul|funktion|dienst|service|daten|integration|abfrage))/i,
  /temperatur|regen(?!schirm)|sonne(?!nbrille)|schnee|wind(?!ow)|bewölkt|grad\s*celsius|forecast/i,
  /regnet|sonnig|kalt|warm|heiß|schwül|nebel|gewitter/i,
  /brauche?\s+(ich\s+)?(einen?\s+)?(regenschirm|jacke|sonnenbrille)/i,
  /wie\s+(ist|wird)\s+(das\s+)?wetter/i,
  /^(soll\s+ich|muss\s+ich).*?(regenschirm|jacke|mantel)/i,
];

const BOOKING_PATTERNS = [
  /termin|meeting|gespräch|beratung|call|telefonat|buchen|vereinbaren|treffen|zoom|video\s*call/i,
  /wann\s+(hast|hat|hätte)\s+(du|michael|er)\s+zeit/i,
  /können\s+wir\s+(uns\s+)?treffen/i,
  /freien?\s+termin/i,
];

const EMAIL_PATTERNS = [
  /e-?mail|mail\s+schreiben|nachricht\s+senden|schreib\s+(ihm|ihr|michael|eine?\s+mail)/i,
  /send\s+(an|to|eine?)/i,
  /kontaktier|anschreiben/i,
];

// FIX: Domain-Pattern (Zeile 2) matcht jetzt nur noch alleinstehende Domains,
// nicht mehr "designare.at verwendet welches CMS?" o.ä.
const ROAST_PATTERNS = [
  /^https?:\/\/.+/i,                                    // Nackte URL mit Protokoll
  /^(?:www\.)?[\w-]+\.[\w.]{2,}\s*[!.?]?\s*$/i,        // FIX: Domain NUR wenn (fast) alleine stehend
  /(?:check|prüf|test|analys|roast|bewert).*(?:\.[\w]{2,})/i,              // "check designare.at"
  /(?:schau).*(?:\.[\w]{2,}).*(?:an\b)?/i,                                // "schau dir mal t3n.de an"
  /(?:check|prüf|test|analys|roast|bewert).*(?:website|seite|page|url|site|domain)/i,
  /(?:website|seite|page|site)\s*(?:check|test|analys|roast|bewert)/i,
  /(?:wie.*(?:gut|schlecht).*(?:mein|die|diese).*(?:website|seite))/i,
  /roast\s*(?:my|meine?|die|diese)/i,
];

const META_PATTERNS = [
  /^(wer|was)\s+(bist|ist)\s+(du|evita)/i,
  /^(was\s+)?kannst\s+du\s+(alles\s+)?(machen|tun|helfen|\?)/i,
  /^(wie\s+)?funktionierst\s+du/i,
  /^hilfe$|^help$/i,
  /deine\s+(fähigkeiten|funktionen|features)/i,
  /evita.*(wer|was|wie|warum|woher)/i,
];

const NEWS_PATTERNS = [
  /news|nachrichten|neuigkeiten|neues\b/i,
  /was\s+gibt.{0,10}neu/i,
  /tech.?welt|wordpress.?news|seo.?news|geo.?news|google.?update|such.?update/i,
  /was\s+(ist|war|gibt).{0,15}(passiert|los|neu)/i,
  /\bgeo\b.{0,10}(neu|update|änderung|news)/i,  // "GEO updates", "GEO Neuigkeiten"
  /ai.?overviews?.{0,10}(neu|update|änderung|news)/i,
];

// Signale dass RAG definitiv gebraucht wird (überschreibt Smalltalk-Match)
const RAG_BOOST_PATTERNS = [
  /michael|kanda|designare/i,
  /wordpress|seo|performance|pagespeed|core\s+web\s+vitals/i,
  /website|webseite|homepage|landing\s*page|relaunch/i,
  /preis|kosten|angebot|paket|leistung|service|portfolio/i,
  /plugin|theme|hosting|server|domain|ssl|backup/i,
  /referenz|projekt|kunde|arbeit/i,
  /schema|structured\s+data|rich\s+snippet/i,
  /ki-?sichtbarkeit|ai\s+visibility|geo.?optimi|generative\s+engine/i,
  /\bgeo\b/i,  // "GEO" als eigenständiges Wort = Generative Engine Optimization (nicht "Geografie")
  /\baeo\b|answer\s+engine/i,
  /ai\s*overviews?|ki.?suche|generative\s+(search|suche|engine)/i,
  /datapeak|silas|content.?generator/i,
  /blog|artikel|beitrag/i,
  /dsgvo|datenschutz|impressum|cookie/i,
  /react|javascript|php|python|css|html|api|code/i,
  // NEU: Indirekte Referenzen auf Michael / die Agentur / Services
  /wer\s+(steckt|ist)\s+(hinter|dahinter)/i,
  /was\s+(biet|mach|kann)\s*(et|st|t)?\s*(ihr|die\s+seite|die\s+agentur|designare)/i,
  /(euer|eure[mn]?|euch)\s*(angebot|leistung|service|arbeit|team|agentur|firma)/i,
  /über\s+(euch|die\s+agentur|die\s+firma|den\s+gründer|die\s+seite)/i,
  /worum\s+geht.{0,10}(hier|seite|website)/i,
  /was\s+(ist|macht)\s+(das\s+hier|diese\s+seite|die\s+seite|die\s+firma)/i,
  /(gründer|inhaber|entwickler|betreiber|macher)\s*(der|von|hinter)/i,
  /(webdesign|webentwicklung|web.?agentur|freelancer|web.?entwickler)/i,
  /zusammen\s*arbeit|beauftragen|engagieren|buchen/i,
  // FIX: Script/Automatisierung/Ads-Begriffe → immer RAG
  /script|google\s*ads|anzeigen?\s*(steuer|schalten|automat)|wetter[-\s]?(script|tool|api|widget|integration)/i,
  // FIX: Tech-Stack / CMS-Fragen explizit als RAG-Signal
  /cms|tech.?stack|architektur|gebaut|aufgebaut|erstellt|programmiert|handgecodet|baukasten|webflow|wix|squarespace|jimdo|typo3|joomla|drupal|statisch/i,
];

// ===================================================================
// KLASSIFIKATION
// ===================================================================

/**
 * Klassifiziert eine User-Nachricht nach Intent.
 * @param {string} message - Die Nachricht des Users
 * @param {Array} history - Chat-History (für Kontext)
 * @returns {{ intent: string, confidence: number, skipRag: boolean, reason: string }}
 */
export function classifyIntent(message, history = []) {
  const trimmed = (message || '').trim();
  // ── NEU: Normalisierung VOR Pattern-Matching (Typos + Synonyme) ──
  const lower = normalizeMessage(trimmed);
  
  // Leere oder sehr kurze Nachrichten
  if (trimmed.length < 2) {
    return { intent: 'greeting', confidence: 0.9, skipRag: true, reason: 'too_short' };
  }

  // ── RAG-Boost Check (Fachbegriffe erkannt → immer RAG) ──
  const hasRagSignal = RAG_BOOST_PATTERNS.some(p => p.test(lower));

  // ── NEU: History-Kontext prüfen ──
  // Wenn die letzten 2-3 Turns Fach-/Michael-Themen hatten,
  // sind Follow-ups ("Erzähl mehr", "Was noch?") wahrscheinlich AUCH fachlich
  const recentHistory = (history || []).slice(-4);
  const recentText = recentHistory.map(h => (h.content || h.text || '')).join(' ').toLowerCase();
  const historyHasRagContext = RAG_BOOST_PATTERNS.some(p => p.test(recentText));

  // Follow-up-Signale: kurze Nachrichten die auf vorherige Antworten referenzieren
  const isFollowUp = /^(und\b|mehr|weiter|erzähl|genauer|detail|was\s+noch|sonst\s+noch|beispiel|zeig|welche[rs]?\s+(noch|andere)|wie\s+genau|was\s+heißt\s+das|erklär|was\s+bedeutet|kannst\s+du\s+mehr|gibt\s*'?s\s+noch|hast\s+du\s+noch)/i.test(lower);
  
  // Fragezeichen + Länge > 20 Zeichen → wahrscheinlich eine echte Frage
  const isLikelyQuestion = trimmed.includes('?') && trimmed.length > 20;

  // ── Pattern Matching (Reihenfolge = Priorität) ──
  
  // 1. Booking (hohe Priorität - Conversion)
  if (BOOKING_PATTERNS.some(p => p.test(lower))) {
    return { intent: 'booking', confidence: 0.85, skipRag: true, reason: 'booking_pattern' };
  }

  // 2. E-Mail
  if (EMAIL_PATTERNS.some(p => p.test(lower))) {
    return { intent: 'email', confidence: 0.85, skipRag: true, reason: 'email_pattern' };
  }

  // 2b. Website-Roast — FIX: NUR wenn KEIN RAG-Signal erkannt wurde
  // Damit "designare.at verwendet welches CMS?" als Fachfrage → RAG läuft
  if (ROAST_PATTERNS.some(p => p.test(trimmed)) && !hasRagSignal) {
    return { intent: 'roast', confidence: 0.9, skipRag: true, reason: 'roast_pattern' };
  }

  // 3. Wetter
  if (WEATHER_PATTERNS.some(p => p.test(lower)) && !hasRagSignal) {
    return { intent: 'weather', confidence: 0.9, skipRag: true, reason: 'weather_pattern' };
  }

  // 4. News
  if (NEWS_PATTERNS.some(p => p.test(lower)) && !hasRagSignal) {
    return { intent: 'news', confidence: 0.8, skipRag: true, reason: 'news_pattern' };
  }

  // 5. Meta (Fragen über Evita) - leichter RAG-Kontext kann helfen
  if (META_PATTERNS.some(p => p.test(lower))) {
    return { intent: 'meta', confidence: 0.85, skipRag: false, reason: 'meta_pattern' };
  }

  // Ab hier: RAG-Boost überschreibt Smalltalk/Greeting
  if (hasRagSignal) {
    return { intent: 'rag', confidence: 0.9, skipRag: false, reason: 'rag_boost_keywords' };
  }

  // NEU: Follow-up auf ein RAG-Thema → RAG beibehalten
  // "Erzähl mehr", "Was noch?", "Und sonst?" nach Michael/Fach-Turn
  if (isFollowUp && historyHasRagContext) {
    return { intent: 'rag', confidence: 0.8, skipRag: false, reason: 'followup_rag_context' };
  }

  // 6. Greeting (nur ohne RAG-Signal)
  if (GREETING_PATTERNS.some(p => p.test(lower))) {
    return { intent: 'greeting', confidence: 0.95, skipRag: true, reason: 'greeting_pattern' };
  }

  // 7. Smalltalk (nur ohne RAG-Signal)
  if (SMALLTALK_PATTERNS.some(p => p.test(lower))) {
    // NEU: Wenn History RAG-Kontext hat UND die Nachricht eine Frage ist,
    // könnte es ein getarntes Follow-up sein ("Was machst du so?" → über Michael)
    if (historyHasRagContext && trimmed.includes('?')) {
      return { intent: 'rag', confidence: 0.6, skipRag: false, reason: 'smalltalk_but_rag_history' };
    }
    return { intent: 'smalltalk', confidence: 0.8, skipRag: true, reason: 'smalltalk_pattern' };
  }

  // 8. Kurze Nachrichten ohne klaren Fach-Intent
  // NEU: Bei RAG-History trotzdem RAG laden (könnte Follow-up sein)
  if (trimmed.length < 15 && !isLikelyQuestion) {
    if (historyHasRagContext) {
      return { intent: 'rag', confidence: 0.55, skipRag: false, reason: 'short_but_rag_history' };
    }
    return { intent: 'smalltalk', confidence: 0.6, skipRag: true, reason: 'short_message' };
  }

  // 9. Default: RAG durchführen
  return { intent: 'rag', confidence: 0.5, skipRag: false, reason: 'default_rag' };
}

/**
 * Liefert Intent-spezifische Hinweise für den Prompt-Builder.
 * @param {string} intent
 * @returns {string} Kontext-Hinweis für den System-Prompt
 */
export function getIntentHint(intent) {
  switch (intent) {
    case 'greeting':
      return 'Der Nutzer grüßt oder verabschiedet sich. Halte dich kurz und natürlich.';
    case 'smalltalk':
      return 'Der Nutzer macht Smalltalk. Sei locker und persönlich, kein Fach-Content nötig.';
    case 'weather':
      return 'Der Nutzer fragt nach dem Wetter. Nutze den Wetter-Kontext oder das Tool.';
    case 'booking':
      return 'Der Nutzer hat Termin-Interesse. Nutze open_booking.';
    case 'email':
      return 'Der Nutzer möchte eine E-Mail senden. Nutze compose_email.';
    case 'roast':
      return 'Der Nutzer will eine Website analysieren lassen. Nutze website_roast mit der erkannten URL.';
    case 'news':
      return 'Der Nutzer fragt nach News/Neuigkeiten. Nutze den News-Kontext.';
    case 'meta':
      return 'Der Nutzer fragt über dich/Evita. Erkläre dich charmant.';
    default:
      return '';
  }
}
