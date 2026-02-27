// lib/email-service.js - E-Mail-Versand, Whitelist/Blocklist, HTML-Builder
// Kapselt die gesamte Brevo-Interaktion + Datenschutz-Prüfungen
import Brevo from '@getbrevo/brevo';
import { redis } from './redis.js';
import { sanitizeHtml } from './validation.js';
import { emailShell, unsubscribeFooter } from '../api/email-template.js';

// ===================================================================
// BREVO CLIENT (Singleton)
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

export const MAX_EMAILS_PER_SESSION = 3;

// ===================================================================
// PRÜFUNGEN (Whitelist / Blocklist)
// ===================================================================

/**
 * Prüft ob eine E-Mail-Adresse auf der Blocklist steht.
 * Fail-Closed: Bei Redis-Fehler wird true (= blockiert) zurückgegeben.
 */
export async function isEmailBlocked(email) {
  try {
    return await redis.sismember('evita:email:blocklist', email.toLowerCase().trim());
  } catch (e) {
    console.error('Blocklist-Check Fehler:', e.message);
    return true; // Fail-Closed: Im Zweifel blockieren
  }
}

/**
 * Prüft ob eine E-Mail-Adresse in der Whitelist steht.
 * Leere Whitelist = niemand erlaubt (Versand gesperrt).
 * Fail-Closed: Bei Redis-Fehler wird false (= nicht erlaubt) zurückgegeben.
 */
export async function isEmailWhitelisted(email) {
  try {
    const whitelistSize = await redis.scard('evita:email:whitelist');
    if (whitelistSize === 0) return false;
    return await redis.sismember('evita:email:whitelist', email.toLowerCase().trim());
  } catch (e) {
    console.error('Whitelist-Check Fehler:', e.message);
    return false; // Fail-Closed: Im Zweifel nicht erlauben
  }
}

// ===================================================================
// HTML-BUILDER
// ===================================================================

/**
 * Baut eine vollständige HTML-E-Mail mit designare.at-Template
 */
export function buildEmailHtml(bodyText, subject, recipientEmail) {
  const bodyHtml = sanitizeHtml(bodyText)
    .split('\n\n')
    .map(p => `<p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.7;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

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

// ===================================================================
// VERSAND
// ===================================================================

/**
 * Sendet eine E-Mail über Brevo.
 * Keine eigene Validierung – Caller muss vorher prüfen (whitelist, blocklist, etc.)
 */
export async function sendEmail({ to, toName, subject, body, sessionId }) {
  const email = new Brevo.SendSmtpEmail();
  email.sender = EMAIL_SENDER;
  email.to = [{ email: to, name: toName || to.split('@')[0] }];
  email.subject = subject;
  email.htmlContent = buildEmailHtml(body, subject, to);
  email.textContent = body;
  email.tags = ['evita-composed'];
  email.headers = {
    'X-Evita-Session': sessionId || 'unknown',
    'X-Sent-By': 'Evita-AI'
  };
  return await brevoApi.sendTransacEmail(email);
}
