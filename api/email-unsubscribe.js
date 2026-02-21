// api/email-unsubscribe.js - Sperrliste für E-Mail-Empfänger
// Empfänger können sich selbst auf die Blocklist setzen via tokenisiertem Link
import { Redis } from "@upstash/redis";
import { unsubscribeToken } from './email-template.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  // Nur GET (Klick aus E-Mail) und POST (ggf. API)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = (req.query?.email || req.body?.email || '').toLowerCase().trim();
  const token = req.query?.token || req.body?.token || '';

  if (!email || !token) {
    return sendPage(res, 'Ungültiger Link', 'Der Abmelde-Link ist unvollständig oder ungültig.', false);
  }

  // Token verifizieren
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.EVITA_DASHBOARD_TOKEN || 'designare-default';
  const expectedToken = unsubscribeToken(email, secret);

  if (token !== expectedToken) {
    return sendPage(res, 'Ungültiger Link', 'Der Abmelde-Link ist ungültig oder abgelaufen.', false);
  }

  try {
    // E-Mail zur Blocklist hinzufügen (Redis Set, kein TTL = permanent)
    await redis.sadd('evita:email:blocklist', email);

    console.log(`🚫 E-Mail blockiert: ${email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);

    return sendPage(res, 'Erfolgreich blockiert', `<strong>${email}</strong> erhält keine weiteren E-Mails über designare.at.`, true);

  } catch (error) {
    console.error('Unsubscribe-Fehler:', error.message);
    return sendPage(res, 'Fehler', 'Es ist ein Fehler aufgetreten. Bitte kontaktiere michael@designare.at.', false);
  }
}

// Gibt eine einfache, gebrandete HTML-Bestätigungsseite zurück
function sendPage(res, title, message, success) {
  const iconColor = success ? '#22c55e' : '#ef4444';
  const icon = success ? '✓' : '✗';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title} – designare.at</title>
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
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer">
      <a href="https://designare.at">designare.at</a> · 
      <a href="mailto:michael@designare.at">Michael Kanda</a>
    </div>
  </div>
</body>
</html>`);
}
