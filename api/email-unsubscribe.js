// api/email-unsubscribe.js – Sperrliste für E-Mail-Empfänger
// Empfänger können sich selbst auf die Blocklist setzen via tokenisiertem Link.
//
// ── SECURITY (refactored) ───────────────────────────────────────
//   + Fail-closed: kein Hardcoded-Default-Secret mehr
//   + Timing-safe Token-Vergleich (crypto.timingSafeEqual)
//   + esc() auf E-Mail-Anzeige (Defense-in-Depth)
//   + Rate-Limit pro IP (verhindert Token-Brute-Force)
// ────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { Redis } from "@upstash/redis";
import { unsubscribeToken, esc } from './email-template.js';
import { checkRateLimit, incrementRateLimit, getClientIP } from './rate-limiter.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Limit gegen Token-Brute-Force: 30 Versuche pro IP pro Tag.
// Bei legitimen Klicks aus E-Mails kommen nie mehr als 1-2 Requests vor.
const IP_DAILY_LIMIT = 30;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate-Limit pro IP (Brute-Force-Schutz) ──
  const clientIP = getClientIP(req);
  const ipLimit = await checkRateLimit(clientIP, 'unsubscribe', IP_DAILY_LIMIT);
  if (!ipLimit.allowed) {
    return sendPage(res, 'Zu viele Versuche', 'Bitte versuche es später erneut.', false);
  }

  const email = (req.query?.email || req.body?.email || '').toLowerCase().trim();
  const token = req.query?.token || req.body?.token || '';

  if (!email || !token) {
    return sendPage(res, 'Ungültiger Link', 'Der Abmelde-Link ist unvollständig oder ungültig.', false);
  }

  // ── Secret prüfen: FAIL-CLOSED, kein Hardcoded-Fallback ──
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.EVITA_DASHBOARD_TOKEN;
  if (!secret) {
    console.error('UNSUBSCRIBE_SECRET nicht konfiguriert – Service nicht verfügbar');
    return sendPage(res, 'Service nicht verfügbar', 'Der Abmelde-Service ist gerade nicht konfiguriert. Bitte kontaktiere michael@designare.at.', false);
  }

  // ── Token verifizieren mit timing-safe compare ──
  const expectedToken = unsubscribeToken(email, secret);
  let tokenOk = false;
  try {
    const a = Buffer.from(String(token));
    const b = Buffer.from(expectedToken);
    // timingSafeEqual wirft bei unterschiedlichen Längen
    tokenOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    tokenOk = false;
  }

  if (!tokenOk) {
    // Failed-Versuch ZÄHLT zum Rate-Limit, damit Brute-Force teurer wird
    await incrementRateLimit(clientIP, 'unsubscribe');
    return sendPage(res, 'Ungültiger Link', 'Der Abmelde-Link ist ungültig oder abgelaufen.', false);
  }

  try {
    // E-Mail zur Blocklist hinzufügen (permanent, kein TTL)
    await redis.sadd('evita:email:blocklist', email);

    console.log(`🚫 E-Mail blockiert: ${email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);

    return sendPage(
      res,
      'Erfolgreich blockiert',
      `<strong>${esc(email)}</strong> erhält keine weiteren E-Mails über designare.at.`,
      true
    );

  } catch (error) {
    console.error('Unsubscribe-Fehler:', error.message);
    return sendPage(res, 'Fehler', 'Es ist ein Fehler aufgetreten. Bitte kontaktiere michael@designare.at.', false);
  }
}

// ────────────────────────────────────────────────────────────
// HTML-Bestätigungsseite
// ────────────────────────────────────────────────────────────
function sendPage(res, title, message, success) {
  const iconColor = success ? '#22c55e' : '#ef4444';
  const icon = success ? '✓' : '✗';
  // Title kann hart-codiert sein (kommt nur aus diesem Code), aber sicherheitshalber esc()
  const safeTitle = esc(title);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Wenn jemand den Unsubscribe-Link in Suchmaschinen findet → nicht indexieren
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  return res.status(200).send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>${safeTitle} – designare.at</title>
  <style>
    body { margin:0; padding:40px 20px; background:#f4f4f6; font-family:Arial,Helvetica,sans-serif; color:#333; }
    .card { max-width:440px; margin:0 auto; background:#fff; border-radius:12px; padding:40px 32px; text-align:center; box-shadow:0 1px 4px rgba(0,0,0,0.06); }
    .icon { width:56px; height:56px; border-radius:50%; background:${iconColor}; color:#fff; font-size:28px; font-weight:700; line-height:56px; margin:0 auto 20px; }
    h1 { font-size:20px; margin:0 0 12px; color:#1a1a1a; }
    p { font-size:14px; color:#666; line-height:1.6; margin:0; }
    .footer { margin-top:24px; font-size:12px; color:#aaa; }
    .footer a { color:#c4a35a; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${safeTitle}</h1>
    <p>${message}</p>
    <div class="footer">
      <a href="https://designare.at">designare.at</a> · 
      <a href="mailto:michael@designare.at">Michael Kanda</a>
    </div>
  </div>
</body>
</html>`);
}
