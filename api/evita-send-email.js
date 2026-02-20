// api/evita-send-email.js - E-Mail-Versand via Brevo (Sendinblue)
// Evita kann E-Mails im Namen von Michael versenden
// Authentifizierung: Interner Aufruf oder via Session-Validierung
import { Redis } from "@upstash/redis";
import Brevo from '@getbrevo/brevo';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ===================================================================
// BREVO CLIENT SETUP
// ===================================================================
const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

// ===================================================================
// ABSENDER-KONFIGURATION
// ===================================================================
const DEFAULT_SENDER = {
  name: process.env.EMAIL_SENDER_NAME || 'Michael Kanda',
  email: process.env.EMAIL_SENDER_ADDRESS || 'hello@designare.at'
};

// Erlaubte Empfänger-Domains (Spam-Schutz) – leer = alle erlaubt
const ALLOWED_RECIPIENT_DOMAINS = []; // z.B. ['gmail.com', 'gmx.at'] oder leer für alle

// Max. E-Mails pro Session (Rate-Limiting)
const MAX_EMAILS_PER_SESSION = 3;
const sessionEmailCounts = new Map(); // In-Memory, resets bei Redeploy

// ===================================================================
// VALIDIERUNG
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
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ===================================================================
// MAIN HANDLER
// ===================================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      to,           // Empfänger-E-Mail (Pflicht)
      toName,       // Empfänger-Name (optional)
      subject,      // Betreff (Pflicht)
      body,         // E-Mail-Text (Pflicht)
      bodyHtml,     // Optional: Custom HTML statt Auto-Konvertierung
      replyTo,      // Optional: Reply-To Adresse
      sessionId,    // Für Rate-Limiting
      cc,           // Optional: CC-Empfänger [{email, name}]
      tags          // Optional: Brevo-Tags für Tracking ['evita', 'auto']
    } = req.body;

    // ---------------------------------------------------------------
    // 1. PFLICHTFELDER PRÜFEN
    // ---------------------------------------------------------------
    if (!to || !subject || !body) {
      return res.status(400).json({
        error: 'Fehlende Pflichtfelder',
        required: ['to', 'subject', 'body']
      });
    }

    // ---------------------------------------------------------------
    // 2. E-MAIL VALIDIEREN
    // ---------------------------------------------------------------
    if (!isValidEmail(to)) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse', field: 'to' });
    }

    // Domain-Check (falls konfiguriert)
    if (ALLOWED_RECIPIENT_DOMAINS.length > 0) {
      const domain = to.split('@')[1].toLowerCase();
      if (!ALLOWED_RECIPIENT_DOMAINS.includes(domain)) {
        return res.status(400).json({ error: 'E-Mail-Domain nicht erlaubt' });
      }
    }

    // ---------------------------------------------------------------
    // 3. RATE-LIMITING (pro Session)
    // ---------------------------------------------------------------
    // ---------------------------------------------------------------
// 3. RATE-LIMITING (pro Session via Redis)
// ---------------------------------------------------------------
if (sessionId) {
  const rateLimitKey = `rate_limit:email:${sessionId}`;
  
  // Erhöhe den Zähler in Redis um 1
  const count = await redis.incr(rateLimitKey);
  
  // Wenn es der erste Eintrag ist, setze ein Verfallsdatum (z.B. 1 Stunde / 3600 Sekunden)
  // Das verhindert, dass die Redis-Datenbank auf Dauer vollläuft
  if (count === 1) {
    await redis.expire(rateLimitKey, 3600); 
  }

  if (count > MAX_EMAILS_PER_SESSION) {
    return res.status(429).json({
      error: 'E-Mail-Limit erreicht',
      message: `Maximal ${MAX_EMAILS_PER_SESSION} E-Mails pro Session.`
    });
  }
}

    // ---------------------------------------------------------------
    // 4. E-MAIL ZUSAMMENBAUEN
    // ---------------------------------------------------------------
    const sendSmtpEmail = new Brevo.SendSmtpEmail();

    sendSmtpEmail.sender = DEFAULT_SENDER;

    sendSmtpEmail.to = [{
      email: to,
      name: toName || to.split('@')[0]
    }];

    sendSmtpEmail.subject = subject;

    // HTML-Body: Custom oder Auto-Konvertierung aus Text
    sendSmtpEmail.htmlContent = bodyHtml || wrapInTemplate(textToHtml(body), subject);
    sendSmtpEmail.textContent = body; // Plaintext-Fallback

    // Optional: Reply-To
    if (replyTo && isValidEmail(replyTo)) {
      sendSmtpEmail.replyTo = { email: replyTo };
    }

    // Optional: CC
    if (cc && Array.isArray(cc)) {
      sendSmtpEmail.cc = cc
        .filter(c => c.email && isValidEmail(c.email))
        .map(c => ({ email: c.email, name: c.name || c.email }));
    }

    // Tags für Brevo-Tracking
    sendSmtpEmail.tags = tags || ['evita-chat'];

    // Custom Headers für Tracking
    sendSmtpEmail.headers = {
      'X-Evita-Session': sessionId || 'unknown',
      'X-Sent-By': 'Evita-AI'
    };

    // ---------------------------------------------------------------
    // 5. SENDEN
    // ---------------------------------------------------------------
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log(`📧 E-Mail gesendet: ${to} | Betreff: "${subject}" | MessageId: ${result.messageId}`);

    return res.status(200).json({
      success: true,
      messageId: result.messageId,
      to: to,
      subject: subject
    });

  } catch (error) {
    console.error('📧 E-Mail Fehler:', error.message || error);

    // Brevo-spezifische Fehlerbehandlung
    if (error.response?.body) {
      console.error('Brevo Error Body:', error.response.body);
    }

    return res.status(500).json({
      error: 'E-Mail konnte nicht gesendet werden',
      message: error.message || 'Unbekannter Fehler'
    });
  }
}

// ===================================================================
// HTML E-MAIL TEMPLATE
// ===================================================================
function wrapInTemplate(htmlBody, subject) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sanitizeHtml(subject)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .email-container {
      background: #ffffff;
      border-radius: 8px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .email-header {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .email-header h2 {
      margin: 0;
      color: #1a1a1a;
      font-size: 20px;
    }
    .email-body p {
      margin: 0 0 16px 0;
    }
    .email-footer {
      border-top: 1px solid #e0e0e0;
      padding-top: 16px;
      margin-top: 32px;
      font-size: 13px;
      color: #888;
    }
    .email-footer a {
      color: #555;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h2>${sanitizeHtml(subject)}</h2>
    </div>
    <div class="email-body">
      ${htmlBody}
    </div>
    <div class="email-footer">
      <p>
        Michael Kanda - Komplize für Web & KI<br>
        <a href="https://designare.at">designare.at</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}
