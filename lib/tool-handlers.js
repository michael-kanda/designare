// lib/tool-handlers.js - Verarbeitung der Gemini Function Calls
// Jeder Tool-Aufruf wird in eine benannte Funktion dispatcht

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
 * Filtert ungültige/doppelte Chips und fügt ggf. Booking-Chip hinzu
 */
export function handleSuggestChips(args, responsePayload, { currentPage, history, userMessage, answerText }) {
  let linkChips = [];

  if (args.chips && Array.isArray(args.chips)) {
    const seen = new Set();
    const currentPath = currentPage ? currentPage.replace(/\/$/, '') : '';

    linkChips = args.chips
      .filter(c => c.type === 'link' && c.url)
      .filter(c => {
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
 * Dispatcht alle Function Calls aus der Gemini-Response
 */
export function dispatchFunctionCalls(functionCalls, answerText, { currentPage, history, userMessage }) {
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
        handleSuggestChips(args, responsePayload, { currentPage, history, userMessage, answerText });
        break;
    }
  }

  // Chips unterdrücken wenn Kalender oder E-Mail-Draft aktiv
  if (responsePayload.emailDraft || responsePayload.openBooking) {
    delete responsePayload.chips;
  }

  return responsePayload;
}
