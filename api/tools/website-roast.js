// api/tools/website-roast.js - Vercel Serverless Function für Website-Roast
// Wird als Gemini Function Call von Evita aufgerufen
import { roastWebsite } from '../../lib/website-roast.js';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL fehlt' });
  }

  // Basis-Validierung
  const cleanUrl = url.trim().replace(/[<>"{}|\\^`]/g, '');
  if (cleanUrl.length > 500) {
    return res.status(400).json({ error: 'URL zu lang' });
  }

  try {
    const result = await roastWebsite(cleanUrl);

    // ── Tracking für Dashboard ──
    try {
      const today = new Date().toISOString().split('T')[0];
      await Promise.all([
        redis.hincrby(`evita:roast:daily:${today}`, 'total', 1),
        redis.hincrby(`evita:roast:daily:${today}`, `note_${result.overall.note}`, 1),
        redis.lpush('evita:roast:recent', JSON.stringify({
          url: result.url,
          note: result.overall.note,
          label: result.overall.label,
          score: result.overall.score,
          timestamp: new Date().toISOString()
        })),
        redis.ltrim('evita:roast:recent', 0, 49),
        redis.expire(`evita:roast:daily:${today}`, 90 * 86400) // 90 Tage
      ]);
    } catch (trackErr) {
      console.warn('⚠️ Roast-Tracking Fehler:', trackErr.message);
    }

    // Formatierte Zusammenfassung für Gemini/Evita
    const summary = formatForEvita(result);

    return res.status(200).json({
      success: true,
      roast: result,
      summary // Kompakter Text, den Evita direkt verwenden kann
    });
  } catch (error) {
    console.error('❌ Website-Roast Fehler:', error.message);
    return res.status(200).json({
      success: false,
      error: error.message,
      summary: `Ich konnte ${cleanUrl} leider nicht analysieren: ${error.message}. Ist die URL korrekt und die Seite erreichbar?`
    });
  }
}

/**
 * Formatiert das Roast-Ergebnis als kompakten Text für Evitas System-Prompt.
 * Evita nimmt diesen Text und formt daraus ihren charmant-frechen Roast.
 */
function formatForEvita(result) {
  const { overall, categories, highlights, url, responseTime } = result;

  let text = `WEBSITE-ROAST ERGEBNIS für ${url}:\n`;
  text += `Gesamtnote: ${overall.note} (${overall.label}) – ${overall.score}%\n`;
  text += `Antwortzeit: ${responseTime}\n\n`;

  text += `ZEUGNIS:\n`;
  for (const [key, cat] of Object.entries(categories)) {
    text += `• ${cat.name}: Note ${cat.note} (${cat.label}, ${cat.score}%)\n`;
    for (const item of cat.items) {
      const icon = item.status === 'pass' ? '✓' : item.status === 'fail' ? '✗' : '~';
      text += `  ${icon} ${item.check}: ${item.detail}\n`;
    }
  }

  text += `\nHIGHLIGHTS FÜR DEINEN ROAST:\n`;
  text += `Beste Kategorie: ${highlights.bestCategory[1].name} (${highlights.bestCategory[1].score}%)\n`;
  text += `Schwächste Kategorie: ${highlights.worstCategory[1].name} (${highlights.worstCategory[1].score}%)\n`;

  if (highlights.criticalFails.length > 0) {
    text += `Kritische Fehler: ${highlights.criticalFails.join(', ')}\n`;
  }
  if (highlights.quickWins.length > 0) {
    text += `Quick Wins: ${highlights.quickWins.join(' | ')}\n`;
  }

  text += `\nGIB DEN ROAST IN DEINEM EVITA-STIL:\n`;
  text += `- Charmant-frech, wie eine Kollegin die das Zeugnis vorliest\n`;
  text += `- Starte mit der Gesamtnote als "Schulnote"\n`;
  text += `- Hebe 2-3 gute Dinge hervor (aber mit Augenzwinkern)\n`;
  text += `- Nenne 2-3 Probleme direkt beim Namen (mit Humor)\n`;
  text += `- Ende mit einem konkreten "Quick Win" den man sofort umsetzen kann\n`;
  text += `- Max 6-8 Sätze, KEINE Aufzählungen, KEINE Emojis\n`;
  text += `- Bei Note 1-2: respektvoll loben. Bei 3: "geht besser". Bei 4-5: liebevoll zerstören.\n`;
  text += `- WICHTIG: Erwähne am Ende beiläufig den KI-Sichtbarkeits-Check (/ki-sichtbarkeit) als nächsten logischen Schritt. Z.B.: "Willst du auch wissen, wie KI-Systeme wie ChatGPT und Gemini deine Seite sehen? Dafür haben wir den KI-Sichtbarkeits-Check." Nutze suggest_chips mit einem Link-Chip zu /ki-sichtbarkeit.\n`;

  return text;
}
