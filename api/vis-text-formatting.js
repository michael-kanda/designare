// lib/text-formatting.js - Text-Formatierung, XSS-Schutz, HTML-Cleanup
//
// ── CHANGELOG ────────────────────────────────────────────────
// + Markdown-Links [label](url) werden auf [label] reduziert.
//   Grund: ChatGPT hängt ?utm_source=openai an alle Quellen; lange
//   URLs im Fließtext sind für den Nutzer wertlos, zumal DOMPurify
//   im Frontend ohnehin keine <a>-Tags durchlässt. Chips wie
//   [bezirkstipp.at] sind scannbar, semantisch ehrlich und brauchen
//   weder CSS- noch Sanitizer-Änderungen.
// + Defensive Cleanups (leere Chips) am Ende der Pipeline.
// + Bold-Placeholder-Logik unverändert (XSS-sicher).

// =================================================================
// HELPER: Langweilige Einleitungen entfernen
// =================================================================
function removeBoringIntros(text) {
  const patterns = [
    /^okay[,.\s]*/i,
    /^ok[,.\s]+/i,
    /^ich werde[^.]*\.\s*/i,
    /^ich habe[^.]*gesucht[^.]*\.\s*/i,
    /^hier (sind|ist)[^:]*:\s*/i,
    /^basierend auf[^:]*:\s*/i,
    /^laut[^:]*suchergebnissen?[^:]*:\s*/i,
    /^gerne[,!.\s]*/i,
    /^natürlich[,!.\s]*/i,
    /^selbstverständlich[,!.\s]*/i,
  ];

  let cleaned = text;
  for (let i = 0; i < 3; i++) {
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }
  }
  return cleaned.trim();
}

// =================================================================
// XSS-Schutz
// =================================================================
export function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// =================================================================
// HTML-Tags und Entities entfernen (für Domain-Detection)
// =================================================================
export function stripHTML(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// =================================================================
// Text formatieren (Absätze statt Listen) — MIT XSS-SCHUTZ
// =================================================================
export function formatResponseText(text) {
  let formatted = removeBoringIntros(text);

  // ── Citation-Artefakte entfernen ─────────────────────────────
  formatted = formatted.replace(/\[citation[^\]]*\]/gi, '');
  formatted = formatted.replace(/\[source[^\]]*\]/gi, '');
  formatted = formatted.replace(/\[cite(?::[\d,\s]*)?(?:\]|(?=\s)|$)/gi, '');
  formatted = formatted.replace(/\[cite(?=[A-Za-zÄÖÜäöü])/gi, '');

  // ── Markdown-Links auf Label reduzieren ──────────────────────
  // Matcht:
  //   [label](https://...)
  //   ([label](https://...))      ← ChatGPT wrappt Quellen oft in Klammern
  //   [label](https://... "title")  ← Markdown-Title-Syntax
  // Ergebnis: [label]
  formatted = formatted.replace(
    /\(?\[([^\]\n]+?)\]\(https?:\/\/[^\s)]+(?:\s+"[^"]*")?\)\)?/g,
    '[$1]'
  );

  // ── Optional: Aufeinanderfolgende gleiche Quellen-Chips dedupen ──
  // Aktiviert sparsam: "[bezirkstipp.at] bla [bezirkstipp.at]" bleibt,
  // nur direkt benachbarte Chips werden zusammengefasst.
  // Auskommentiert lassen, wenn Quellen-Tracking pro Satz erwünscht ist.
  // formatted = formatted.replace(/(\[([^\]]+)\])(\s+\1)+/g, '$1');

  // ── Whitespace normalisieren ─────────────────────────────────
  formatted = formatted.replace(/\s{2,}/g, ' ');

  // ── Bold-Platzhalter (XSS-sichere Pipeline) ──────────────────
  const boldParts = [];
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
    const index = boldParts.length;
    boldParts.push(content);
    return `%%BOLD_${index}%%`;
  });

  formatted = escapeHTML(formatted);

  formatted = formatted.replace(/%%BOLD_(\d+)%%/g, (_, index) => {
    return `<strong>${escapeHTML(boldParts[parseInt(index)])}</strong>`;
  });

  // ── Zeilenumbrüche normalisieren ─────────────────────────────
  formatted = formatted.replace(/\r\n/g, '\n');
  formatted = formatted.replace(/\r/g, '\n');

  // ── Absätze (durch Doppelumbrüche getrennt) ──────────────────
  const blocks = formatted.split(/\n{2,}/);

  const htmlBlocks = blocks.map(block => {
    block = block.trim();
    if (!block) return '';

    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const isList = lines.length > 1 && lines.every(l => /^[\d]+[.)]\s|^[•\-\*]\s/.test(l));

    if (isList) {
      const items = lines.map(l => l.replace(/^[\d]+[.)]\s*|^[•\-\*]\s*/, '').trim());
      return '<ul class="ai-list">' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
    }

    block = block.replace(/\n\s*\d+[.)]\s+/g, '<br>');
    block = block.replace(/\n\s*[•\-\*]\s+/g, '<br>');
    block = block.replace(/^\s*\d+[.)]\s+/, '');
    block = block.replace(/^\s*[•\-\*]\s+/, '');

    block = block.replace(/\n/g, '<br>');

    return `<p>${block}</p>`;
  }).filter(Boolean);

  let result = htmlBlocks.join('');

  // ── Finales Cleanup ──────────────────────────────────────────
  result = result.replace(/<p>\s*<\/p>/g, '');
  result = result.replace(/(<br>\s*){3,}/gi, '<br><br>');
  result = result.replace(/\s{2,}/g, ' ');
  result = result.replace(/\s+([.!?,:;])/g, '$1');
  result = result.replace(/Zu\s+<strong>/gi, 'Zu <strong>');

  // Leere Chips (falls Markdown-Label leer war) entfernen
  result = result.replace(/\[\s*\]/g, '');

  return result.trim();
}
