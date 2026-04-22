// api/lib/email-recipient-limit.js
// Zusätzliches Rate-Limit PRO E-MAIL-ADRESSE (unabhängig von IP).
//
// Ohne dieses Limit könnte jemand von wechselnden IPs aus dieselbe
// Fremdadresse bombardieren. Max 3 Reports/Tag pro Empfänger.

import crypto from 'crypto';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const DAILY_LIMIT = 3;

function hashEmail(email) {
  // SHA-256-Hash, damit die E-Mail nicht im Klartext in Redis steht
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24);
}

function todayKey(email) {
  const today = new Date().toISOString().slice(0, 10);
  return `emailrl:${hashEmail(email)}:${today}`;
}

export async function checkEmailRecipientLimit(email) {
  try {
    const key = todayKey(email);
    const count = parseInt(await redis.get(key) || '0', 10);
    return {
      allowed: count < DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - count),
      count,
    };
  } catch (e) {
    console.warn(`⚠️ Email-RateLimit Check Fehler: ${e.message} → allow (fail-open)`);
    return { allowed: true, remaining: DAILY_LIMIT, count: 0 };
  }
}

export async function incrementEmailRecipientLimit(email) {
  try {
    const key = todayKey(email);
    await redis.incr(key);
    await redis.expire(key, 60 * 60 * 24 * 2); // 2 Tage, damit tägliches Rollover klappt
  } catch (e) {
    console.warn(`⚠️ Email-RateLimit Increment Fehler: ${e.message}`);
  }
}

/**
 * Idempotenz-Lock: verhindert Doppel-Versand innerhalb kurzer Zeit.
 * Wenn derselbe User 2x auf "Senden" klickt, geht nur eine Mail raus.
 *
 * @returns true wenn Lock gesetzt werden konnte (= erste Anfrage),
 *          false wenn bereits ein Lock existierte (= Duplikat)
 */
export async function acquireIdempotencyLock(email, cacheKey, ttlSeconds = 120) {
  try {
    const lockKey = `emaillock:${hashEmail(email)}:${crypto.createHash('sha256').update(cacheKey).digest('hex').slice(0, 16)}`;
    // SET NX (nur setzen wenn nicht existiert) mit TTL
    const set = await redis.set(lockKey, '1', { nx: true, ex: ttlSeconds });
    return set === 'OK';
  } catch (e) {
    console.warn(`⚠️ Idempotency-Lock Fehler: ${e.message} → allow (fail-open)`);
    return true;
  }
}
