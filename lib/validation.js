// lib/validation.js - Eingabe-Validierung, Sanitization, CORS
// Zentrale Stelle für alle Prüfungen die mehrere Endpunkte brauchen

export const MAX_MESSAGE_LENGTH = 2000;

export const ALLOWED_ORIGINS = [
  'https://designare.at',
  'https://www.designare.at',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
].filter(Boolean);

/**
 * Setzt CORS-Header für erlaubte Origins
 */
export function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

/**
 * E-Mail-Format prüfen
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * HTML-Entities escapen (XSS-Schutz)
 */
export function sanitizeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Plaintext → HTML-Paragraphen konvertieren
 */
export function textToHtml(text) {
  return sanitizeHtml(text)
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Client-IP aus Request extrahieren (Vercel / Proxy-kompatibel)
 */
export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}
