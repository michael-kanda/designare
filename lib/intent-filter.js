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
// 'meta'      → Fragen über Evita selbst / den Chatbot
// 'news'      → News-Anfragen (hat eigenen Kontext)

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
  /wetter|temperatur|regen|sonne|schnee|wind|bewölkt|grad|celsius|forecast/i,
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
  /tech.?welt|wordpress.?news|seo.?news|google.?update|such.?update/i,
  /was\s+(ist|war|gibt).{0,15}(passiert|los|neu)/i,
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
  /ki-?sichtbarkeit|ai\s+visibility/i,
  /datapeak|silas|content.?generator/i,
  /blog|artikel|beitrag/i,
  /dsgvo|datenschutz|impressum|cookie/i,
  /react|javascript|php|python|css|html|api|code/i,
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
  const lower = trimmed.toLowerCase();
  
  // Leere oder sehr kurze Nachrichten
  if (trimmed.length < 2) {
    return { intent: 'greeting', confidence: 0.9, skipRag: true, reason: 'too_short' };
  }

  // ── RAG-Boost Check (Fachbegriffe erkannt → immer RAG) ──
  const hasRagSignal = RAG_BOOST_PATTERNS.some(p => p.test(lower));
  
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

  // 6. Greeting (nur ohne RAG-Signal)
  if (GREETING_PATTERNS.some(p => p.test(lower))) {
    return { intent: 'greeting', confidence: 0.95, skipRag: true, reason: 'greeting_pattern' };
  }

  // 7. Smalltalk (nur ohne RAG-Signal)
  if (SMALLTALK_PATTERNS.some(p => p.test(lower))) {
    return { intent: 'smalltalk', confidence: 0.8, skipRag: true, reason: 'smalltalk_pattern' };
  }

  // 8. Kurze Nachrichten ohne klaren Fach-Intent → eher Smalltalk
  if (trimmed.length < 15 && !isLikelyQuestion) {
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
    case 'news':
      return 'Der Nutzer fragt nach News/Neuigkeiten. Nutze den News-Kontext.';
    case 'meta':
      return 'Der Nutzer fragt über dich/Evita. Erkläre dich charmant.';
    default:
      return '';
  }
}
