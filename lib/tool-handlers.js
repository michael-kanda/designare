// lib/tool-handlers.js - Verarbeitung der Gemini Function Calls
// Jeder Tool-Aufruf wird in eine benannte Funktion dispatcht

// ===================================================================
// BLOCKLIST: URLs die NIE als Chip erscheinen dürfen
// Synchron mit Frontend (js/evita-chips.js) – Defense in Depth.
// Vergleich case-insensitive, Trailing-Slash/Query/Hash-tolerant,
// und matcht sowohl absolute (https://designare.at/...) als auch
// relative (/michael-kanda) URLs.
// ===================================================================
const BLOCKED_CHIP_URLS = [
  'https://designare.at/michael-kanda'
];

/** Normalisiert URLs für robusten Vergleich (lowercase, ohne Hash/Query/Trailing-Slash) */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let u = url.trim().toLowerCase();
  u = u.split('#')[0].split('?')[0];
  u = u.replace(/\.(html?|php|aspx?)$/i, '');   // ← NEU
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

/** Extrahiert den Pfad-Anteil aus absoluter ODER relativer URL */
function extractPath(url) {
  const n = normalizeUrl(url);
  if (!n) return '';
  if (n.startsWith('http')) {
    try {
      return new URL(n).pathname.replace(/\/$/, '') || '/';
    } catch {
      return '';
    }
  }
  return n.replace(/\/$/, '');
}

/** Prüft, ob eine Chip-URL geblockt ist (absolut ODER relativ) */
function isChipUrlBlocked(url) {
  const target = normalizeUrl(url);
  if (!target) return false;

  return BLOCKED_CHIP_URLS.some(blocked => {
    const b = normalizeUrl(blocked);
    if (target === b) return true;
    const blockedPath = extractPath(b);
    const targetPath = extractPath(target);
    return blockedPath && targetPath && blockedPath === targetPath;
  });
}

/**
 * Verarbeitet einen open_booking Function Call
 */
export function handleOpenBooking(args, responsePayload, answerText) {
  responsePayload.openBooking = true;
  responsePayload.bookingReason = args.reason || null;
  if (!answerText.trim()) {
    responsePayload.answer = 'Klar, ich öffne Michaels Kalender für dich!';
  }
}

/**
 * Verarbeitet einen compose_email Function Call
 */
export function handleComposeEmail(args, responsePayload) {
  if (!args.to || !args.subject || !args.body) return;

  responsePayload.emailDraft = {
    to: args.to,
    toName: args.to_name || '',
    subject: args.subject,
    body: args.body
  };

  const draftDisplay = `\n\nE-Mail-Entwurf:\nAn: ${args.to}${args.to_name ? ` (${args.to_name})` : ''}\nBetreff: ${args.subject}\n\n---\n${args.body}\n---`;
  responsePayload.answer = `Hier ist mein Entwurf:${draftDisplay}\n\nSoll ich die E-Mail so abschicken, oder möchtest du etwas ändern?`;
}

/**
 * Verarbeitet einen remember_user_name Function Call
 */
export function handleRememberUserName(args, responsePayload) {
  const n = args.name;
  if (n && n.length >= 2 && n.length <= 20) {
    responsePayload.detectedName = n.trim();
  }
}

/**
 * Verarbeitet einen suggest_chips Function Call
 * Filtert ungültige/doppelte/geblockte Chips und fügt ggf. Booking-Chip hinzu
 */
export function handleSuggestChips(args, responsePayload, { currentPage, history, userMessage, answerText, availableLinks }) {
  let linkChips = [];

  // Set erlaubter URLs aus dem RAG-Kontext
  const allowedUrls = new Set((availableLinks || []).map(l => l.url));

  if (args.chips && Array.isArray(args.chips)) {
    const seen = new Set();
    const currentPath = currentPage ? currentPage.replace(/\/$/, '') : '';

    linkChips = args.chips
      .filter(c => c.type === 'link' && c.url)
      .filter(c => {
        // Blocklist hat oberste Priorität
        if (isChipUrlBlocked(c.url)) {
          console.warn(`🚫 Geblockter Chip gefiltert: ${c.url}`);
          return false;
        }
        // Nur URLs durchlassen, die tatsächlich aus dem RAG-Kontext stammen
        if (!allowedUrls.has(c.url)) {
          console.warn(`🚫 Halluzinierter Link gefiltert: ${c.url}`);
          return false;
        }
        if (currentPath && c.url.replace(/\/$/, '').includes(currentPath)) return false;
        if (seen.has(c.url)) return false;
        seen.add(c.url);
        return c.text && c.text.length > 0;
      })
      .slice(0, 2);
  }

  // Dynamischer Booking-Chip: ab 3. Frage oder bei Booking-Keywords
  const isLongConversation = history && history.length >= 4;
  const bookingKeywords = [
    'termin', 'rückruf', 'kontakt', 'angebot', 'preis', 'zusammenarbeit',
    'telefonieren', 'call', 'sprechen', 'erreichen', 'kosten', 'projekt'
  ];
  const isBookingTopic = bookingKeywords.some(kw =>
    userMessage.toLowerCase().includes(kw) || answerText.toLowerCase().includes(kw)
  );

  const finalChips = [];

  if (isLongConversation || isBookingTopic) {
    finalChips.push({ type: 'booking', text: 'Rückruf anfordern' });
  }

  finalChips.push(...linkChips);

  if (finalChips.length > 0) {
    responsePayload.chips = finalChips;
  }
}

/**
 * Verarbeitet einen website_roast Function Call.
 * Das eigentliche Roasting passiert serverseitig – hier wird nur
 * das Tool-Ergebnis als "pending" markiert, damit der Chat-Handler
 * den API-Call an /api/tools/website-roast absetzen kann.
 */
export function handleWebsiteRoast(args, responsePayload) {
  if (!args.url) return;
  responsePayload.websiteRoast = {
    url: args.url.trim(),
    pending: true
  };
}

/**
 * Dispatcht alle Function Calls aus der Gemini-Response
 */
export function dispatchFunctionCalls(functionCalls, answerText, { currentPage, history, userMessage, availableLinks }) {
  const responsePayload = { answer: answerText.trim() };

  for (const fc of functionCalls) {
    const args = fc.args || {};

    switch (fc.name) {
      case 'open_booking':
        handleOpenBooking(args, responsePayload, answerText);
        break;
      case 'compose_email':
        handleComposeEmail(args, responsePayload);
        break;
      case 'remember_user_name':
        handleRememberUserName(args, responsePayload);
        break;
      case 'suggest_chips':
        handleSuggestChips(args, responsePayload, { currentPage, history, userMessage, answerText, availableLinks });
        break;
      case 'website_roast':
        handleWebsiteRoast(args, responsePayload);
        break;
    }
  }

  // Chips unterdrücken wenn Kalender oder E-Mail-Draft aktiv
  if (responsePayload.emailDraft || responsePayload.openBooking) {
    delete responsePayload.chips;
  }

  return responsePayload;
}
