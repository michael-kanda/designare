// api/rate-limiter.js – Gemeinsames Rate Limiting via Upstash Redis
// Verwendet von: ai-visibility-check.js, generate.js
// Hybrid: Redis primary → In-Memory Fallback (nie Fail-Open)

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// =================================================================
// IN-MEMORY FALLBACK
// Greift wenn Redis nicht erreichbar ist. Schützt vor Kosten-
// Explosion bei gleichzeitigem Redis-Ausfall + Traffic-Spike.
// Limitiert pro Serverless-Instanz (nicht global), daher
// konservativer als Redis (halbes Limit).
// =================================================================
const memoryCounters = new Map();
const MEMORY_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 Min

// Alte Einträge regelmäßig aufräumen (Serverless: läuft solange Instanz warm ist)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCounters) {
    if (now - entry.created > 24 * 60 * 60 * 1000) {
      memoryCounters.delete(key);
    }
  }
}, MEMORY_CLEANUP_INTERVAL);

function getMemoryKey(ip, scope) {
  const today = new Date().toISOString().slice(0, 10);
  return `${scope}:${ip}:${today}`;
}

function memoryCheck(ip, scope, dailyLimit) {
  const key = getMemoryKey(ip, scope);
  const entry = memoryCounters.get(key);
  const count = entry?.count || 0;
  // Halbes Limit als Sicherheitsmarge (mehrere Instanzen teilen sich nicht)
  const safeLimit = Math.max(1, Math.floor(dailyLimit / 2));
  return {
    allowed: count < safeLimit,
    remaining: Math.max(0, safeLimit - count),
    total: count,
    source: 'memory'
  };
}

function memoryIncrement(ip, scope) {
  const key = getMemoryKey(ip, scope);
  const entry = memoryCounters.get(key);
  if (entry) {
    entry.count++;
  } else {
    memoryCounters.set(key, { count: 1, created: Date.now() });
  }
}

// =================================================================
// PUBLIC API
// =================================================================

/**
 * Prüft ob die IP noch Anfragen machen darf
 * @param {string} ip - Client-IP
 * @param {string} scope - 'visibility' oder 'silas'
 * @param {number} dailyLimit - Max. Anfragen pro Tag
 * @returns {{ allowed: boolean, remaining: number, total: number, source: string }}
 */
export async function checkRateLimit(ip, scope, dailyLimit) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const key = `rl:${scope}:${ip}:${today}`;

    const count = parseInt(await redis.get(key)) || 0;

    return {
      allowed: count < dailyLimit,
      remaining: Math.max(0, dailyLimit - count),
      total: count,
      source: 'redis'
    };
  } catch (error) {
    console.error(`⚠️ Redis checkRateLimit (${scope}):`, error.message);
    console.warn(`↪ Fallback: In-Memory Rate Limiter (halbes Limit)`);
    return memoryCheck(ip, scope, dailyLimit);
  }
}

/**
 * Zähler nach erfolgreicher Verarbeitung hochzählen
 */
export async function incrementRateLimit(ip, scope) {
  // Immer auch In-Memory zählen (als Backup falls Redis beim nächsten Check ausfällt)
  memoryIncrement(ip, scope);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const key = `rl:${scope}:${ip}:${today}`;

    const newCount = await redis.incr(key);

    // TTL nur beim ersten Aufruf setzen (25h → läuft sicher nach Mitternacht ab)
    if (newCount === 1) {
      await redis.expire(key, 90000);
    }

    return newCount;
  } catch (error) {
    console.error(`⚠️ Redis incrementRateLimit (${scope}):`, error.message);
  }
}

/**
 * IP aus Request-Headers extrahieren
 */
export function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.headers['cf-connecting-ip'] ||
         'unknown';
}
