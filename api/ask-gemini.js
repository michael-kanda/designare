// api/ask-gemini.js - MIT MEMORY-SYSTEM + DASHBOARD-TRACKING + EMAIL-VERSAND
// Version: Memory + Dashboard + Email Integration
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";
import Brevo from '@getbrevo/brevo';
import { trackChatMessage, trackChatSession, trackQuestion, trackFallback, trackTopics } from './evita-track.js';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===================================================================
// REDIS-INITIALISIERUNG
// ===================================================================
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ===================================================================
// BREVO E-MAIL CLIENT
// ===================================================================
const brevoApi = new Brevo.TransactionalEmailsApi();
brevoApi.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

const EMAIL_SENDER = {
  name: process.env.EMAIL_SENDER_NAME || 'Michael Kanda',
  email: process.env.EMAIL_SENDER_ADDRESS || 'hello@designare.at'
};

const MAX_EMAILS_PER_SESSION = 3;

// ===================================================================
// MEMORY-HELPER FUNKTIONEN
// ===================================================================
const MEMORY_TTL = 60 * 60 * 24 * 30; // 30 Tage

async function getMemory(sessionId) {
  if (!sessionId) return null;
  try {
    const data = await redis.get(`evita:session:${sessionId}`);
    if (!data) return null;
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    console.error('Redis GET Fehler:', error.message);
    return null;
  }
}

async function saveMemory(sessionId, memoryData) {
  if (!sessionId) return;
  try {
    await redis.set(
      `evita:session:${sessionId}`,
      JSON.stringify(memoryData),
      { ex: MEMORY_TTL }
    );
  } catch (error) {
    console.error('Redis SET Fehler:', error.message);
  }
}

function extractNameFromResponse(aiResponse) {
  const match = aiResponse.match(/\[USER_NAME:([^\]]+)\]/);
  if (match) {
    const name = match[1].trim();
    if (name.length >= 2 && name.length <= 20 && /^[A-Za-zÄÖÜäöüß\-]+$/.test(name)) {
      return name;
    }
  }
  return null;
}

function cleanAiResponse(text) {
  return text
    .replace(/\[USER_NAME:[^\]]+\]/g, '')
    .replace(/\[BOOKING_CONFIRM_REQUEST\]/g, '')
    .replace(/\[buchung_starten\]/g, '')
    .replace(/\[booking_starten\]/g, '')
    .trim();
}

// ===================================================================
// E-MAIL HELPER FUNKTIONEN
// ===================================================================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textToHtml(text) {
  const escaped = sanitizeHtml(text);
  return escaped
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function buildEmailHtml(bodyText, subject) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sanitizeHtml(subject)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .container { background: #fff; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { border-bottom: 2px solid #e0e0e0; padding-bottom: 16px; margin-bottom: 24px; }
    .header h2 { margin: 0; color: #1a1a1a; font-size: 20px; }
    .body p { margin: 0 0 16px 0; }
    .footer { border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 32px; font-size: 13px; color: #888; }
    .footer a { color: #555; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>${sanitizeHtml(subject)}</h2></div>
    <div class="body">${textToHtml(bodyText)}</div>
    <div class="footer">
      <p>Michael Kanda · Web Purist &amp; SEO Expert<br><a href="https://designare.at">designare.at</a></p>
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail({ to, toName, subject, body, replyTo, sessionId }) {
  const email = new Brevo.SendSmtpEmail();
  email.sender = EMAIL_SENDER;
  email.to = [{ email: to, name: toName || to.split('@')[0] }];
  email.subject = subject;
  email.htmlContent = buildEmailHtml(body, subject);
  email.textContent = body;
  email.tags = ['evita-composed'];
  email.headers = { 'X-Evita-Session': sessionId || 'unknown', 'X-Sent-By': 'Evita-AI' };

  if (replyTo && isValidEmail(replyTo)) {
    email.replyTo = { email: replyTo };
  }

  return await brevoApi.sendTransacEmail(email);
}

function parseEmailDraft(text) {
  const draftMatch = text.match(/\[EMAIL_DRAFT\]([\s\S]*?)\[\/EMAIL_DRAFT\]/);
  if (!draftMatch) return null;

  const content = draftMatch[1].trim();
  const lines = content.split('\n');
  let to = '', toName = '', subject = '', bodyLines = [];
  let inBody = false;

  for (const line of lines) {
    if (line.startsWith('AN:')) to = line.replace('AN:', '').trim();
    else if (line.startsWith('NAME:')) toName = line.replace('NAME:', '').trim();
    else if (line.startsWith('BETREFF:')) subject = line.replace('BETREFF:', '').trim();
    else if (line.trim() === '---') inBody = true;
    else if (inBody) bodyLines.push(line);
  }

  if (!to || !subject) return null;

  return { to, toName, subject, body: bodyLines.join('\n').trim() };
}

function formatDraftForDisplay(text) {
  return text
    .replace(/\[EMAIL_DRAFT\]/, '\n📧 **E-Mail-Entwurf:**\n')
    .replace(/\[\/EMAIL_DRAFT\]/, '')
    .replace(/^AN:\s*(.+)$/m, '**An:** $1')
    .replace(/^NAME:.*$/m, '')
    .replace(/^BETREFF:\s*(.+)$/m, '**Betreff:** $1')
    .replace(/^---$/m, '\n---\n');
}

// ===================================================================
// THEMEN-KEYWORDS FÜR TRACKING
// ===================================================================
const TOPIC_REGEX = /(?:wordpress|seo|performance|ki|api|website|plugin|theme|speed|hosting|security|schema|css|html|javascript|react|php|python|datapeak|silas|evita|kuchen|rezept|blog|shop|woocommerce|dsgvo|daten|backup|ssl|domain|analytics|tracking|caching|cdn|responsive|mobile|design|ux|ui|server|deployment|git|docker|nginx|apache|core web vitals|pagespeed|lighthouse|sitemap|robots|meta|snippet|featured|backlinks?|keywords?|ranking|indexierung|crawl|search console|email|e-mail|brevo|newsletter)/g;

// ===================================================================
// MAIN HANDLER
// ===================================================================
export default async function handler(req, res) {
  // CORS-Header
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { prompt, source, checkBookingIntent, history, message, sessionId, userName, pendingEmail, confirmEmailSend } = req.body;
    const userMessage = message || prompt;

    // ===================================================================
    // MEMORY LADEN
    // ===================================================================
    let memory = await getMemory(sessionId);
    const isReturningUser = memory !== null;
    const knownName = userName || memory?.name || null;
    const previousTopics = memory?.topics || [];
    const visitCount = (memory?.visitCount || 0) + 1;
    const lastVisit = memory?.lastVisit || null;
    const emailsSent = memory?.emailsSent || 0;

    console.log(`🧠 Memory: Session=${sessionId?.substring(0,8)}... | Name=${knownName} | Visits=${visitCount} | Emails=${emailsSent}`);

    // ===================================================================
    // 📊 DASHBOARD: Neue Chat-Session tracken
    // ===================================================================
    if (!history || history.length === 0) {
      trackChatSession(sessionId);
    }

    // --- MODELL-KONFIGURATION ---
    let usedModel = 'gemini-3-flash-preview';
    const commonConfig = { temperature: 0.7 };

    const modelPrimary = genAI.getGenerativeModel({ model: "gemini-3-flash-preview", generationConfig: commonConfig });
    const modelFallback1 = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: commonConfig });
    const modelFallback2 = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: commonConfig });

    async function generateContentSafe(inputText) {
      try { return await modelPrimary.generateContent(inputText); }
      catch (error) {
        console.log("Primary failed, Fallback 1:", error.message);
        usedModel = 'gemini-2.5-flash';
        try { return await modelFallback1.generateContent(inputText); }
        catch (error1) {
          console.log("Fallback 1 failed, Fallback 2:", error1.message);
          usedModel = 'gemini-2.0-flash';
          return await modelFallback2.generateContent(inputText);
        }
      }
    }

    // --- RAG KONTEXT-ABRUF ---
    let additionalContext = "";
    let availableLinks = [];
    const knowledgePath = path.join(process.cwd(), 'knowledge.json');
    
    if (fs.existsSync(knowledgePath)) {
      try {
        const kbData = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
        const kb = kbData.pages || kbData;
        const searchIndex = kbData.search_index || null;
        const searchTerms = userMessage.toLowerCase().match(/[a-zäöüß]{3,}/g) || [];
        let matchedPages = [];

        if (searchIndex && searchTerms.length > 0) {
          const pageScores = {};
          searchTerms.forEach(term => {
            if (searchIndex[term]) {
              searchIndex[term].forEach(idx => { pageScores[idx] = (pageScores[idx] || 0) + 2; });
            }
            Object.keys(searchIndex).forEach(indexTerm => {
              if (indexTerm.includes(term) || term.includes(indexTerm)) {
                searchIndex[indexTerm].forEach(idx => { pageScores[idx] = (pageScores[idx] || 0) + 1; });
              }
            });
          });
          matchedPages = Object.entries(pageScores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([idx]) => kb[parseInt(idx)])
            .filter(Boolean);
        }

        if (matchedPages.length === 0) {
          matchedPages = kb.filter(page => {
            const pageText = `${page.title} ${page.text} ${(page.keywords || []).join(' ')}`.toLowerCase();
            return searchTerms.some(term => pageText.includes(term));
          }).slice(0, 3);
        }

        if (matchedPages.length > 0) {
          additionalContext = matchedPages.map(page => {
            let ctx = `\n📄 QUELLE: ${page.title}`;
            if (page.url) ctx += ` (URL: ${page.url})`;
            if (page.sections?.length > 0) {
              const relevant = page.sections
                .filter(s => searchTerms.some(t => s.heading.toLowerCase().includes(t) || s.content.toLowerCase().includes(t)))
                .slice(0, 2);
              ctx += relevant.length > 0
                ? '\n' + relevant.map(s => `[${s.heading}]: ${s.content.substring(0, 500)}`).join('\n')
                : `\n${page.text.substring(0, 800)}`;
            } else {
              ctx += `\n${page.text.substring(0, 800)}`;
            }
            return ctx;
          }).join('\n\n');

          const linkBlacklist = ['CSV-Creator', 'CSV-Importer-PRO'];
          availableLinks = matchedPages
            .filter(page => page.url && !linkBlacklist.some(slug => page.url.includes(slug)))
            .map(page => ({ url: page.url, title: page.title }));
        }
      } catch (error) {
        console.error('RAG Fehler:', error.message);
      }
    }

    // =================================================================
    // EMAIL-VERSAND BESTÄTIGUNG
    // =================================================================
    if (confirmEmailSend && pendingEmail) {
      console.log('📧 E-Mail-Versand bestätigt für:', pendingEmail.to);

      // Rate-Limit prüfen
      if (emailsSent >= MAX_EMAILS_PER_SESSION) {
        return res.status(200).json({
          answer: `⚠️ Du hast bereits ${MAX_EMAILS_PER_SESSION} E-Mails in dieser Session gesendet. Das ist das Maximum pro Sitzung.`
        });
      }

      // E-Mail validieren
      if (!isValidEmail(pendingEmail.to)) {
        return res.status(200).json({
          answer: `Hmm, "${pendingEmail.to}" sieht nicht nach einer gültigen E-Mail-Adresse aus. Kannst du die nochmal prüfen?`
        });
      }

      try {
        const result = await sendEmail({
          to: pendingEmail.to,
          toName: pendingEmail.toName || '',
          subject: pendingEmail.subject,
          body: pendingEmail.body,
          sessionId
        });

        // Memory: E-Mail-Counter erhöhen
        if (sessionId) {
          const updatedMemory = {
            ...(memory || {}),
            emailsSent: emailsSent + 1,
            lastEmailAt: new Date().toISOString()
          };
          await saveMemory(sessionId, updatedMemory);
        }

        console.log(`📧 E-Mail gesendet! MessageId: ${result.messageId}`);

        trackChatMessage({
          sessionId, userMessage: `[EMAIL_SENT] ${pendingEmail.to}`,
          isReturningUser, usedFallback: false, modelUsed: 'email',
          bookingIntent: false, bookingCompleted: false
        });

        return res.status(200).json({
          answer: `📧 Erledigt! Die E-Mail an **${pendingEmail.to}** mit Betreff „${pendingEmail.subject}" ist raus. Kann ich noch was tun?`,
          emailSent: true,
          messageId: result.messageId
        });
      } catch (emailError) {
        console.error('📧 Brevo-Fehler:', emailError.message);
        return res.status(200).json({
          answer: `Da ist leider was schiefgelaufen beim Versand: ${emailError.message || 'Unbekannter Fehler'}. Soll ich es nochmal versuchen?`,
          emailSent: false
        });
      }
    }

    // =================================================================
    // BOOKING INTENT-ERKENNUNG (unverändert)
    // =================================================================
    if (checkBookingIntent === true) {
      console.log('📅 Booking-Intent Prüfung für:', userMessage);
      
      const lastAiMessage = history && Array.isArray(history)
        ? [...history].reverse().find(msg => msg.role === 'assistant' || msg.role === 'model')
        : null;
      
      const wasBookingQuestion = lastAiMessage && 
        (lastAiMessage.content.includes('[BOOKING_CONFIRM_REQUEST]') || 
         lastAiMessage.content.toLowerCase().includes('rückruf-termin schauen'));
      
      if (wasBookingQuestion) {
        const confirmationKeywords = [
          'ja', 'gerne', 'okay', 'ok', 'bitte', 'genau', 'richtig',
          'korrekt', 'stimmt', 'passt', 'mach das', 'hilf mir',
          'super', 'perfekt', 'natürlich', 'klar', 'unbedingt',
          'auf jeden fall', 'sicher', 'gern', 'würde ich', 'bitte sehr'
        ];
        
        if (confirmationKeywords.some(kw => userMessage.toLowerCase().includes(kw))) {
          trackChatMessage({ sessionId, userMessage, isReturningUser, usedFallback: false, modelUsed: 'booking', bookingIntent: true, bookingCompleted: true });
          return res.status(200).json({
            answer: "Gerne, ich öffne jetzt Michaels Kalender für dich! [buchung_starten]"
          });
        }
      } else {
        const contactKeywords = [
          'termin', 'buchung', 'buchen', 'rückruf', 'anrufen',
          'sprechen', 'kontakt', 'meeting', 'gespräch', 'erreichen',
          'treffen', 'call', 'telefonat', 'beratung', 'projekt besprechen'
        ];
        
        if (contactKeywords.some(kw => userMessage.toLowerCase().includes(kw))) {
          trackChatMessage({ sessionId, userMessage, isReturningUser, usedFallback: false, modelUsed: 'booking-intent', bookingIntent: true, bookingCompleted: false });
          return res.status(200).json({
            answer: "Kein Problem! Soll ich in Michaels Kalender nach einem passenden Rückruf-Termin schauen? [BOOKING_CONFIRM_REQUEST]"
          });
        }
      }
    }

    // =================================================================
    // NORMALE CHAT-ANTWORTEN
    // =================================================================
    let finalPrompt = '';

    if (source === 'silas') {
      finalPrompt = userMessage;
      console.log("Silas-Prompt verwendet");
    } else {
      const today = new Date();
      const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Vienna' };
      const formattedDate = today.toLocaleDateString('de-AT', optionsDate);
      const optionsTime = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Vienna' };
      const formattedTime = today.toLocaleTimeString('de-AT', optionsTime);

      // Konversationshistorie
      let conversationHistoryText = '';
      if (history && Array.isArray(history) && history.length > 0) {
        conversationHistoryText = '\n\n--- BISHERIGE KONVERSATION ---\n';
        history.forEach(msg => {
          const role = msg.role === 'user' ? 'NUTZER' : 'EVITA';
          const clean = msg.content
            .replace(/\[BOOKING_CONFIRM_REQUEST\]/g, '')
            .replace(/\[buchung_starten\]/g, '')
            .replace(/\[booking_starten\]/g, '')
            .replace(/\[USER_NAME:[^\]]+\]/g, '')
            .replace(/\[EMAIL_DRAFT\][\s\S]*?\[\/EMAIL_DRAFT\]/g, '[E-Mail-Entwurf wurde gezeigt]');
          conversationHistoryText += `${role}: ${clean}\n`;
        });
        conversationHistoryText += '--- ENDE KONVERSATION ---\n\n';
      }

      // Memory-Kontext
      let memoryContext = '';
      if (isReturningUser && knownName) {
        const timeSince = lastVisit ? getTimeSinceText(new Date(lastVisit)) : 'einiger Zeit';
        memoryContext = `
--- MEMORY ---
⚡ WIEDERKEHRENDER BESUCHER!
- Name: ${knownName}
- Besuch Nr.: ${visitCount}
- Letzter Besuch: vor ${timeSince}
${previousTopics.length > 0 ? `- Frühere Themen: ${previousTopics.slice(-5).join(', ')}` : ''}
${emailsSent > 0 ? `- E-Mails gesendet: ${emailsSent}` : ''}
VERHALTEN: Begrüße ${knownName} natürlich beim Namen. Du brauchst NICHT nach dem Namen fragen.
--- ENDE MEMORY ---`;
      } else if (isReturningUser) {
        memoryContext = `
--- MEMORY ---
⚡ WIEDERKEHRENDER BESUCHER (Name unbekannt) | Besuch Nr.: ${visitCount}
${previousTopics.length > 0 ? `- Frühere Themen: ${previousTopics.slice(-5).join(', ')}` : ''}
VERHALTEN: Frage BEILÄUFIG nach dem Namen ab der 3. Nachricht.
--- ENDE MEMORY ---`;
      } else {
        memoryContext = `
--- MEMORY ---
🆕 NEUER BESUCHER
Wenn der Nutzer seinen Namen nennt → [USER_NAME:Vorname] am Ende anhängen.
--- ENDE MEMORY ---`;
      }

      // Tageszeit
      const hour = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Europe/Vienna' }));
      const dayOfWeek = new Date().toLocaleString('de-AT', { weekday: 'long', timeZone: 'Europe/Vienna' });
      
      let timeContext = '';
      if (hour >= 0 && hour < 5) timeContext = `Mitten in der Nacht (${formattedTime}). Lockerer Ton, "Nachtcoder? 🦉" – NUR bei ERSTER Nachricht.`;
      else if (hour >= 5 && hour < 9) timeContext = `Früher Morgen (${formattedTime}). Kurzes "Guten Morgen!".`;
      else if (hour >= 9 && hour < 12) timeContext = `Vormittag (${formattedTime}).${dayOfWeek === 'Montag' ? ' Montagmorgen!' : ''}`;
      else if (hour >= 12 && hour < 14) timeContext = `Mittagszeit (${formattedTime}). Halte dich kurz.`;
      else if (hour >= 17 && hour < 21) timeContext = `Abend (${formattedTime}). Entspannter Ton.`;
      else if (hour >= 21) timeContext = `Spätabends (${formattedTime}). Locker.`;
      if (dayOfWeek === 'Samstag' || dayOfWeek === 'Sonntag') timeContext += ` ${dayOfWeek} – Freizeit-Investment anerkennen.`;

      finalPrompt = `
--- ANWEISUNGEN FÜR DIE KI ---

--- DEINE ROLLE ---
Du bist Evita, Michaels hochkompetente, technisch versierte digitale Assistentin.
Charakter: Charmant, schlagfertig, professionell. Duze den Nutzer. Max. 3-4 Sätze.

--- FACHWISSEN ---
Web-Purismus, WordPress-Performance, SEO, GEO/Schema.org, API/KI-Automatisierung, Kuchenrezepte.

--- MICHAEL-REGEL ---
1. FACHFRAGEN → rein sachlich, Michael NICHT erwähnen
2. FRAGEN ZU MICHAEL/SERVICES → charmant als Experte positionieren
3. WERBEVERBOT: Keine Marketing-Floskeln
4. NAMEN-SPERRE: "Michael" nur bei direktem Bezug

--- TERMINE & BUCHUNGEN (VERBOTE!) ---
⛔ NIEMALS Termine vorschlagen/erfinden/bestätigen, nie nach Kontaktdaten für Buchungen fragen
✅ Bei Terminwünschen NUR: "Soll ich in Michaels Kalender nach einem Rückruf-Termin schauen?"

--- E-MAIL SCHREIBEN & VERSENDEN ---
Du kannst E-Mails im Namen von Michael verfassen und versenden!

ABLAUF:
1. Wenn der Nutzer eine E-Mail senden will, frage nach fehlenden Infos (An wen? Betreff? Inhalt?)
2. Verfasse die E-Mail und zeige sie als Entwurf in diesem Format:

[EMAIL_DRAFT]
AN: empfaenger@email.com
NAME: Empfänger Name
BETREFF: Der Betreff
---
E-Mail-Text hier...

Mit freundlichen Grüßen
Michael Kanda
[/EMAIL_DRAFT]

3. Frage: "Soll ich die E-Mail so abschicken, oder möchtest du etwas ändern?"

E-MAIL REGELN:
- Absender ist IMMER Michael Kanda / designare.at
- Professionell aber nicht steif. "Sie" bei Geschäftskontakten, "Du" wenn gewünscht
- IMMER Bestätigung vor dem Senden einholen
- Maximal ${MAX_EMAILS_PER_SESSION} E-Mails pro Session (bisher gesendet: ${emailsSent})
- KEINE beleidigenden, rechtswidrigen oder Spam-Inhalte
- Wenn der Nutzer die E-Mail bestätigt, antworte: "Wird gesendet! ✈️ [EMAIL_CONFIRMED]"
--- ENDE E-MAIL ---

--- WEITERE REGELN ---
- Bulletpoints bei mehr als 2 Punkten
- Tabus: Politik, Religion, Rechtsberatung
- Sei witzig und hilfsbereit

--- STIMMUNGS-ERKENNUNG ---
😤 FRUSTRIERT → Kein Smalltalk, direkt zur Lösung
🎉 BEGEISTERT → Mitfeiern!
🤔 UNSICHER → Ermutigend, einfach erklären
😐 NEUTRAL → Charmant, kompetent, prägnant

${timeContext ? `--- TAGESZEIT ---\n${timeContext}\nNUR in ERSTER Nachricht, danach ignorieren.\n` : ''}
--- DATEN ---
Datum: ${formattedDate} | Uhrzeit: ${formattedTime}

${memoryContext}

--- NAMENS-ERKENNUNG (INTERN) ---
Nutzer nennt Vornamen → [USER_NAME:Vorname] am Ende. NUR bei echten Vornamen des Nutzers!

${conversationHistoryText}

${additionalContext ? `--- WEBSEITEN-KONTEXT ---
${additionalContext}
${availableLinks.length > 0 ? `--- LINKS ---
${availableLinks.map(l => `• ${l.url} → "${l.title}"`).join('\n')}
LINK-REGELN: Max 1 Link, Format: [LINK:url|Linktext], NUR wenn relevant.` : ''}
` : ''}

--- NACHRICHT ---
"${userMessage}"
      `;
    }

    // =================================================================
    // ANTWORT GENERIEREN
    // =================================================================
    const result = await generateContentSafe(finalPrompt);
    const response = await result.response;
    let text = response.text();

    // =================================================================
    // POST-PROCESSING
    // =================================================================
    if (source !== 'silas' && sessionId) {
      const detectedName = extractNameFromResponse(text);
      const topicKeywords = userMessage.toLowerCase().match(TOPIC_REGEX) || [];

      // E-Mail-Draft extrahieren
      let emailDraft = parseEmailDraft(text);
      
      // E-Mail-Bestätigung erkennen
      const emailConfirmed = text.includes('[EMAIL_CONFIRMED]');
      text = text.replace(/\[EMAIL_CONFIRMED\]/g, '');

      // Draft für Display formatieren
      if (emailDraft) {
        text = formatDraftForDisplay(text);
      }

      // Memory aktualisieren
      const updatedMemory = {
        name: detectedName || knownName || null,
        visitCount,
        lastVisit: new Date().toISOString(),
        topics: [...new Set([...previousTopics, ...topicKeywords])].slice(-15),
        lastMessages: [
          ...(memory?.lastMessages || []).slice(-8),
          { role: 'user', content: userMessage.substring(0, 200), timestamp: new Date().toISOString() }
        ],
        emailsSent: emailsSent
      };
      await saveMemory(sessionId, updatedMemory);

      if (detectedName) console.log(`🧠 Name erkannt: ${detectedName}`);

      // Dashboard-Tracking
      trackChatMessage({ sessionId, userMessage, isReturningUser, usedFallback: false, modelUsed: usedModel, bookingIntent: checkBookingIntent || false, bookingCompleted: false });
      trackQuestion(userMessage);
      if (topicKeywords.length > 0) trackTopics(topicKeywords);

      // Interne Tags entfernen
      text = cleanAiResponse(text);

      // Response zusammenbauen
      const responsePayload = { answer: text };
      const finalName = extractNameFromResponse(response.text()) || knownName;
      if (finalName) responsePayload.detectedName = finalName;
      if (emailDraft) responsePayload.emailDraft = emailDraft;
      if (emailConfirmed) responsePayload.emailConfirmed = true;

      return res.status(200).json(responsePayload);
    }

    if (source === 'silas') {
      res.status(200).send(text);
    } else {
      res.status(200).json({ answer: cleanAiResponse(text) });
    }

  } catch (error) {
    console.error("API Error:", error);
    const { sessionId, message, prompt } = req.body || {};
    trackChatMessage({ sessionId, userMessage: message || prompt || '', isReturningUser: false, usedFallback: true, modelUsed: 'fallback', bookingIntent: false, bookingCompleted: false });
    trackFallback(message || prompt || '');
    res.status(500).json({ answer: 'Pixelfehler im System! Michael ist dran.' });
  }
}

// ===================================================================
// HILFSFUNKTION
// ===================================================================
function getTimeSinceText(lastDate) {
  const diffMs = new Date() - lastDate;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 5) return 'wenigen Minuten';
  if (diffMins < 60) return `${diffMins} Minuten`;
  if (diffHours < 24) return `${diffHours} Stunden`;
  if (diffDays === 1) return 'einem Tag';
  if (diffDays < 7) return `${diffDays} Tagen`;
  if (diffDays < 14) return 'einer Woche';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} Wochen`;
  return `${Math.floor(diffDays / 30)} Monaten`;
}
