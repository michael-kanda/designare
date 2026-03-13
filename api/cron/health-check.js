// api/cron/health-check.js - Automatischer Health-Check für alle Services
// Läuft alle 15 Minuten via Vercel Cron ODER manuell via Dashboard
// Prüft: Redis, Vector-DB, Gemini API, Brevo, News-Feed, Website-Erreichbarkeit
//
// Redis-Keys:
//   health:latest       → Letztes Check-Ergebnis (JSON)
//   health:log          → Liste der letzten 200 Checks (LPUSH)
//   health:incidents    → Aktive/vergangene Incidents (LPUSH)

import { Redis } from "@upstash/redis";
import { Index } from "@upstash/vector";

const CRON_SECRET = process.env.CRON_SECRET;
const SITE_HOST = process.env.SITE_URL || 'designare.at';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

// ===================================================================
// SERVICE-CHECKS
// ===================================================================

/**
 * Check: Redis Upstash (Read + Write)
 */
async function checkRedis() {
  const t0 = Date.now();
  try {
    const testKey = 'health:ping';
    await redis.set(testKey, Date.now(), { ex: 60 });
    const val = await redis.get(testKey);
    if (!val) throw new Error('Read-after-write fehlgeschlagen');
    return { status: 'ok', latency_ms: Date.now() - t0 };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - t0, error: err.message };
  }
}

/**
 * Check: Upstash Vector (Query-fähig?)
 */
async function checkVectorDB() {
  const t0 = Date.now();
  try {
    const info = await vectorIndex.info();
    return {
      status: 'ok',
      latency_ms: Date.now() - t0,
      details: {
        vectorCount: info.vectorCount || info.vector_count || 0,
        dimension: info.dimension || 0
      }
    };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - t0, error: err.message };
  }
}

/**
 * Check: Gemini API (leichtgewichtiger Ping)
 */
async function checkGemini() {
  const t0 = Date.now();
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { status: 'error', latency_ms: 0, error: 'GEMINI_API_KEY nicht gesetzt' };

    // Minimal-Request: models.list ist der schnellste Endpoint
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: 'ok', latency_ms: Date.now() - t0 };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - t0, error: err.message };
  }
}

/**
 * Check: Brevo API (Account-Info)
 */
async function checkBrevo() {
  const t0 = Date.now();
  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return { status: 'warn', latency_ms: 0, error: 'BREVO_API_KEY nicht gesetzt' };

    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      status: 'ok',
      latency_ms: Date.now() - t0,
      details: {
        plan: data.plan?.[0]?.type || 'unknown',
        credits: data.plan?.[0]?.credits || 0
      }
    };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - t0, error: err.message };
  }
}

/**
 * Check: Website erreichbar (knowledge.json als Proxy)
 */
async function checkWebsite() {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://${SITE_HOST}/knowledge.json`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: 'ok', latency_ms: Date.now() - t0 };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - t0, error: err.message };
  }
}

/**
 * Check: News-Briefing vorhanden und aktuell?
 */
async function checkNewsBriefing() {
  const t0 = Date.now();
  try {
    const raw = await redis.get('news:daily-briefing');
    if (!raw) return { status: 'warn', latency_ms: Date.now() - t0, error: 'Kein Briefing vorhanden' };

    const briefing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const updatedAt = briefing.fetchedAt ? new Date(briefing.fetchedAt) : null;

    if (!updatedAt) {
      return { status: 'warn', latency_ms: Date.now() - t0, error: 'Kein Timestamp im Briefing' };
    }

    const ageHours = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > 20) {
      return {
        status: 'warn',
        latency_ms: Date.now() - t0,
        error: `Briefing veraltet (${Math.round(ageHours)}h alt, Limit: 20h)`,
        details: { age_hours: Math.round(ageHours) }
      };
    }

    return {
      status: 'ok',
      latency_ms: Date.now() - t0,
      details: { age_hours: Math.round(ageHours * 10) / 10, sources: briefing.sources?.length || 0 }
    };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - t0, error: err.message };
  }
}

/**
 * Check: Cron-Jobs (letzter Run in Redis prüfen)
 */
async function checkCronJobs() {
  const t0 = Date.now();
  try {
    const results = {};

    // Knowledge-Regeneration: Letzten Build-Trigger prüfen
    const triggersRaw = await redis.lrange('build:log:triggers', 0, 0);
    if (triggersRaw && triggersRaw.length > 0) {
      const lastTrigger = typeof triggersRaw[0] === 'string' ? JSON.parse(triggersRaw[0]) : triggersRaw[0];
      const age = lastTrigger.timestamp ? (Date.now() - new Date(lastTrigger.timestamp).getTime()) / (1000 * 60 * 60) : null;
      results.knowledge_sync = {
        last_run: lastTrigger.timestamp || null,
        age_hours: age ? Math.round(age * 10) / 10 : null,
        status: lastTrigger.status || 'unknown'
      };
    } else {
      results.knowledge_sync = { last_run: null, age_hours: null, status: 'never_run' };
    }

    return { status: 'ok', latency_ms: Date.now() - t0, details: results };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - t0, error: err.message };
  }
}

// ===================================================================
// INCIDENT-MANAGEMENT
// ===================================================================

async function detectIncidents(checks, previousHealth) {
  const incidents = [];
  const now = new Date().toISOString();

  for (const [service, check] of Object.entries(checks)) {
    const wasOk = previousHealth?.checks?.[service]?.status === 'ok';
    const isNowBad = check.status === 'error';

    // Neuer Incident: War OK, ist jetzt Error
    if (wasOk && isNowBad) {
      incidents.push({
        type: 'down',
        service,
        message: `${service} ist ausgefallen: ${check.error}`,
        started_at: now,
        resolved_at: null
      });
    }

    // Recovery: War Error, ist jetzt OK
    const wasError = previousHealth?.checks?.[service]?.status === 'error';
    if (wasError && check.status === 'ok') {
      incidents.push({
        type: 'recovery',
        service,
        message: `${service} ist wieder online`,
        started_at: now,
        resolved_at: now
      });
    }
  }

  // Incidents in Redis speichern
  if (incidents.length > 0) {
    const pipeline = redis.pipeline();
    for (const incident of incidents) {
      pipeline.lpush('health:incidents', JSON.stringify(incident));
    }
    pipeline.ltrim('health:incidents', 0, 199);
    await pipeline.exec();
  }

  return incidents;
}

// ===================================================================
// MAIN HANDLER
// ===================================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: Vercel Cron ODER Bearer Token ODER Dashboard Token
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const hasValidSecret = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  const dashboardToken = process.env.EVITA_DASHBOARD_TOKEN;
  const hasDashboardToken = dashboardToken && (
    authHeader === `Bearer ${dashboardToken}` ||
    req.query?.token === dashboardToken
  );

  if (!isVercelCron && !hasValidSecret && !hasDashboardToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🏥 Health-Check gestartet');
  const startTime = Date.now();

  try {
    // Vorheriges Ergebnis laden (für Incident-Detection)
    let previousHealth = null;
    try {
      const raw = await redis.get('health:latest');
      if (raw) previousHealth = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { /* ignore */ }

    // ── Alle Checks parallel ──
    const [
      redisCheck,
      vectorCheck,
      geminiCheck,
      brevoCheck,
      websiteCheck,
      newsCheck,
      cronCheck
    ] = await Promise.all([
      checkRedis(),
      checkVectorDB(),
      checkGemini(),
      checkBrevo(),
      checkWebsite(),
      checkNewsBriefing(),
      checkCronJobs()
    ]);

    const checks = {
      redis: redisCheck,
      vector_db: vectorCheck,
      gemini: geminiCheck,
      brevo: brevoCheck,
      website: websiteCheck,
      news_briefing: newsCheck,
      cron_jobs: cronCheck
    };

    // ── Gesamtstatus berechnen ──
    const statuses = Object.values(checks).map(c => c.status);
    let overallStatus = 'healthy';
    if (statuses.includes('error')) overallStatus = 'degraded';
    if (statuses.filter(s => s === 'error').length >= 3) overallStatus = 'critical';
    if (statuses.includes('warn') && overallStatus === 'healthy') overallStatus = 'warning';

    // ── Incidents erkennen ──
    const incidents = await detectIncidents(checks, previousHealth);

    const totalLatency = Date.now() - startTime;

    const result = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      total_latency_ms: totalLatency,
      checks,
      incidents: incidents.length > 0 ? incidents : undefined
    };

    // ── In Redis speichern ──
    await redis.set('health:latest', JSON.stringify(result), { ex: 60 * 60 * 24 }); // 24h TTL

    // Log-Eintrag (kompakt)
    const logEntry = {
      timestamp: result.timestamp,
      status: overallStatus,
      latency_ms: totalLatency,
      services: Object.fromEntries(
        Object.entries(checks).map(([k, v]) => [k, { s: v.status, ms: v.latency_ms }])
      )
    };
    await redis.lpush('health:log', JSON.stringify(logEntry));
    await redis.ltrim('health:log', 0, 199);

    const serviceCount = Object.keys(checks).length;
    const okCount = statuses.filter(s => s === 'ok').length;
    console.log(`🏥 Health-Check: ${overallStatus.toUpperCase()} (${okCount}/${serviceCount} OK) in ${totalLatency}ms`);

    return res.status(200).json(result);

  } catch (error) {
    console.error('❌ Health-Check Fehler:', error);
    return res.status(500).json({ error: error.message });
  }
}
