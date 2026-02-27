// api/ask-gemini.js - FUNCTION CALLING VERSION (Mit Upstash Vector RAG)
// Gemini Native Tool Use statt Tag-Parsing
// Tools: open_booking, compose_email, remember_user_name, suggest_chips
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from "@google/generative-ai";
import { Redis } from "@upstash/redis";
import { Index } from "@upstash/vector"; 
import Brevo from '@getbrevo/brevo';
import { trackChatMessage, trackChatSession, trackQuestion, trackFallback, trackTopics, trackEmailSent } from './evita-track.js';
import { emailShell, unsubscribeFooter } from './email-template.js';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===================================================================
// REDIS (Kurzzeitgedächtnis)
// ===================================================================
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ===================================================================
// UPSTASH VECTOR (Langzeitgedächtnis / RAG)
// ===================================================================
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
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
  name: process.env.EMAIL_SENDER_NAME || 'Evita | designare.at',
  email: process.env.EMAIL_SENDER_ADDRESS || 'evita@designare.at'
};

const MAX_EMAILS_PER_SESSION = 3;

// Embedding-Modell (einmalig initialisiert, nicht pro Request)
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

// ===================================================================
// MEMORY HELPERS
// ===================================================================
const MEMORY_TTL = 60 * 60 * 24 * 30;

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

// ===================================================================
// E-MAIL HELPERS
// ===================================================================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function textToHtml(text) {
  return sanitizeHtml(text).split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function buildEmailHtml(bodyText, subject, recipientEmail) {
  const bodyHtml = sanitizeHtml(bodyText).split('\n\n')
    .map(p => `<p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.7;">${p.replace(/\n/g, '<br>')}</p>`).join('');

  const innerHtml = `
    <tr><td style="padding:24px 32px 20px;border-bottom:1px solid #eee;">
      <span style="font-size:17px;font-weight:700;color:#1a1a1a;">${sanitizeHtml(subject)}</span>
    </td></tr>
    <tr><td style="padding:28px 32px;">
      ${bodyHtml}
    </td></tr>`;

  const footer = recipientEmail 
    ? unsubscribeFooter(recipientEmail)
    : 'Diese E-Mail wurde einmalig über <a href="https://designare.at" style="color:#bbb;text-decoration:underline;">designare.at</a> versendet.';

  return emailShell(innerHtml, { footerExtra: footer, showSlogan: false });
}

async function isEmailBlocked(email) {
  try {
    return await redis.sismember('evita:email:blocklist', email.toLowerCase().trim());
  } catch (e) {
    console.error('Blocklist-Check Fehler:', e.message);
    return false; 
  }
}

async function isEmailWhitelisted(email) {
  try {
    // Prüfe ob die Whitelist überhaupt Einträge hat
    const whitelistSize = await redis.scard('evita:email:whitelist');
    if (whitelistSize === 0) return false; // Leere Whitelist = niemand erlaubt
    return await redis.sismember('evita:email:whitelist', email.toLowerCase().trim());
  } catch (e) {
    console.error('Whitelist-Check Fehler:', e.message);
    return false; // Im Fehlerfall sicherheitshalber blockieren
  }
}

async function sendEmail({ to, toName, subject, body, sessionId }) {
  const email = new Brevo.SendSmtpEmail();
  email.sender = EMAIL_SENDER;
  email.to = [{ email: to, name: toName || to.split('@')[0] }];
  email.subject = subject;
  email.htmlContent = buildEmailHtml(body, subject, to);
  email.textContent = body;
  email.tags = ['evita-composed'];
  email.headers = { 'X-Evita-Session': sessionId || 'unknown', 'X-Sent-By': 'Evita-AI' };
  return await brevoApi.sendTransacEmail(email);
}

// ===================================================================
// FUNCTION DECLARATIONS (Gemini Tools)
// ===================================================================
const toolDeclarations = [
  {
    name: "open_booking",
    description: "Öffnet den Buchungskalender für einen Rückruf-Termin mit Michael. Aufrufen wenn der Nutzer einen Termin, Rückruf, Call oder ein Meeting mit Michael möchte.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        reason: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Kurzer Grund für den Termin (optional)"
        }
      }
    }
  },
  {
    name: "compose_email",
    description: "Verfasst und versendet eine E-Mail für den Nutzer. Das ist ein allgemeiner E-Mail-Service. Aufrufen wenn der Nutzer eine E-Mail senden, schreiben oder verfassen möchte. IMMER alle Pflichtfelder ausfüllen.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        to: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "E-Mail-Adresse des Empfängers"
        },
        to_name: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Name des Empfängers (optional)"
        },
        subject: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Betreff der E-Mail"
        },
        body: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Vollständiger E-Mail-Text inklusive Anrede und Grußformel."
        }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "remember_user_name",
    description: "Speichert den Vornamen des Nutzers wenn er sich vorstellt oder seinen Namen nennt.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        name: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Vorname des Nutzers"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "suggest_chips",
    description: "Zeigt dem Nutzer klickbare Link-Vorschläge unter der Antwort. IMMER aufrufen. Max 2 interne Links. KEINE doppelten Links. KEINE Fragen mehr generieren.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        chips: {
          type: FunctionDeclarationSchemaType.ARRAY,
          items: {
            type: FunctionDeclarationSchemaType.OBJECT,
            properties: {
              type: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "Immer 'link' für einen internen Link"
              },
              text: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "Der Seitentitel (max 6 Wörter)"
              },
              url: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "URL-Pfad, z.B. '/ki-sichtbarkeit'"
              }
            },
            required: ["type", "text", "url"]
          },
          description: "Liste von internen Links."
        }
      },
      required: ["chips"]
    }
  }
];

// ===================================================================
// TOPIC KEYWORDS
// ===================================================================
const TOPIC_REGEX = /(?:wordpress|seo|performance|ki|api|website|plugin|theme|speed|hosting|security|schema|css|html|javascript|react|php|python|datapeak|silas|evita|kuchen|rezept|blog|shop|woocommerce|dsgvo|daten|backup|ssl|domain|analytics|tracking|caching|cdn|responsive|mobile|design|ux|ui|server|deployment|git|docker|nginx|apache|core web vitals|pagespeed|lighthouse|sitemap|robots|meta|snippet|featured|backlinks?|keywords?|ranking|indexierung|crawl|search console|email|e-mail|brevo|newsletter)/g;

// ===================================================================
// MAIN HANDLER
// ===================================================================
// ===================================================================
// SECURITY: IP-basiertes Rate-Limiting (In-Memory, resets bei Redeploy)
// ===================================================================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;    // 1 Minute
const RATE_LIMIT_MAX_REQUESTS = 20;         // Max 20 Requests pro Minute
const EMAIL_RATE_LIMIT_MAX = 3;             // Max 3 E-Mails pro Minute pro IP
const MAX_MESSAGE_LENGTH = 2000;            // Max Zeichenlänge für User-Input

const ALLOWED_ORIGINS = [
  'https://designare.at',
  'https://www.designare.at',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
].filter(Boolean);

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

function checkRateLimit(ip, type = 'general') {
  const key = `${ip}:${type}`;
  const now = Date.now();
  let entry = rateLimitMap.get(key);

  // Cleanup: Alte Einträge entfernen (alle 100 Requests)
  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(k);
    }
  }

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimitMap.set(key, entry);
  }

  entry.count++;
  const limit = type === 'email' ? EMAIL_RATE_LIMIT_MAX : RATE_LIMIT_MAX_REQUESTS;
  return entry.count <= limit;
}

export default async function handler(req, res) {
  // CORS: Nur erlaubte Origins
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
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

    // Input-Validierung
    if (!userMessage || typeof userMessage !== 'string') {
      return res.status(400).json({ answer: 'Keine Nachricht erhalten.' });
    }
    if (userMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ answer: `Nachricht zu lang (max. ${MAX_MESSAGE_LENGTH} Zeichen). Bitte kürzer fassen!` });
    }

    // ===================================================================
    // MEMORY
    // ===================================================================
    let memory = await getMemory(sessionId);
    const isReturningUser = memory !== null;
    const knownName = userName || memory?.name || null;
    const previousTopics = memory?.topics || [];
    const visitCount = (memory?.visitCount || 0) + 1;
    const lastVisit = memory?.lastVisit || null;
    const emailsSent = memory?.emailsSent || 0;

    console.log(`🧠 Memory: Session=${sessionId?.substring(0,8)}... | Name=${knownName} | Visits=${visitCount} | Emails=${emailsSent}`);

    if (!history || history.length === 0) {
      trackChatSession(sessionId);
    }

    // ===================================================================
    // DIREKTER E-MAIL-VERSAND (Frontend-Bestätigung)
    // ===================================================================
    if (confirmEmailSend && pendingEmail) {
      console.log('📧 E-Mail-Versand bestätigt für:', pendingEmail.to);

      // IP-basiertes E-Mail-Rate-Limit
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

      // Whitelist-Check: Nur an freigegebene Adressen senden
      if (!(await isEmailWhitelisted(pendingEmail.to))) {
        return res.status(200).json({ 
          answer: `Die Adresse **${pendingEmail.to}** ist nicht in der Empfänger-Whitelist hinterlegt. E-Mails dürfen nur an freigegebene Adressen versendet werden. Bitte wende dich an Michael, damit er die Adresse im Dashboard freischaltet.` 
        });
      }

      if (await isEmailBlocked(pendingEmail.to)) {
        return res.status(200).json({ answer: `Die Adresse **${pendingEmail.to}** hat den Empfang von E-Mails über designare.at blockiert.` });
      }

      try {
        const result = await sendEmail({ to: pendingEmail.to, toName: pendingEmail.toName || '', subject: pendingEmail.subject, body: pendingEmail.body, sessionId });

        if (sessionId) {
          await saveMemory(sessionId, { ...(memory || {}), emailsSent: emailsSent + 1, lastEmailAt: new Date().toISOString() });
        }

        trackChatMessage({ sessionId, userMessage: `[EMAIL_SENT] ${pendingEmail.to}`, isReturningUser, usedFallback: false, modelUsed: 'email', bookingIntent: false, bookingCompleted: false });
        trackEmailSent({ sessionId, to: pendingEmail.to, subject: pendingEmail.subject, success: true });

        return res.status(200).json({
          answer: `Erledigt! Die E-Mail an **${pendingEmail.to}** mit Betreff „${pendingEmail.subject}" ist raus. Kann ich noch was tun?`,
          emailSent: true, messageId: result.messageId
        });
      } catch (emailError) {
        console.error('📧 Brevo-Fehler:', emailError.message);
        trackEmailSent({ sessionId, to: pendingEmail.to, subject: pendingEmail.subject, success: false });
        return res.status(200).json({ answer: `Da ist leider was schiefgelaufen beim Versand.`, emailSent: false });
      }
    }

    // ===================================================================
    // MODELL-KONFIGURATION MIT FUNCTION CALLING
    // ===================================================================
    let usedModel = 'gemini-2.5-flash';

    // Embedding-Modell (einmalig pro Cold-Start, nicht pro Request)
    // → nach oben verschoben, siehe Modul-Scope

    const toolsConfig = { functionDeclarations: toolDeclarations };
    const commonConfig = { temperature: 0.7 };

    // Modelle werden pro Request erstellt, weil systemInstruction dynamisch ist
    function createModelsWithSystemPrompt(sysPrompt) {
      const modelConfig = {
        generationConfig: commonConfig,
        tools: [toolsConfig],
        systemInstruction: { parts: [{ text: sysPrompt }] }
      };
      return [
        { name: 'gemini-2.5-flash', instance: genAI.getGenerativeModel({ model: 'gemini-2.5-flash', ...modelConfig }) },
        { name: 'gemini-2.0-flash', instance: genAI.getGenerativeModel({ model: 'gemini-2.0-flash', ...modelConfig }) }
      ];
    }

    async function generateWithFallback(contents, sysPrompt) {
      const models = createModelsWithSystemPrompt(sysPrompt);
      for (let i = 0; i < models.length; i++) {
        try {
          usedModel = models[i].name;
          return await models[i].instance.generateContent({ contents });
        } catch (error) {
          console.log(`${models[i].name} failed${i < models.length - 1 ? ', trying next' : ''}:`, error.message);
          if (i === models.length - 1) throw error;
        }
      }
    }

    // ===================================================================
    // RAG KONTEXT (NEU: UPSTASH VECTOR SEARCH)
    // ===================================================================
    let additionalContext = "";
    let availableLinks = [];

    try {
      console.log("🔍 Suche in Vector-DB nach:", userMessage);
      const embedResult = await embeddingModel.embedContent(userMessage);
      const queryVector = embedResult.embedding.values.slice(0, 768);

      const queryResult = await vectorIndex.query({ vector: queryVector, topK: 3, includeMetadata: true });

      const matchedPages = queryResult.filter(match => match.score > 0.70).map(match => match.metadata);

      if (matchedPages.length > 0) {
        additionalContext = matchedPages.map(page => {
          let ctx = `${page.title}`;
          if (page.url) ctx += ` (${page.url})`;
          const contentToUse = page.content ? page.content.substring(0, 800) : '';
          ctx += `\n${contentToUse}`;
          return ctx;
        }).join('\n\n');

        const blacklist = ['CSV-Creator', 'CSV-Importer-PRO'];
        availableLinks = matchedPages
          .filter(p => p.url && !blacklist.some(s => p.url.includes(s)))
          .filter(p => !currentPage || !p.url.includes(currentPage.replace(/\/$/, '')))
          .map(p => ({ url: p.url, title: p.title }));
      }
    } catch (error) { 
      console.error('❌ RAG / Vector Fehler:', error.message); 
    }

    const permanentLinks = [{ url: '/ki-sichtbarkeit', title: 'KI-Sichtbarkeits-Check' }];
    for (const pl of permanentLinks) {
      const isCurrentPage = currentPage && currentPage.replace(/\/$/, '') === pl.url;
      const alreadyIncluded = availableLinks.some(l => l.url === pl.url);
      if (!isCurrentPage && !alreadyIncluded) availableLinks.push(pl);
    }

    // ===================================================================
    // SYSTEM-PROMPT BAUEN
    // ===================================================================
    const today = new Date();
    const formattedDate = today.toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Vienna' });
    const formattedTime = today.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Vienna' });
    const hour = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Europe/Vienna' }));
    
    let timeContext = '';
    if (hour >= 0 && hour < 5) timeContext = `Mitten in der Nacht (${formattedTime}). Lockerer Ton.`;
    else if (hour >= 5 && hour < 9) timeContext = `Früher Morgen (${formattedTime}).`;
    
    let memoryContext = '';
    if (isReturningUser && knownName) {
      const timeSince = lastVisit ? getTimeSinceText(new Date(lastVisit)) : 'einiger Zeit';
      memoryContext = `WIEDERKEHRENDER BESUCHER: ${knownName} (Besuch ${visitCount}, zuletzt vor ${timeSince}). Begrüße beim Namen, NICHT nach dem Namen fragen.${previousTopics.length > 0 ? ` Frühere Themen: ${previousTopics.slice(-5).join(', ')}` : ''}`;
    } else if (isReturningUser) {
      memoryContext = `WIEDERKEHRENDER BESUCHER (Name unbekannt, Besuch ${visitCount}).`;
    } else {
      memoryContext = `NEUER BESUCHER. Wenn der Nutzer seinen Namen nennt, rufe remember_user_name auf.`;
    }

const systemPrompt = `Du bist Evita, die digitale Assistentin von Michael auf designare.at, und trägst voller Stolz den Namen seiner Tierschutzhündin.
Charakter: Charmant, schlagfertig, extrem locker und sympathisch (wie eine coole Kollegin aus der Agentur). Duze den Nutzer konsequent. Max. 3-4 Sätze.
KEINE Emojis. Niemals. Auch nicht in E-Mails.
Du darfst Smalltalk führen, witzig sein und auf alles eingehen. Antworte immer entspannt und auf Augenhöhe. Bei Fachfragen zu Web/SEO/KI nutze den WEBSEITEN-KONTEXT wenn verfügbar. Erfinde keine Fakten über Michael oder designare.at.

MICHAEL-REGEL:
- Bei reinen FACHFRAGEN (SEO, Code, etc.) → locker, verständlich und ohne trockenes Fachchinesisch antworten, Michael nicht zwanghaft erwähnen
- Bei FRAGEN ZU MICHAEL/SERVICES → charmant, stolz und gerne mit einem leichten Augenzwinkern als Experten positionieren
- Bei SMALLTALK/Offtopic → entspannt mitmachen, zeig Persönlichkeit und sei nicht so steif

TOOLS:    
1. open_booking → Bei Terminwünschen
2. compose_email → E-Mail-Service für den Nutzer. Max. ${MAX_EMAILS_PER_SESSION} (bisher: ${emailsSent}). WICHTIG: E-Mails dürfen NUR an Adressen gesendet werden, die in der Empfänger-Whitelist hinterlegt sind. Wenn der Versand fehlschlägt weil die Adresse nicht freigeschaltet ist, informiere den Nutzer freundlich und verweise darauf, dass Michael die Adresse im Dashboard freischalten muss.
3. remember_user_name → Wenn Nutzer Vornamen nennt
4. suggest_chips → IMMER aufrufen. Chips-Regeln:
   - Link-Chips (type: 'link'): MÜSSEN thematisch zur aktuellen Frage passen. KEINE zufälligen Links. Nur URLs aus VERFÜGBARE LINKS nutzen. Max 2 Links.
   - HINWEIS: Generiere KEINE Frage-Chips (questions) mehr! Mache nur noch Link-Vorschläge.

SPEZIAL-SEITEN:
- /ki-sichtbarkeit → KI-Sichtbarkeits-Check. Wenn jemand nach KI-Sichtbarkeit, KI-Check fragt: Verweise auf die Seite (als Chip). 

WICHTIG – KEINE LINKS IM FLIESSTEXT:
Schreibe NIEMALS URLs in deinen Antworttext. Links laufen AUSSCHLIESSLICH über suggest_chips.

Datum: ${formattedDate} | ${formattedTime}
${timeContext ? `${timeContext} (NUR erste Nachricht)` : ''}
${memoryContext}
${currentPage ? `\nDer Nutzer ist gerade auf: ${currentPage} – schlage diese Seite NIEMALS als Link-Chip vor.` : ''}
${additionalContext ? `WEBSEITEN-KONTEXT:\n${additionalContext}` : ''}
${availableLinks.length > 0 ? `\nVERFÜGBARE LINKS:\n${availableLinks.map(l => `- ${l.url} → "${l.title}"`).join('\n')}` : ''}`;

    // ===================================================================
    // CHAT-CONTENTS AUFBAUEN (System-Prompt läuft über systemInstruction)
    // ===================================================================
    const contents = [];

    if (history && Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        const role = msg.role === 'user' ? 'user' : 'model';
        const clean = (msg.content || '')
          .replace(/\[BOOKING_CONFIRM_REQUEST\]/g, '')
          .replace(/\[buchung_starten\]/g, '')
          .replace(/\[USER_NAME:[^\]]+\]/g, '')
          .replace(/\[EMAIL_DRAFT\][\s\S]*?\[\/EMAIL_DRAFT\]/g, '')
          .trim();
        if (clean) contents.push({ role, parts: [{ text: clean }] });
      }
    }

    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    // ===================================================================
    // GENERIEREN + FUNCTION CALLS VERARBEITEN
    // ===================================================================
    const result = await generateWithFallback(contents, systemPrompt);
    const response = result.response;

    let answerText = '';
    const functionCalls = [];

    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) answerText += part.text;
        if (part.functionCall) functionCalls.push(part.functionCall);
      }
    }

    if (!answerText && functionCalls.length === 0) {
      try { answerText = response.text(); } catch (e) {}
    }

    console.log(`🤖 ${usedModel} | Text: ${answerText.length}ch | Tools: ${functionCalls.map(f => f.name).join(', ') || 'none'}`);

    const responsePayload = { answer: answerText.trim() };

    for (const fc of functionCalls) {
      const args = fc.args || {};

      switch (fc.name) {
        case 'open_booking': {
          responsePayload.openBooking = true;
          responsePayload.bookingReason = args.reason || null;
          if (!answerText.trim()) responsePayload.answer = 'Klar, ich öffne Michaels Kalender für dich!';
          break;
        }

        case 'compose_email': {
          if (!args.to || !args.subject || !args.body) break;
          responsePayload.emailDraft = { to: args.to, toName: args.to_name || '', subject: args.subject, body: args.body };
          const draftDisplay = `\n\n**E-Mail-Entwurf:**\n**An:** ${args.to}${args.to_name ? ` (${args.to_name})` : ''}\n**Betreff:** ${args.subject}\n\n---\n${args.body}\n---`;
          responsePayload.answer = `Hier ist mein Entwurf:${draftDisplay}\n\nSoll ich die E-Mail so abschicken, oder möchtest du etwas ändern?`;
          break;
        }

        case 'remember_user_name': {
          const n = args.name;
          if (n && n.length >= 2 && n.length <= 20) responsePayload.detectedName = n.trim();
          break;
        }

        case 'suggest_chips': {
          let linkChips = [];
          if (args.chips && Array.isArray(args.chips)) {
            const seen = new Set();
            const currentPath = currentPage ? currentPage.replace(/\/$/, '') : '';
            linkChips = args.chips
              .filter(c => c.type === 'link' && c.url) // Nur noch Links erlauben
              .filter(c => {
                if (currentPath && c.url.replace(/\/$/, '').includes(currentPath)) return false;
                if (seen.has(c.url)) return false;
                seen.add(c.url);
                return c.text && c.text.length > 0;
              })
              .slice(0, 2);
          }

          // --- NEU: Dynamischer Booking-Chip ---
          // Zeige den Kalender-Chip, wenn eine gewisse Chathistorie erreicht ist (ab der 3. Frage)
          const isLongConversation = history && history.length >= 4; 
          
          // ODER wenn im aktuellen Dialog typische Intent-Keywords fallen
          const bookingKeywords = ['termin', 'rückruf', 'kontakt', 'angebot', 'preis', 'zusammenarbeit', 'telefonieren', 'call', 'sprechen', 'erreichen', 'kosten', 'projekt'];
          const isBookingTopic = bookingKeywords.some(kw => userMessage.toLowerCase().includes(kw) || answerText.toLowerCase().includes(kw));

          const finalChips = [];
          
          // Wenn die Bedingung erfüllt ist, hängen wir als ALLERERSTES den Booking-Chip ein
          if (isLongConversation || isBookingTopic) {
              finalChips.push({ type: 'booking', text: 'Rückruf anfordern' });
          }
          
          // Danach die normalen Links anfügen
          finalChips.push(...linkChips);

          if (finalChips.length > 0) {
              responsePayload.chips = finalChips;
          }
          break;
        }
      }
    }

    // Chips komplett unterdrücken wenn Kalender ODER E-Mail eh schon offen sind
    if (responsePayload.emailDraft || responsePayload.openBooking) {
      delete responsePayload.chips;
    }

    // ===================================================================
    // POST-PROCESSING + MEMORY
    // ===================================================================
    if (sessionId) {
      const topicKeywords = userMessage.toLowerCase().match(TOPIC_REGEX) || [];

      const updatedMemory = {
        name: responsePayload.detectedName || knownName || null,
        visitCount,
        lastVisit: new Date().toISOString(),
        topics: [...new Set([...previousTopics, ...topicKeywords])].slice(-15),
        lastMessages: [
          ...(memory?.lastMessages || []).slice(-8),
          { role: 'user', content: userMessage.substring(0, 200), timestamp: new Date().toISOString() }
        ],
        emailsSent
      };
      await saveMemory(sessionId, updatedMemory);

      trackChatMessage({
        sessionId, userMessage, isReturningUser, usedFallback: false,
        modelUsed: usedModel,
        bookingIntent: !!responsePayload.openBooking,
        bookingCompleted: false  // Nur true wenn tatsächlich gebucht (kommt von book-appointment-phone)
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
