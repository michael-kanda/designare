// lib/rate-limiter.js - IP-basiertes Rate-Limiting (In-Memory)
// Resets bei Vercel Cold-Start / Redeploy

const rateLimitMap = new Map();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;        // 1 Minute Fenster
const RATE_LIMIT_MAX_REQUESTS = 20;             // Max 20 Chat-Requests pro Minute
const EMAIL_RATE_LIMIT_MAX = 3;                 // Max 3 E-Mails pro Minute pro IP
const MCP_RATE_LIMIT_MAX = 30;                  // Max 30 MCP-Requests pro Minute pro IP
const CLEANUP_THRESHOLD = 10000;                // Ab wann alte Einträge gelöscht werden

/**
 * Prüft ob ein Request innerhalb des Limits liegt.
 * @param {string} ip - Client-IP
 * @param {'general'|'email'|'mcp'} type - Limit-Typ
 * @returns {boolean} true = erlaubt, false = geblockt
 */
export function checkRateLimit(ip, type = 'general') {
  const key = `${ip}:${type}`;
  const now = Date.now();
  let entry = rateLimitMap.get(key);

  // Periodischer Cleanup alter Einträge
  if (rateLimitMap.size > CLEANUP_THRESHOLD) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(k);
    }
  }

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimitMap.set(key, entry);
  }

  entry.count++;
  const limit = type === 'email' ? EMAIL_RATE_LIMIT_MAX
              : type === 'mcp'   ? MCP_RATE_LIMIT_MAX
              : RATE_LIMIT_MAX_REQUESTS;
  return entry.count <= limit;
}
