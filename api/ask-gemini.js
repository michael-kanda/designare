// api/ask-gemini.js - REFACTORED: Schlanker Orchestrator
// Delegiert an Service-Module in /lib
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

// ===================================================================
// TOPIC KEYWORDS
// ===================================================================
const TOPIC_REGEX = /(?:wordpress|seo|performance|ki|api|website|plugin|theme|speed|hosting|security|schema|css|html|javascript|react|php|python|datapeak|silas|evita|kuchen|rezept|blog|shop|woocommerce|dsgvo|daten|backup|ssl|domain|analytics|tracking|caching|cdn|responsive|mobile|design|ux|ui|server|deployment|git|docker|nginx|apache|core web vitals|pagespeed|lighthouse|sitemap|robots|meta|snippet|featured|backlinks?|keywords?|ranking|indexierung|crawl|search console|email|e-mail|brevo|newsletter|wetter|weather)/g;

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
    const { isReturningUser, knownName, previousTopics, visitCount, lastVisit, emailsSent } = extractMemoryContext(memory, userName);

    // visitCount nur beim ersten Turn der Session erhöhen (nicht bei jeder Nachricht)
    const isFirstMessageInSession = !history || history.length === 0;
    const effectiveVisitCount = isFirstMessageInSession ? visitCount : (memory?.visitCount || 1);

    console.log(`🧠 Memory: Session=${sessionId?.substring(0, 8)}... | Name=${knownName} | Visits=${effectiveVisitCount} | Emails=${emailsSent}`);

    if (!history || history.length === 0) {
      trackChatSession(sessionId);
    }

    // ── E-Mail-Versand (Frontend-Bestätigung) ──
    if (confirmEmailSend && pendingEmail) {
      return await handleEmailSend({
        pendingEmail, clientIp, emailsSent, sessionId, memory,
        isReturningUser, res
      });
    }

    // ── Kontexte parallel laden (RAG + Wetter + News) ──
    const newsRegex = /news|nachrichten|neuigkeiten|neues\b|was gibt.{0,10}neu|tech.?welt/i;
    const recentHistory = (history || []).slice(-4).map(h => h.content || h.text || '').join(' ');
    const wantsNews = newsRegex.test(userMessage) || newsRegex.test(recentHistory);

    const [ragResult, weatherContext, newsContext] = await Promise.all([
      searchContext(userMessage, currentPage),
      // Wetter nur bei erster Nachricht der Session laden (spart Latenz)
      isFirstMessageInSession ? getWeatherContext() : Promise.resolve(''),
      // News bei erster Nachricht ODER wenn der Nutzer explizit danach fragt
      (isFirstMessageInSession || wantsNews) ? getNewsContext() : Promise.resolve('')
    ]);

    const { additionalContext, availableLinks } = ragResult;

    // ── System-Prompt bauen ──
    const systemPrompt = buildSystemPrompt({
      isReturningUser, knownName, visitCount: effectiveVisitCount, lastVisit, previousTopics,
      emailsSent, currentPage, additionalContext, availableLinks,
      isFirstMessage: isFirstMessageInSession,
      weatherContext,
      newsContext
    });

    // ── Chat-Contents + Gemini-Call ──
    const contents = buildChatContents(history, userMessage);
    let { response, usedModel } = await generateWithFallback(contents, systemPrompt);
    let { answerText, functionCalls } = parseGeminiResponse(response);

    console.log(`🤖 ${usedModel} | Text: ${answerText.length}ch | Tools: ${functionCalls.map(f => f.name).join(', ') || 'none'}`);

    // ── Wetter-Tool Roundtrip ──
    // get_weather ist ein "Data Tool": Gemini braucht die Daten zurück um zu antworten.
    // Andere Tools (open_booking, compose_email etc.) sind "Action Tools" und werden
    // im Frontend verarbeitet – die brauchen keinen Roundtrip.
    const weatherCall = functionCalls.find(fc => fc.name === 'get_weather');
    if (weatherCall) {
      const weatherData = await resolveWeatherCall(weatherCall);

      if (weatherData) {
        console.log(`🌤️ Wetter-Roundtrip: ${weatherData.location} → ${weatherData.temperature}°C`);
        const followUp = await generateWithFunctionResponse(
          contents, systemPrompt, response,
          'get_weather', weatherData, usedModel
        );
        response = followUp.response;
        usedModel = followUp.usedModel;

        // Neu parsen – jetzt hat Gemini die Wetterdaten und antwortet natürlich
        const parsed = parseGeminiResponse(response);
        answerText = parsed.answerText;
        // Nur die NICHT-Wetter function calls behalten
        functionCalls = parsed.functionCalls;

        console.log(`🤖 Wetter-Followup | Text: ${answerText.length}ch | Tools: ${functionCalls.map(f => f.name).join(', ') || 'none'}`);
      }
    }

    // ── Function Calls verarbeiten (Action Tools) ──
    const responsePayload = dispatchFunctionCalls(functionCalls, answerText, {
      currentPage, history, userMessage
    });

    // ── Post-Processing + Memory speichern ──
    if (sessionId) {
      const topicKeywords = userMessage.toLowerCase().match(TOPIC_REGEX) || [];

      const updatedMemory = buildUpdatedMemory({
        memory, detectedName: responsePayload.detectedName, knownName,
        visitCount: effectiveVisitCount, previousTopics, topicKeywords, userMessage, emailsSent
      });
      await saveMemory(sessionId, updatedMemory);

      trackChatMessage({
        sessionId, userMessage, isReturningUser, usedFallback: false,
        modelUsed: usedModel,
        bookingIntent: !!responsePayload.openBooking,
        bookingCompleted: false
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
      return await getWeather(); // Default Wien-Koordinaten
    }

    // Andere Stadt → Geocoding
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
// E-MAIL-VERSAND (extrahierter Sub-Handler)
// ===================================================================
async function handleEmailSend({ pendingEmail, clientIp, emailsSent, sessionId, memory, isReturningUser, res }) {
  // E-Mail-Adresse normalisieren (Gemini liefert manchmal Backticks/Quotes)
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
