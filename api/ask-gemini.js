// api/ask-gemini.js - REFACTORED: Schlanker Orchestrator
// Delegiert an Service-Module in /lib
// NEU: Intent-Filter vor RAG (spart Kosten + verbessert Qualität)
// NEU: turnCount aus Redis (nicht mehr Frontend-abhängig)
// FIX: Resilientes Roundtrip-Handling mit Fallback
import { trackChatMessage, trackChatSession, trackQuestion, trackFallback, trackTopics, trackEmailSent } from './evita-track.js';
import { setCorsHeaders, isValidEmail, getClientIp, MAX_MESSAGE_LENGTH } from '../lib/validation.js';
import { checkRateLimit } from '../lib/rate-limiter.js';
import { getMemory, saveMemory, extractMemoryContext, buildUpdatedMemory } from '../lib/memory-service.js';
import { sendEmail, isEmailBlocked, isEmailWhitelisted, normalizeEmail, MAX_EMAILS_PER_SESSION } from '../lib/email-service.js';
import { searchContext } from '../lib/rag-service.js';
import { buildSystemPrompt } from '../lib/prompt-builder.js';
import { generateWithFallback, generateWithFunctionResponse, parseGeminiResponse, buildChatContents } from '../lib/gemini-client.js';
import { dispatchFunctionCalls } from '../lib/tool-handlers.js';
import { getWeatherContext, getWeather, geocodeCity } from '../lib/weather-service.js';
import { getNewsContext } from '../lib/news-service.js';
import { classifyIntent, getIntentHint } from '../lib/intent-filter.js';
import { roastWebsite } from '../lib/website-roast.js';
import { Redis } from '@upstash/redis';

const roastRedis = Redis.fromEnv();

// ===================================================================
// TOPIC KEYWORDS
// ===================================================================
const TOPIC_REGEX = /(?:wordpress|seo|geo|aeo|performance|ki|api|website|plugin|theme|speed|hosting|security|schema|css|html|javascript|react|php|python|datapeak|silas|evita|kuchen|rezept|blog|shop|woocommerce|dsgvo|daten|backup|ssl|domain|analytics|tracking|caching|cdn|responsive|mobile|design|ux|ui|server|deployment|git|docker|nginx|apache|core web vitals|pagespeed|lighthouse|sitemap|robots|meta|snippet|featured|backlinks?|keywords?|ranking|indexierung|crawl|search console|email|e-mail|brevo|newsletter|wetter|weather|ai.?overviews?|ki.?suche)/g;

// ===================================================================
// ROUNDTRIP TOOL RESOLVERS
// Zentrales "Telefonbuch": Tool-Name → { resolve, emoji }
// Neues Tool? → Eine Zeile hier + Resolver-Funktion unten. Fertig.
// ===================================================================
const ROUNDTRIP_RESOLVERS = {
  get_weather:   { resolve: resolveWeatherCall,  emoji: '🌤️' },
  website_roast: { resolve: resolveRoastCall,    emoji: '🔥' },
  // Nächstes Tool einfach hier eintragen:
  // book_appointment: { resolve: resolveBookingCall, emoji: '📅' },
};

// ===================================================================
// MAIN HANDLER
// ===================================================================
export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // Rate-Limit prüfen
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp, 'general')) {
    console.warn(`⚠️ Rate Limit erreicht für IP: ${clientIp}`);
    return res.status(429).json({ answer: 'Zu viele Anfragen. Bitte warte einen Moment.', rateLimited: true });
  }

  try {
    const { prompt, source, history, message, sessionId, userName, pendingEmail, confirmEmailSend, currentPage } = req.body;
    const userMessage = message || prompt;

    // ── Input-Validierung ──
    if (!userMessage || typeof userMessage !== 'string') {
      return res.status(400).json({ answer: 'Keine Nachricht erhalten.' });
    }
    if (userMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ answer: `Nachricht zu lang (max. ${MAX_MESSAGE_LENGTH} Zeichen). Bitte kürzer fassen!` });
    }

    // ── Memory laden ──
    const memory = await getMemory(sessionId);
    const { isReturningUser, knownName, previousTopics, visitCount, lastVisit, emailsSent, turnCount, isFirstTurn } = extractMemoryContext(memory, userName);

    console.log(`🧠 Memory: Session=${sessionId?.substring(0, 8)}... | Name=${knownName} | Visits=${visitCount} | Turn=${turnCount} | Emails=${emailsSent}`);

    if (isFirstTurn) {
      trackChatSession(sessionId);
    }

    // ── E-Mail-Versand (Frontend-Bestätigung) ──
    if (confirmEmailSend && pendingEmail) {
      return await handleEmailSend({
        pendingEmail, clientIp, emailsSent, sessionId, memory,
        isReturningUser, res
      });
    }

    // ════════════════════════════════════════════════════════════════
    // NEU: INTENT-FILTER VOR RAG
    // Klassifiziert die Nachricht und entscheidet ob RAG nötig ist
    // ════════════════════════════════════════════════════════════════
    const intent = classifyIntent(userMessage, history);
    console.log(`🎯 Intent: ${intent.intent} (${(intent.confidence * 100).toFixed(0)}%) | RAG: ${intent.skipRag ? 'SKIP' : 'YES'} | Reason: ${intent.reason}`);

    // ── Kontexte parallel laden (RAG + Wetter + News) ──
    // RAG wird NUR geladen wenn der Intent es erfordert
    const newsRegex = /news|nachrichten|neuigkeiten|neues\b|was gibt.{0,10}neu|tech.?welt|wordpress.?news|seo.?news|geo.?news|google.?update|such.?update|ki.?suche|ai.?overviews?/i;
    const recentHistory = (history || []).slice(-4).map(h => h.content || h.text || '').join(' ');
    const wantsNews = newsRegex.test(userMessage) || newsRegex.test(recentHistory);

    const [ragResult, weatherContext, newsContext] = await Promise.all([
      // NEU: RAG nur wenn Intent es verlangt
      intent.skipRag
        ? Promise.resolve({ additionalContext: '', availableLinks: [] })
        : searchContext(userMessage, currentPage),
      // Wetter nur bei erstem Turn der Session laden
      isFirstTurn ? getWeatherContext() : Promise.resolve(''),
      // News bei erstem Turn ODER wenn der Nutzer explizit danach fragt
      (isFirstTurn || wantsNews) ? getNewsContext() : Promise.resolve('')
    ]);

    if (intent.skipRag) {
      console.log(`⚡ RAG übersprungen (Intent: ${intent.intent}) → schnellere Antwort`);
    }

    const { additionalContext, availableLinks } = ragResult;

    // ── Intent-Hint für den Prompt ──
    const intentHint = getIntentHint(intent.intent);

    // ── System-Prompt bauen ──
    const systemPrompt = buildSystemPrompt({
      isReturningUser, knownName, visitCount, lastVisit, previousTopics,
      emailsSent, currentPage, additionalContext, availableLinks,
      isFirstMessage: isFirstTurn,
      weatherContext,
      newsContext,
      intentHint,
      turnCount
    });

    // ── Chat-Contents + Gemini-Call ──
    // History trimmen: Die letzten MAX_HISTORY_TURNS Turns reichen für Kontext.
    // Harmonisiert mit buildChatContents MAX_TOTAL_CHARS (20.000 Zeichen ≈ 13 Turns à 1.500).
    const MAX_HISTORY_TURNS = 10;
    const trimmedHistory = (history && history.length > MAX_HISTORY_TURNS * 2)
      ? history.slice(-(MAX_HISTORY_TURNS * 2))  // *2 weil user+assistant = 2 Einträge pro Turn
      : (history || []);

    if (history && trimmedHistory.length < history.length) {
      console.log(`✂️ History getrimmt: ${history.length} → ${trimmedHistory.length} Einträge (${MAX_HISTORY_TURNS} Turns behalten)`);
    }

    const contents = buildChatContents(trimmedHistory, userMessage);
    let { response, usedModel } = await generateWithFallback(contents, systemPrompt);
    let { answerText, functionCalls } = parseGeminiResponse(response);

    console.log(`🤖 ${usedModel} | Text: ${answerText.length}ch | Tools: ${functionCalls.map(f => f.name).join(', ') || 'none'}`);

    // ════════════════════════════════════════════════════════════════
    // ROUNDTRIP-SCHLEIFE: Dynamischer Tool-Dispatcher
    // Iteriert über alle Function Calls und löst registrierte
    // Roundtrip-Tools automatisch auf. Neues Tool? → Nur in
    // ROUNDTRIP_RESOLVERS eintragen, der Rest passiert hier.
    //
    // FIX: Jeder Roundtrip ist in try/catch gewrappt.
    // Bei Fehler wird der bisherige answerText beibehalten statt
    // "Pixelfehler im System" zu werfen.
    // ════════════════════════════════════════════════════════════════
    const roundtripCalls = functionCalls.filter(fc => fc.name in ROUNDTRIP_RESOLVERS);
    let roastCompleted = false;

    for (const toolCall of roundtripCalls) {
      const { resolve, emoji } = ROUNDTRIP_RESOLVERS[toolCall.name];

      // Chips VOR dem Roundtrip sichern (Gemini gibt sie oft zusammen mit dem Tool-Call)
      const preservedChips = functionCalls.find(fc => fc.name === 'suggest_chips');

      // FIX: Pre-Roundtrip-State sichern als Fallback
      const fallbackText = answerText;
      const fallbackCalls = [...functionCalls];

      try {
        const toolData = await resolve(toolCall);

        if (toolData) {
          console.log(`${emoji} Roundtrip [${toolCall.name}]: Daten erhalten → sende an Gemini`);

          const followUp = await generateWithFunctionResponse(
            contents, systemPrompt, response,
            toolCall.name, toolData, usedModel
          );
          response = followUp.response;
          usedModel = followUp.usedModel;

          const parsed = parseGeminiResponse(response);
          answerText = parsed.answerText;
          functionCalls = parsed.functionCalls;

          // Chips wiederherstellen wenn Followup keine eigenen hat
          if (preservedChips && !functionCalls.find(fc => fc.name === 'suggest_chips')) {
            functionCalls.push(preservedChips);
          }

          console.log(`🤖 ${toolCall.name}-Followup | Text: ${answerText.length}ch | Tools: ${functionCalls.map(f => f.name).join(', ') || 'none'}`);

          if (toolCall.name === 'website_roast') roastCompleted = true;
        }
      } catch (roundtripErr) {
        // FIX: Roundtrip-Fehler fängt sich graceful – Nutzer bekommt trotzdem eine Antwort
        console.error(`❌ Roundtrip [${toolCall.name}] fehlgeschlagen:`, roundtripErr.message);

        // Fallback: Wenn wir vorher schon Text hatten, behalten wir ihn.
        // Wenn nicht (reiner Tool-Call ohne Text), generieren wir eine Fehlermeldung.
        if (fallbackText) {
          answerText = fallbackText;
          functionCalls = fallbackCalls;
        } else {
          answerText = `Ich wollte gerade ${toolCall.name === 'website_roast' ? 'die Website analysieren' : 'Daten abrufen'}, aber da ist leider ein Fehler aufgetreten. Probiers bitte nochmal!`;
          functionCalls = fallbackCalls.filter(fc => !(fc.name in ROUNDTRIP_RESOLVERS));
        }
      }
    }

    // ── Function Calls verarbeiten (Action Tools) ──
    const responsePayload = dispatchFunctionCalls(functionCalls, answerText, {
      currentPage, history, userMessage, availableLinks
    });

    // ── Post-Dispatch: KI-Sichtbarkeits-Chip nach Roast injizieren ──
    // Wird NACH dispatchFunctionCalls gesetzt, damit der allowedUrls-Filter
    // in handleSuggestChips den Chip nicht als "halluziniert" rauswirft.
    if (roastCompleted) {
      const KI_CHECK_CHIP = { type: 'link', text: 'KI-Sichtbarkeits-Check', url: '/ki-sichtbarkeit' };

      if (!responsePayload.chips) {
        responsePayload.chips = [];
      }

      const alreadyHas = responsePayload.chips.some(c =>
        (c.url || '').includes('ki-sichtbarkeit')
      );

      if (!alreadyHas) {
        responsePayload.chips.push(KI_CHECK_CHIP);
        console.log('🔗 KI-Sichtbarkeits-Chip injiziert (post-dispatch)');
      }
    }

    // ── Post-Processing + Memory speichern ──
    if (sessionId) {
      const topicKeywords = userMessage.toLowerCase().match(TOPIC_REGEX) || [];

      const updatedMemory = buildUpdatedMemory({
        memory, detectedName: responsePayload.detectedName, knownName,
        visitCount, previousTopics, topicKeywords, userMessage, emailsSent
      });
      await saveMemory(sessionId, updatedMemory);

      trackChatMessage({
        sessionId, userMessage, isReturningUser, usedFallback: false,
        modelUsed: usedModel,
        bookingIntent: !!responsePayload.openBooking,
        bookingCompleted: false,
        intent: intent.intent,
        ragSkipped: intent.skipRag
      });
      trackQuestion(userMessage);
      if (topicKeywords.length > 0) trackTopics(topicKeywords);

      if (!responsePayload.detectedName && knownName) {
        responsePayload.detectedName = knownName;
      }
    }

    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error("API Error:", error);
    const { sessionId, message, prompt } = req.body || {};
    trackChatMessage({ sessionId, userMessage: message || prompt || '', isReturningUser: false, usedFallback: true, modelUsed: 'fallback', bookingIntent: false, bookingCompleted: false });
    trackFallback(message || prompt || '');
    res.status(500).json({ answer: 'Pixelfehler im System! Michael ist dran.' });
  }
}

// ===================================================================
// WETTER-TOOL RESOLVER
// ===================================================================
async function resolveWeatherCall(weatherCall) {
  try {
    const cityName = weatherCall.args?.city || 'Wien';

    if (cityName.toLowerCase() === 'wien' || cityName.toLowerCase() === 'vienna') {
      return await getWeather();
    }

    const location = await geocodeCity(cityName);
    if (!location) {
      return { error: `Stadt "${cityName}" nicht gefunden.`, location: cityName };
    }

    return await getWeather(location);
  } catch (err) {
    console.error('❌ Wetter-Resolver Fehler:', err.message);
    return null;
  }
}

// ===================================================================
// WEBSITE-ROAST RESOLVER
// ===================================================================
async function resolveRoastCall(roastCall) {
  try {
    const url = roastCall.args?.url;
    if (!url) {
      return { error: 'Keine URL angegeben.', summary: 'Ohne URL kann ich leider nichts roasten!' };
    }

    console.log(`🔥 Website-Roast gestartet: ${url}`);
    const result = await roastWebsite(url);

    // ── Tracking für Dashboard ──
    try {
      const today = new Date().toISOString().split('T')[0];
      await Promise.all([
        roastRedis.hincrby(`evita:roast:daily:${today}`, 'total', 1),
        roastRedis.hincrby(`evita:roast:daily:${today}`, `note_${result.overall.note}`, 1),
        roastRedis.lpush('evita:roast:recent', JSON.stringify({
          url: result.url,
          note: result.overall.note,
          label: result.overall.label,
          score: result.overall.score,
          timestamp: new Date().toISOString()
        })),
        roastRedis.ltrim('evita:roast:recent', 0, 49),
        roastRedis.expire(`evita:roast:daily:${today}`, 90 * 86400)
      ]);
    } catch (trackErr) {
      console.warn('⚠️ Roast-Tracking Fehler:', trackErr.message);
    }

    // Kompakte Zusammenfassung für Gemini bauen (wie im API-Endpoint)
    const { overall, categories, highlights } = result;

    let summary = `WEBSITE-ROAST ERGEBNIS für ${result.url}:\n`;
    summary += `Gesamtnote: ${overall.note} (${overall.label}) – ${overall.score}%\n`;
    summary += `Antwortzeit: ${result.responseTime}\n\n`;

    summary += `ZEUGNIS:\n`;
    for (const [key, cat] of Object.entries(categories)) {
      summary += `• ${cat.name}: Note ${cat.note} (${cat.label}, ${cat.score}%)\n`;
      for (const item of cat.items) {
        const icon = item.status === 'pass' ? '✓' : item.status === 'fail' ? '✗' : '~';
        summary += `  ${icon} ${item.check}: ${item.detail}\n`;
      }
    }

    summary += `\nHIGHLIGHTS:\n`;
    summary += `Beste Kategorie: ${highlights.bestCategory[1].name} (${highlights.bestCategory[1].score}%)\n`;
    summary += `Schwächste Kategorie: ${highlights.worstCategory[1].name} (${highlights.worstCategory[1].score}%)\n`;
    if (highlights.criticalFails.length > 0) {
      summary += `Kritische Fehler: ${highlights.criticalFails.join(', ')}\n`;
    }
    if (highlights.quickWins.length > 0) {
      summary += `Quick Wins: ${highlights.quickWins.join(' | ')}\n`;
    }

    summary += `\nGIB DEN ROAST IN DEINEM EVITA-STIL:\n`;
    summary += `- Charmant-frech, wie eine Kollegin die das Zeugnis vorliest\n`;
    summary += `- Starte mit der Gesamtnote als "Schulnote"\n`;
    summary += `- Hebe 2-3 gute Dinge hervor (mit Augenzwinkern)\n`;
    summary += `- Nenne 2-3 Probleme direkt beim Namen (mit Humor)\n`;
    summary += `- Ende mit einem konkreten Quick Win\n`;
    summary += `- Max 6-8 Sätze, KEINE Aufzählungen, KEINE Emojis\n`;
    summary += `- Bei Note 1-2: respektvoll loben. Bei 3: "geht besser". Bei 4-5: liebevoll zerstören.\n`;
    summary += `- WICHTIG: Schreibe den Roast NEUTRAL – nimm NIEMALS an, wer die Website erstellt hat. Auch nicht Michael! Du bewertest die Seite, nicht den Ersteller.\n`;
    summary += `- Erwähne beiläufig den KI-Sichtbarkeits-Check als möglichen nächsten Schritt (der Link-Chip wird automatisch angehängt, du musst ihn NICHT über suggest_chips setzen).\n`;

    return { summary, url: result.url, overall: result.overall };
  } catch (err) {
    console.error('❌ Roast-Resolver Fehler:', err.message);
    return {
      error: err.message,
      summary: `Ich konnte die Website leider nicht analysieren: ${err.message}. Ist die URL korrekt und die Seite erreichbar?`
    };
  }
}

// ===================================================================
// E-MAIL-VERSAND (extrahierter Sub-Handler)
// ===================================================================
async function handleEmailSend({ pendingEmail, clientIp, emailsSent, sessionId, memory, isReturningUser, res }) {
  pendingEmail.to = normalizeEmail(pendingEmail.to);
  console.log('📧 E-Mail-Versand bestätigt für:', pendingEmail.to);

  if (!checkRateLimit(clientIp, 'email')) {
    console.warn(`⚠️ E-Mail Rate Limit erreicht für IP: ${clientIp}`);
    return res.status(429).json({ answer: 'Zu viele E-Mails in kurzer Zeit. Bitte warte einen Moment.' });
  }

  if (emailsSent >= MAX_EMAILS_PER_SESSION) {
    return res.status(200).json({
      answer: `Du hast bereits ${MAX_EMAILS_PER_SESSION} E-Mails in dieser Session gesendet. Das ist das Maximum pro Sitzung.`
    });
  }

  if (!isValidEmail(pendingEmail.to)) {
    return res.status(200).json({ answer: `Hmm, "${pendingEmail.to}" sieht nicht nach einer gültigen E-Mail-Adresse aus.` });
  }

  if (!(await isEmailWhitelisted(pendingEmail.to))) {
    return res.status(200).json({
      answer: `Die Adresse ${pendingEmail.to} ist nicht in der Empfänger-Whitelist hinterlegt. E-Mails dürfen nur an freigegebene Adressen versendet werden. Bitte wende dich an Michael, damit er die Adresse im Dashboard freischaltet.`
    });
  }

  if (await isEmailBlocked(pendingEmail.to)) {
    return res.status(200).json({ answer: `Die Adresse ${pendingEmail.to} hat den Empfang von E-Mails über designare.at blockiert.` });
  }

  try {
    const result = await sendEmail({
      to: pendingEmail.to, toName: pendingEmail.toName || '',
      subject: pendingEmail.subject, body: pendingEmail.body, sessionId
    });

    if (sessionId) {
      await saveMemory(sessionId, { ...(memory || {}), emailsSent: emailsSent + 1, lastEmailAt: new Date().toISOString() });
    }

    trackChatMessage({ sessionId, userMessage: `[EMAIL_SENT] ${pendingEmail.to}`, isReturningUser, usedFallback: false, modelUsed: 'email', bookingIntent: false, bookingCompleted: false });
    trackEmailSent({ sessionId, to: pendingEmail.to, subject: pendingEmail.subject, success: true });

    return res.status(200).json({
      answer: `Erledigt! Die E-Mail an ${pendingEmail.to} mit Betreff „${pendingEmail.subject}" ist raus. Kann ich noch was tun?`,
      emailSent: true, messageId: result.messageId
    });

  } catch (emailError) {
    console.error('📧 Brevo-Fehler:', emailError.message);
    trackEmailSent({ sessionId, to: pendingEmail.to, subject: pendingEmail.subject, success: false });
    return res.status(200).json({ answer: 'Da ist leider was schiefgelaufen beim Versand.', emailSent: false });
  }
}
