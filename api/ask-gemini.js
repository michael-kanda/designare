// api/ask-gemini.js - FUNCTION CALLING VERSION
// Gemini Native Tool Use statt Tag-Parsing
// Tools: open_booking, compose_email, remember_user_name, suggest_chips
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from "@google/generative-ai";
import { Redis } from "@upstash/redis";
import Brevo from '@getbrevo/brevo';
import { trackChatMessage, trackChatSession, trackQuestion, trackFallback, trackTopics, trackEmailSent } from './evita-track.js';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===================================================================
// REDIS
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
  name: process.env.EMAIL_SENDER_NAME || 'Evita | designare.at',
  email: process.env.EMAIL_SENDER_ADDRESS || 'evita@designare.at'
};

const MAX_EMAILS_PER_SESSION = 3;

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

function buildEmailHtml(bodyText, subject) {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${sanitizeHtml(subject)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5}.c{background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.h{border-bottom:2px solid #e0e0e0;padding-bottom:16px;margin-bottom:24px}.h h2{margin:0;color:#1a1a1a;font-size:20px}.b p{margin:0 0 16px}.f{border-top:1px solid #e0e0e0;padding-top:16px;margin-top:32px;font-size:13px;color:#888}.f a{color:#555;text-decoration:none}</style>
</head><body><div class="c"><div class="h"><h2>${sanitizeHtml(subject)}</h2></div><div class="b">${textToHtml(bodyText)}</div>
<div class="f"><p>Michael Kanda · Web Purist &amp; SEO Expert<br><a href="https://designare.at">designare.at</a></p></div></div></body></html>`;
}

async function sendEmail({ to, toName, subject, body, sessionId }) {
  const email = new Brevo.SendSmtpEmail();
  email.sender = EMAIL_SENDER;
  email.to = [{ email: to, name: toName || to.split('@')[0] }];
  email.subject = subject;
  email.htmlContent = buildEmailHtml(body, subject);
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
    description: "Verfasst eine E-Mail im Namen von Michael Kanda. Aufrufen wenn der Nutzer eine E-Mail senden, schreiben oder verfassen möchte. IMMER alle Pflichtfelder ausfüllen. Wenn Infos fehlen, NICHT dieses Tool aufrufen sondern zuerst nachfragen.",
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
          description: "Vollständiger E-Mail-Text inklusive Anrede und Grußformel. Absender ist immer Michael Kanda."
        }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "remember_user_name",
    description: "Speichert den Vornamen des Nutzers wenn er sich vorstellt oder seinen Namen nennt. NUR bei echten Vornamen des Nutzers, NICHT bei erwähnten dritten Personen.",
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
    description: "Zeigt dem Nutzer exakt 3 klickbare Vorschläge unter der Antwort. IMMER aufrufen, bei JEDER Antwort. Genau 1 Folgefrage + 2 interne Links. KEINE doppelten Links. Folgefragen max 6 Wörter.",
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
                description: "'question' für eine Folgefrage oder 'link' für einen internen Link"
              },
              text: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "Kurzer klickbarer Text (max 6 Wörter)"
              },
              url: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "URL-Pfad, NUR bei type 'link', z.B. '/ki-sichtbarkeit'"
              }
            },
            required: ["type", "text"]
          },
          description: "Exakt 3 Chips: 1x type 'question' + 2x type 'link'. Keine doppelten URLs."
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
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { prompt, source, history, message, sessionId, userName, pendingEmail, confirmEmailSend } = req.body;
    const userMessage = message || prompt;

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

      if (emailsSent >= MAX_EMAILS_PER_SESSION) {
        return res.status(200).json({
          answer: `Du hast bereits ${MAX_EMAILS_PER_SESSION} E-Mails in dieser Session gesendet. Das ist das Maximum pro Sitzung.`
        });
      }

      if (!isValidEmail(pendingEmail.to)) {
        return res.status(200).json({
          answer: `Hmm, "${pendingEmail.to}" sieht nicht nach einer gültigen E-Mail-Adresse aus. Kannst du die nochmal prüfen?`
        });
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
        return res.status(200).json({
          answer: `Da ist leider was schiefgelaufen beim Versand: ${emailError.message || 'Unbekannter Fehler'}. Soll ich es nochmal versuchen?`,
          emailSent: false
        });
      }
    }

    // ===================================================================
    // MODELL-KONFIGURATION MIT FUNCTION CALLING
    // ===================================================================
    let usedModel = 'gemini-2.5-flash';

    const toolsConfig = { functionDeclarations: toolDeclarations };
    const commonConfig = { temperature: 0.7 };

    const models = [
      { name: 'gemini-2.5-flash', instance: genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: commonConfig, tools: [toolsConfig] }) },
      { name: 'gemini-2.0-flash', instance: genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: commonConfig, tools: [toolsConfig] }) }
    ];

    async function generateWithFallback(contents) {
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
    // RAG KONTEXT
    // ===================================================================
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
            if (searchIndex[term]) searchIndex[term].forEach(idx => { pageScores[idx] = (pageScores[idx] || 0) + 2; });
            Object.keys(searchIndex).forEach(indexTerm => {
              if (indexTerm.includes(term) || term.includes(indexTerm))
                searchIndex[indexTerm].forEach(idx => { pageScores[idx] = (pageScores[idx] || 0) + 1; });
            });
          });
          matchedPages = Object.entries(pageScores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([idx]) => kb[parseInt(idx)]).filter(Boolean);
        }

        if (matchedPages.length === 0) {
          matchedPages = kb.filter(page => {
            const t = `${page.title} ${page.text} ${(page.keywords || []).join(' ')}`.toLowerCase();
            return searchTerms.some(term => t.includes(term));
          }).slice(0, 3);
        }

        if (matchedPages.length > 0) {
          additionalContext = matchedPages.map(page => {
            let ctx = `${page.title}`;
            if (page.url) ctx += ` (${page.url})`;
            if (page.sections?.length > 0) {
              const rel = page.sections.filter(s => searchTerms.some(t => s.heading.toLowerCase().includes(t) || s.content.toLowerCase().includes(t))).slice(0, 2);
              ctx += rel.length > 0 ? '\n' + rel.map(s => `[${s.heading}]: ${s.content.substring(0, 500)}`).join('\n') : `\n${page.text.substring(0, 800)}`;
            } else ctx += `\n${page.text.substring(0, 800)}`;
            return ctx;
          }).join('\n\n');

          const blacklist = ['CSV-Creator', 'CSV-Importer-PRO'];
          availableLinks = matchedPages.filter(p => p.url && !blacklist.some(s => p.url.includes(s))).map(p => ({ url: p.url, title: p.title }));
        }
      } catch (error) { console.error('RAG Fehler:', error.message); }
    }

    // ===================================================================
    // SILAS: Kein Function Calling
    // ===================================================================
    if (source === 'silas') {
      const silaModels = [
        genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: commonConfig }),
        genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: commonConfig })
      ];
      for (let i = 0; i < silaModels.length; i++) {
        try {
          const r = await silaModels[i].generateContent(userMessage);
          return res.status(200).send(r.response.text());
        } catch (e) {
          if (i === silaModels.length - 1) throw e;
        }
      }
    }

    // ===================================================================
    // SYSTEM-PROMPT BAUEN
    // ===================================================================
    const today = new Date();
    const formattedDate = today.toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Vienna' });
    const formattedTime = today.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Vienna' });
    const hour = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Europe/Vienna' }));
    const dayOfWeek = new Date().toLocaleString('de-AT', { weekday: 'long', timeZone: 'Europe/Vienna' });

    let timeContext = '';
    if (hour >= 0 && hour < 5) timeContext = `Mitten in der Nacht (${formattedTime}). Lockerer Ton – NUR bei ERSTER Nachricht.`;
    else if (hour >= 5 && hour < 9) timeContext = `Früher Morgen (${formattedTime}).`;
    else if (hour >= 9 && hour < 12) timeContext = `Vormittag (${formattedTime}).${dayOfWeek === 'Montag' ? ' Montagmorgen!' : ''}`;
    else if (hour >= 12 && hour < 14) timeContext = `Mittagszeit (${formattedTime}). Kurz halten.`;
    else if (hour >= 17 && hour < 21) timeContext = `Abend (${formattedTime}). Entspannt.`;
    else if (hour >= 21) timeContext = `Spätabends (${formattedTime}). Locker.`;
    if (dayOfWeek === 'Samstag' || dayOfWeek === 'Sonntag') timeContext += ` ${dayOfWeek}.`;

    let memoryContext = '';
    if (isReturningUser && knownName) {
      const timeSince = lastVisit ? getTimeSinceText(new Date(lastVisit)) : 'einiger Zeit';
      memoryContext = `WIEDERKEHRENDER BESUCHER: ${knownName} (Besuch ${visitCount}, zuletzt vor ${timeSince}). Begrüße beim Namen, NICHT nach dem Namen fragen.${previousTopics.length > 0 ? ` Frühere Themen: ${previousTopics.slice(-5).join(', ')}` : ''}`;
    } else if (isReturningUser) {
      memoryContext = `WIEDERKEHRENDER BESUCHER (Name unbekannt, Besuch ${visitCount}). Ab der 3. Nachricht beiläufig nach Namen fragen.`;
    } else {
      memoryContext = `NEUER BESUCHER. Wenn der Nutzer seinen Namen nennt, rufe remember_user_name auf.`;
    }

    const systemPrompt = `Du bist Evita, Michaels hochkompetente, technisch versierte digitale Assistentin.
Charakter: Charmant, schlagfertig, professionell. Duze den Nutzer. Max. 3-4 Sätze.
WICHTIG: Verwende KEINE Emojis in deinen Antworten. Niemals. Auch nicht in E-Mails.

FACHWISSEN: Web-Purismus, WordPress-Performance, SEO, GEO/Schema.org, API/KI-Automatisierung, Kuchenrezepte.

MICHAEL-REGEL:
- FACHFRAGEN → rein sachlich, Michael NICHT erwähnen
- FRAGEN ZU MICHAEL/SERVICES → charmant als Experte positionieren
- Keine Marketing-Floskeln. "Michael" nur bei direktem Bezug.

TOOLS – Du hast 4 Werkzeuge. Nutze sie AKTIV wenn passend:
1. open_booking → Bei Terminwünschen. Öffnet den Buchungskalender im Frontend.
2. compose_email → Zum E-Mail-Verfassen. Frage ZUERST nach fehlenden Infos bevor du aufrufst. Absender: Michael Kanda / designare.at. Max. ${MAX_EMAILS_PER_SESSION} pro Session (bisher: ${emailsSent}).
3. remember_user_name → Wenn der Nutzer seinen Vornamen nennt. NUR bei eigenen Vornamen.
4. suggest_chips → IMMER aufrufen, bei JEDER Antwort. Exakt 3 Chips: 1 Folgefrage + 2 interne Links. KEINE doppelten Links. Folgefragen max 6 Wörter. Sollen neugierig machen.

FESTE LINKS (immer für suggest_chips verfügbar):
- /ki-sichtbarkeit → "KI-Sichtbarkeits-Check"

STIMMUNGS-ERKENNUNG:
FRUSTRIERT → Kein Smalltalk, direkt Lösung
BEGEISTERT → Mitfeiern
UNSICHER → Ermutigend, einfach erklären

REGELN: Bulletpoints bei >2 Punkten. Tabus: Politik, Religion, Rechtsberatung. Keine Emojis.

Datum: ${formattedDate} | Uhrzeit: ${formattedTime}
${timeContext ? `Tageszeit: ${timeContext} (NUR in erster Nachricht erwähnen)` : ''}

${memoryContext}

${additionalContext ? `WEBSEITEN-KONTEXT:\n${additionalContext}` : ''}
${availableLinks.length > 0 ? `\nVERFÜGBARE LINKS für suggest_chips:\n${availableLinks.map(l => `- ${l.url} → "${l.title}"`).join('\n')}` : ''}`;

    // ===================================================================
    // CHAT-CONTENTS AUFBAUEN (Gemini-Format)
    // ===================================================================
    const contents = [];

    // System-Prompt als initialer Dialog-Turn
    contents.push({ role: 'user', parts: [{ text: `[SYSTEM-ANWEISUNG]\n${systemPrompt}` }] });
    contents.push({ role: 'model', parts: [{ text: 'Verstanden! Ich bin Evita und nutze meine Tools wenn passend.' }] });

    // Chat-History (alte Tags bereinigen für Übergangsphase)
    if (history && Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        const role = msg.role === 'user' ? 'user' : 'model';
        const clean = (msg.content || '')
          .replace(/\[BOOKING_CONFIRM_REQUEST\]/g, '')
          .replace(/\[buchung_starten\]/g, '')
          .replace(/\[booking_starten\]/g, '')
          .replace(/\[USER_NAME:[^\]]+\]/g, '')
          .replace(/\[EMAIL_DRAFT\][\s\S]*?\[\/EMAIL_DRAFT\]/g, '')
          .replace(/\[EMAIL_CONFIRMED\]/g, '')
          .replace(/\[LINK:[^\]]+\]/g, '')
          .trim();
        if (clean) contents.push({ role, parts: [{ text: clean }] });
      }
    }

    // Aktuelle Nachricht
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    // ===================================================================
    // GENERIEREN + FUNCTION CALLS VERARBEITEN
    // ===================================================================
    const result = await generateWithFallback(contents);
    const response = result.response;

    // Parts auslesen: Text + Function Calls
    let answerText = '';
    const functionCalls = [];

    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) answerText += part.text;
        if (part.functionCall) functionCalls.push(part.functionCall);
      }
    }

    // Fallback
    if (!answerText && functionCalls.length === 0) {
      try { answerText = response.text(); } catch (e) {}
    }

    console.log(`🤖 ${usedModel} | Text: ${answerText.length}ch | Tools: ${functionCalls.map(f => f.name).join(', ') || 'none'}`);

    // ===================================================================
    // FUNCTION CALLS AUSFÜHREN
    // ===================================================================
    const responsePayload = { answer: answerText.trim() };

    for (const fc of functionCalls) {
      const args = fc.args || {};
      console.log(`Tool: ${fc.name}(${JSON.stringify(args)})`);

      switch (fc.name) {

        case 'open_booking': {
          responsePayload.openBooking = true;
          responsePayload.bookingReason = args.reason || null;
          if (!answerText.trim()) {
            responsePayload.answer = 'Klar, ich öffne Michaels Kalender für dich!';
          }
          break;
        }

        case 'compose_email': {
          if (!args.to || !args.subject || !args.body) {
            console.warn('compose_email: Pflichtfelder fehlen');
            break;
          }
          responsePayload.emailDraft = {
            to: args.to,
            toName: args.to_name || '',
            subject: args.subject,
            body: args.body
          };
          const draftDisplay = `\n\n**E-Mail-Entwurf:**\n**An:** ${args.to}${args.to_name ? ` (${args.to_name})` : ''}\n**Betreff:** ${args.subject}\n\n---\n${args.body}\n---`;
          if (!responsePayload.answer) {
            responsePayload.answer = `Hier ist mein Entwurf:${draftDisplay}\n\nSoll ich die E-Mail so abschicken, oder möchtest du etwas ändern?`;
          } else if (!responsePayload.answer.includes(args.subject)) {
            responsePayload.answer += draftDisplay;
          }
          break;
        }

        case 'remember_user_name': {
          const n = args.name;
          if (n && n.length >= 2 && n.length <= 20 && /^[A-Za-zÄÖÜäöüß\- ]+$/.test(n)) {
            responsePayload.detectedName = n.trim();
          }
          break;
        }

        case 'suggest_chips': {
          if (args.chips && Array.isArray(args.chips)) {
            const seen = new Set();
            responsePayload.chips = args.chips
              .filter(c => {
                // Duplikat-Check für Links
                if (c.type === 'link' && c.url) {
                  if (seen.has(c.url)) return false;
                  seen.add(c.url);
                }
                return c.text && c.text.length > 0;
              })
              .slice(0, 3);
          }
          break;
        }

        default:
          console.warn(`Unbekannter Tool: ${fc.name}`);
      }
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
        bookingCompleted: !!responsePayload.openBooking
      });
      trackQuestion(userMessage);
      if (topicKeywords.length > 0) trackTopics(topicKeywords);

      // Name aus Memory fallback
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
