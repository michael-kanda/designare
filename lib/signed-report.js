// api/lib/signed-report.js
// HMAC-signierte Tokens für den E-Mail-Report-Endpoint.
//
// Problem ohne Token: Jeder kann send-visibility-report aufrufen mit beliebiger
// domain/brand und bekommt den Report an seine Adresse — d.h. fremde Auswertungen
// können per Mail "abgezogen" werden, und ohne Rate-Limit kann gespammt werden.
//
// Lösung: Der Check-Endpoint liefert beim Response einen Token, der den
// Cache-Key signiert. Der Report-Endpoint akzeptiert NUR Requests mit gültigem
// Token. Token und Payload sind stateless verifizierbar, kein Redis-Roundtrip nötig.
//
// Der Token ist 1 Stunde gültig — lang genug für normalen User-Flow, kurz genug
// um Replay zu minimieren.

import crypto from 'crypto';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 Stunde

function getSecret() {
  const secret = process.env.REPORT_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('REPORT_TOKEN_SECRET ist nicht gesetzt oder zu kurz (min 32 Zeichen).');
  }
  return secret;
}

function hmac(data) {
  return crypto.createHmac('sha256', getSecret())
    .update(data)
    .digest('base64url');
}

/**
 * Erstellt ein Token, das einen cacheKey an einen Zeitstempel bindet.
 * Format: base64url(JSON({k: cacheKey, t: timestamp})).sig
 */
export function signReportToken(cacheKey) {
  const payload = { k: cacheKey, t: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verifiziert ein Token und liefert den cacheKey zurück.
 * Wirft bei ungültigem/abgelaufenem Token.
 */
export function verifyReportToken(token, expectedCacheKey) {
  if (!token || typeof token !== 'string') throw new Error('Token fehlt.');

  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Ungültiges Token-Format.');

  const [encoded, sig] = parts;
  const expectedSig = hmac(encoded);

  // Timing-safe Vergleich
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expectedSig, 'base64url');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Token-Signatur ungültig.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Token-Payload defekt.');
  }

  if (!payload.k || !payload.t) throw new Error('Token unvollständig.');
  if (Date.now() - payload.t > TOKEN_TTL_MS) throw new Error('Token abgelaufen.');

  // Optionale Bindung an erwarteten Cache-Key (als zusätzliche Defense-in-Depth)
  if (expectedCacheKey && payload.k !== expectedCacheKey) {
    throw new Error('Token passt nicht zur angeforderten Auswertung.');
  }

  return payload.k;
}
