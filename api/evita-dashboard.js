// api/evita-dashboard.js - Dashboard-API für Evita- & Silas-Statistiken
// Authentifizierung via Bearer Token (EVITA_DASHBOARD_TOKEN in Vercel Env)
// REFACTORED: Alle Redis-Reads parallelisiert via Promise.all
// NEU: Website-Roast Tracking-Daten
import { Redis } from "@upstash/redis";

// Vercel Pro: Erlaube bis zu 5 Min (nötig für Vektor-DB Rebuild via Dashboard)
export const maxDuration = 300;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ===================================================================
// AUTH CHECK
// ===================================================================
function isAuthorized(req) {
  const token = process.env.EVITA_DASHBOARD_TOKEN;
  if (!token) return false;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1] === token;
  }

  const queryToken = req.query?.token;
  return queryToken === token;
}

// ===================================================================
// HELPER
// ===================================================================
function getLastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

/** Safe parseInt mit Default 0 */
function safeInt(val) {
  return parseInt(val || 0);
}

/** Parsed eine Redis-Liste (JSON-Strings oder bereits geparst) */
function parseRedisList(raw, fallbackObj = null) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(entry => {
    try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
    catch { return fallbackObj; }
  }).filter(Boolean);
}

/** Parsed ein Sorted-Set-Result (alternierend: member, score) */
function parseSortedSet(raw, keyName = 'item') {
  const result = [];
  if (!raw) return result;
  for (let i = 0; i < raw.length; i += 2) {
    result.push({ [keyName]: raw[i], count: parseInt(raw[i + 1]) });
  }
  return result;
}

/** Aggregiert Hashes über mehrere Tage (Topics, Intents, Models) */
function aggregateHashesByDay(hashResults) {
  const agg = {};
  for (const hash of hashResults) {
    if (hash) {
      Object.entries(hash).forEach(([key, count]) => {
        agg[key] = (agg[key] || 0) + parseInt(count);
      });
    }
  }
  return agg;
}

// ===================================================================
// HELPER: Vektor-DB Sync im Hintergrund triggern (Fire-and-Forget)
// Wird nach KB-Änderungen automatisch aufgerufen, damit Evita
// sofort das neue Wissen findet – ohne manuellen Button-Klick.
// ===================================================================
function triggerVectorSync(req) {
  const cronSecret = process.env.CRON_SECRET;
  const host = req.headers.host || 'designare.at';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  // Fire-and-Forget: Request absenden, aber nicht auf Antwort warten.
  // regenerate-knowledge.js läuft als eigene Serverless Function weiter.
  fetch(`${baseUrl}/api/cron/regenerate-knowledge`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${cronSecret}` }
  })
    .then(async (response) => {
      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        const logEntry = {
          timestamp: new Date().toISOString(),
          trigger: 'auto-after-kb-change',
          status: 'completed',
          stats: result.stats || null
        };
        await redis.lpush('build:log:triggers', JSON.stringify(logEntry));
        await redis.ltrim('build:log:triggers', 0, 99);
        console.log(`🧠 Auto-Sync abgeschlossen: ${result.stats?.vector_chunks ?? '?'} Chunks`);
      } else {
        console.warn(`⚠️  Auto-Sync fehlgeschlagen: HTTP ${response.status}`);
      }
    })
    .catch((err) => {
      console.warn(`⚠️  Auto-Sync konnte nicht gestartet werden: ${err.message}`);
    });
}

// ===================================================================
// MAIN HANDLER
// ===================================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized. Token required.' });
  }

  // ═════════════════════════════════════════════════════════════════
  // POST: Admin-Aktionen
  // ═════════════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const { action, email } = req.body || {};

    // ── E-Mail Blocklist ──
    if (action === 'remove_blocklist' && email) {
      try {
        await redis.srem('evita:email:blocklist', email.toLowerCase().trim());
        return res.status(200).json({ success: true, removed: email });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── E-Mail Whitelist ──
    if (action === 'add_whitelist' && email) {
      try {
        const normalized = email.toLowerCase().trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
        }
        await redis.sadd('evita:email:whitelist', normalized);
        return res.status(200).json({ success: true, added: normalized });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    if (action === 'remove_whitelist' && email) {
      try {
        await redis.srem('evita:email:whitelist', email.toLowerCase().trim());
        return res.status(200).json({ success: true, removed: email });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── Build Exclude URLs ──
    if (action === 'add_exclude_url' && req.body.url) {
      try {
        const normalized = req.body.url.trim().toLowerCase()
          .replace(/^https?:\/\/[^/]+\/?/, '')
          .replace(/^\//, '')
          .replace(/\.html$/, '');
        if (!normalized || normalized.length < 2) {
          return res.status(400).json({ error: 'Ungültiger Seitenname' });
        }
        await redis.sadd('build:exclude:urls', normalized);
        return res.status(200).json({ success: true, added: normalized });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    if (action === 'remove_exclude_url' && req.body.url) {
      try {
        await redis.srem('build:exclude:urls', req.body.url.trim().toLowerCase());
        return res.status(200).json({ success: true, removed: req.body.url });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── Vercel Deploy Rebuild ──
    if (action === 'trigger_rebuild') {
      const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK;
      if (!deployHookUrl) {
        return res.status(500).json({ error: 'VERCEL_DEPLOY_HOOK nicht konfiguriert' });
      }
      try {
        const response = await fetch(deployHookUrl, { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();

        const logEntry = {
          timestamp: new Date().toISOString(),
          trigger: 'dashboard',
          status: 'triggered',
          deployment_id: result?.job?.id || result?.id || null
        };
        await redis.lpush('build:log:triggers', JSON.stringify(logEntry));
        await redis.ltrim('build:log:triggers', 0, 99);

        return res.status(200).json({ success: true, message: 'Rebuild getriggert', deployment: logEntry });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── Vektor-DB Rebuild ──
    if (action === 'trigger_vector_rebuild') {
      const cronSecret = process.env.CRON_SECRET;
      const host = req.headers.host || 'designare.at';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const baseUrl = `${protocol}://${host}`;

      try {
        console.log(`🧠 Vektor-DB Rebuild: Rufe ${baseUrl}/api/cron/regenerate-knowledge auf...`);
        const response = await fetch(`${baseUrl}/api/cron/regenerate-knowledge`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${cronSecret}` }
        });

        const responseText = await response.text();
        let result;
        try {
          result = JSON.parse(responseText);
        } catch (parseErr) {
          console.error(`🧠 Keine JSON-Antwort (Status ${response.status}):`, responseText.substring(0, 200));
          throw new Error(`Cron-Endpoint antwortet nicht mit JSON (Status ${response.status}). Ist regenerate-knowledge.js deployed?`);
        }

        if (!response.ok || !result.success) {
          throw new Error(result.error || result.message || `HTTP ${response.status}`);
        }

        const logEntry = {
          timestamp: new Date().toISOString(),
          trigger: 'dashboard-vector',
          status: 'completed',
          stats: result.stats || null
        };
        await redis.lpush('build:log:triggers', JSON.stringify(logEntry));
        await redis.ltrim('build:log:triggers', 0, 99);

        return res.status(200).json({
          success: true,
          message: result.stats
            ? `Vektor-DB aktualisiert: ${result.stats.vector_chunks ?? '?'} Chunks aus ${result.stats.total_pages ?? '?'} Seiten (${result.stats.processing_time_ms}ms)`
            : result.message || 'Cron lief, aber keine Stats zurückgegeben',
          stats: result.stats
        });
      } catch (e) {
        return res.status(500).json({ error: `Vektor-DB Fehler: ${e.message}` });
      }
    }

    // ── Knowledge-Base CRUD ──
    if (action === 'save_knowledge') {
      const { slug, title, tags, content } = req.body;
      if (!slug || !title || !content) {
        return res.status(400).json({ error: 'slug, title und content sind Pflichtfelder' });
      }
      const normalized = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (normalized.length < 2) {
        return res.status(400).json({ error: 'Slug zu kurz (min. 2 Zeichen)' });
      }
      try {
        const chunk = {
          title: title.trim(),
          slug: normalized,
          tags: (tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
          content: content.trim(),
          updated_at: new Date().toISOString()
        };
        const existing = await redis.get(`kb:${normalized}`);
        if (!existing) {
          chunk.created_at = new Date().toISOString();
        } else {
          const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
          chunk.created_at = parsed.created_at || new Date().toISOString();
        }
        await redis.set(`kb:${normalized}`, JSON.stringify(chunk));
        await redis.sadd('kb:_index', normalized);
        console.log(`📝 Knowledge-Chunk gespeichert: kb:${normalized} (${content.length} Zeichen)`);

        // Auto-Sync: Vektor-DB im Hintergrund aktualisieren
        triggerVectorSync(req);

        return res.status(200).json({ success: true, saved: normalized, isNew: !existing, vectorSyncTriggered: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    if (action === 'remove_knowledge') {
      const { slug } = req.body;
      if (!slug) return res.status(400).json({ error: 'slug fehlt' });
      try {
        await redis.del(`kb:${slug}`);
        await redis.srem('kb:_index', slug);
        console.log(`🗑️ Knowledge-Chunk gelöscht: kb:${slug}`);

        // Auto-Sync: Vektor-DB im Hintergrund aktualisieren (Orphan-Cleanup entfernt den gelöschten Chunk)
        triggerVectorSync(req);

        return res.status(200).json({ success: true, removed: slug, vectorSyncTriggered: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── Health-Check Trigger ──
    if (action === 'trigger_health_check') {
      const cronSecret = process.env.CRON_SECRET;
      const dashboardToken = process.env.EVITA_DASHBOARD_TOKEN;
      const host = req.headers.host || 'designare.at';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const baseUrl = `${protocol}://${host}`;

      try {
        console.log(`🏥 Health-Check via Dashboard: ${baseUrl}/api/cron/health-check`);
        const response = await fetch(`${baseUrl}/api/cron/health-check`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${dashboardToken || cronSecret}` }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        return res.status(200).json({ success: true, health: result });
      } catch (e) {
        return res.status(500).json({ error: `Health-Check Fehler: ${e.message}` });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ═════════════════════════════════════════════════════════════════
  // GET: Dashboard-Daten laden – ALLES PARALLEL
  // ═════════════════════════════════════════════════════════════════
  try {
    const range = parseInt(req.query?.range || '30');
    const days = getLastNDays(range);
    const todayKey = days[days.length - 1];
    const t0 = Date.now();

    // ── PHASE 1: Alle tagesbasierten Reads parallel ──────────────
    // Pro Tag: 2 Evita (daily + unique) + 2 Silas (daily + unique)
    //        + 4 Aggregationen (topics, intents, evita-models, silas-models)
    // = 8 Calls × N Tage parallel

    const [
      evitaDailyResults,
      evitaUniqueResults,
      silasDailyResults,
      silasUniqueResults,
      evitaTopicResults,
      silasIntentResults,
      evitaModelResults,
      silasModelResults
    ] = await Promise.all([
      Promise.all(days.map(d => redis.hgetall(`evita:stats:daily:${d}`).catch(() => null))),
      Promise.all(days.map(d => redis.pfcount(`evita:stats:unique:${d}`).catch(() => 0))),
      Promise.all(days.map(d => redis.hgetall(`silas:stats:daily:${d}`).catch(() => null))),
      Promise.all(days.map(d => redis.pfcount(`silas:stats:unique:${d}`).catch(() => 0))),
      Promise.all(days.map(d => redis.hgetall(`evita:stats:topics:${d}`).catch(() => null))),
      Promise.all(days.map(d => redis.hgetall(`silas:stats:intents:${d}`).catch(() => null))),
      Promise.all(days.map(d => redis.hgetall(`evita:stats:models:${d}`).catch(() => null))),
      Promise.all(days.map(d => redis.hgetall(`silas:stats:models:${d}`).catch(() => null))),
    ]);

    // ── PHASE 2: Alle Einzel-Reads parallel ──────────────────────

    const [
      topQuestionsRaw,
      silasTopKeywordsRaw,
      recentFallbacksRaw,
      silasRecentErrorsRaw,
      heatmapRaw,
      silasHeatmapRaw,
      visibilityScoresRaw,
      recentVisibilityChecksRaw,
      recentEmailsRaw,
      visibilityEmailsRaw,
      silasTemplatesRaw,
      emailBlocklistRaw,
      emailWhitelistRaw,
      buildTriggersRaw,
      buildResultsRaw,
      latestBuildRaw,
      buildInventoryRaw,
      excludedUrlsRaw,
      kbIndexRaw,
      // Health-Monitoring
      healthLatestRaw,
      healthLogRaw,
      healthIncidentsRaw,
      // Website-Roast
      roastRecentRaw,
      roastTodayRaw
    ] = await Promise.all([
      redis.zrange('evita:stats:top_questions', 0, 19, { rev: true, withScores: true }).catch(() => []),
      redis.zrange('silas:stats:top_keywords', 0, 29, { rev: true, withScores: true }).catch(() => []),
      redis.lrange('evita:stats:fallbacks', 0, 19).catch(() => []),
      redis.lrange('silas:stats:errors', 0, 19).catch(() => []),
      redis.hgetall('evita:stats:heatmap').catch(() => ({})),
      redis.hgetall('silas:stats:heatmap').catch(() => ({})),
      redis.hgetall('evita:stats:visibility_scores').catch(() => ({})),
      redis.lrange('evita:stats:visibility_checks', 0, 19).catch(() => []),
      redis.lrange('evita:stats:emails', 0, 19).catch(() => []),
      redis.lrange('evita:stats:visibility_emails', 0, 19).catch(() => []),
      redis.zrange('silas:stats:templates', 0, 9, { rev: true, withScores: true }).catch(() => []),
      redis.smembers('evita:email:blocklist').catch(() => []),
      redis.smembers('evita:email:whitelist').catch(() => []),
      redis.lrange('build:log:triggers', 0, 29).catch(() => []),
      redis.lrange('build:log:results', 0, 29).catch(() => []),
      redis.get('build:log:latest').catch(() => null),
      redis.get('build:log:inventory').catch(() => null),
      redis.smembers('build:exclude:urls').catch(() => []),
      redis.smembers('kb:_index').catch(() => []),
      // Health-Monitoring
      redis.get('health:latest').catch(() => null),
      redis.lrange('health:log', 0, 49).catch(() => []),
      redis.lrange('health:incidents', 0, 49).catch(() => []),
      // Website-Roast
      redis.lrange('evita:roast:recent', 0, 19).catch(() => []),
      redis.hgetall(`evita:roast:daily:${todayKey}`).catch(() => null),
    ]);

    console.log(`📊 Dashboard: ${days.length} Tage, alle Redis-Reads in ${Date.now() - t0}ms`);

    // ═════════════════════════════════════════════════════════════════
    // VERARBEITUNG (pure Berechnung, keine I/O mehr)
    // ═════════════════════════════════════════════════════════════════

    // ── 1. Daily Stats – Evita ──
    const dailyStats = days.map((day, i) => {
      const s = evitaDailyResults[i] || {};
      return {
        date: day,
        total_chats: safeInt(s.total_chats),
        total_messages: safeInt(s.total_messages),
        booking_intents: safeInt(s.booking_intents),
        booking_completions: safeInt(s.booking_completions),
        fallback_count: safeInt(s.fallback_count),
        new_users: safeInt(s.new_users),
        returning_users: safeInt(s.returning_users),
        visibility_checks: safeInt(s.visibility_checks),
        visibility_emails: safeInt(s.visibility_emails),
        emails_sent: safeInt(s.emails_sent),
        emails_failed: safeInt(s.emails_failed),
        unique_visitors: evitaUniqueResults[i] || 0
      };
    });

    // ── 1b. Daily Stats – Silas ──
    const silasDailyStats = days.map((day, i) => {
      const s = silasDailyResults[i] || {};
      return {
        date: day,
        total_generations: safeInt(s.total_generations),
        total_keywords: safeInt(s.total_keywords),
        successful: safeInt(s.successful),
        failed: safeInt(s.failed),
        rate_limit_hits: safeInt(s.rate_limit_hits),
        master_mode_uses: safeInt(s.master_mode_uses),
        downloads_csv: safeInt(s.downloads_csv),
        downloads_txt: safeInt(s.downloads_txt),
        downloads_html: safeInt(s.downloads_html),
        downloaded_items: safeInt(s.downloaded_items),
        unique_users: silasUniqueResults[i] || 0
      };
    });

    // ── 2. Aggregierte Zusammenfassung – Evita ──
    const totals = dailyStats.reduce((acc, day) => ({
      total_chats: acc.total_chats + day.total_chats,
      total_messages: acc.total_messages + day.total_messages,
      booking_intents: acc.booking_intents + day.booking_intents,
      booking_completions: acc.booking_completions + day.booking_completions,
      fallback_count: acc.fallback_count + day.fallback_count,
      new_users: acc.new_users + day.new_users,
      returning_users: acc.returning_users + day.returning_users,
      visibility_checks: acc.visibility_checks + day.visibility_checks,
      visibility_emails: acc.visibility_emails + day.visibility_emails,
      emails_sent: acc.emails_sent + day.emails_sent,
      emails_failed: acc.emails_failed + day.emails_failed,
      unique_visitors: acc.unique_visitors + day.unique_visitors
    }), {
      total_chats: 0, total_messages: 0, booking_intents: 0,
      booking_completions: 0, fallback_count: 0, new_users: 0,
      returning_users: 0, visibility_checks: 0, visibility_emails: 0,
      emails_sent: 0, emails_failed: 0, unique_visitors: 0
    });

    const today = dailyStats[dailyStats.length - 1] || {};

    // ── 2b. Aggregierte Zusammenfassung – Silas ──
    const silasTotals = silasDailyStats.reduce((acc, day) => ({
      total_generations: acc.total_generations + day.total_generations,
      total_keywords: acc.total_keywords + day.total_keywords,
      successful: acc.successful + day.successful,
      failed: acc.failed + day.failed,
      rate_limit_hits: acc.rate_limit_hits + day.rate_limit_hits,
      master_mode_uses: acc.master_mode_uses + day.master_mode_uses,
      downloads_csv: acc.downloads_csv + day.downloads_csv,
      downloads_txt: acc.downloads_txt + day.downloads_txt,
      downloads_html: acc.downloads_html + day.downloads_html,
      downloaded_items: acc.downloaded_items + day.downloaded_items,
      unique_users: acc.unique_users + day.unique_users
    }), {
      total_generations: 0, total_keywords: 0, successful: 0,
      failed: 0, rate_limit_hits: 0, master_mode_uses: 0,
      downloads_csv: 0, downloads_txt: 0, downloads_html: 0,
      downloaded_items: 0, unique_users: 0
    });

    const silasToday = silasDailyStats[silasDailyStats.length - 1] || {};

    // ── 3. Sorted Sets parsen ──
    const topQuestions = parseSortedSet(topQuestionsRaw, 'question');
    const silasTopKeywords = parseSortedSet(silasTopKeywordsRaw, 'keyword');
    const silasTemplates = parseSortedSet(silasTemplatesRaw, 'template');

    // ── 4. Tages-Aggregationen ──
    const topicAgg = aggregateHashesByDay(evitaTopicResults);
    const topTopics = Object.entries(topicAgg)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([topic, count]) => ({ topic, count }));

    const silasIntentAgg = aggregateHashesByDay(silasIntentResults);
    const modelAgg = aggregateHashesByDay(evitaModelResults);
    const silasModelAgg = aggregateHashesByDay(silasModelResults);

    // ── 5. Listen parsen ──
    const recentFallbacks = parseRedisList(recentFallbacksRaw, { message: '?', timestamp: null });
    const silasRecentErrors = parseRedisList(silasRecentErrorsRaw, { keyword: '?', error: '?', timestamp: null });
    const recentEmails = parseRedisList(recentEmailsRaw, { to: '?', subject: '?', success: false, timestamp: null });
    const visibilityEmails = parseRedisList(visibilityEmailsRaw);
    const recentVisibilityChecks = parseRedisList(recentVisibilityChecksRaw);
    const buildTriggers = parseRedisList(buildTriggersRaw, { timestamp: null, status: 'unknown', trigger: '?' });
    const buildResults = parseRedisList(buildResultsRaw, { timestamp: null, status: 'unknown' });

    // ── 6. Einzelwerte ──
    const heatmap = heatmapRaw || {};
    const silasHeatmap = silasHeatmapRaw || {};
    const visibilityScores = visibilityScoresRaw || {};
    const emailBlocklist = emailBlocklistRaw || [];
    const emailWhitelist = (emailWhitelistRaw || []).sort((a, b) => a.localeCompare(b));
    const excludedUrls = (excludedUrlsRaw || []).sort((a, b) => a.localeCompare(b));

    let latestBuild = null;
    if (latestBuildRaw) {
      latestBuild = typeof latestBuildRaw === 'string' ? JSON.parse(latestBuildRaw) : latestBuildRaw;
    }

    let buildInventory = null;
    if (buildInventoryRaw) {
      buildInventory = typeof buildInventoryRaw === 'string' ? JSON.parse(buildInventoryRaw) : buildInventoryRaw;
    }

    // ── Health-Monitoring Daten parsen ──
    let healthLatest = null;
    if (healthLatestRaw) {
      try {
        healthLatest = typeof healthLatestRaw === 'string' ? JSON.parse(healthLatestRaw) : healthLatestRaw;
      } catch { /* ignore */ }
    }
    const healthLog = parseRedisList(healthLogRaw);
    const healthIncidents = parseRedisList(healthIncidentsRaw);

    // ── Website-Roast Daten parsen ──
    const roastRecent = parseRedisList(roastRecentRaw);
    const roastToday = roastTodayRaw || {};

    // ── Knowledge-Base Chunks laden (basierend auf Index) ──
    const kbSlugs = (kbIndexRaw || []).sort((a, b) => a.localeCompare(b));
    let knowledgeChunks = [];
    if (kbSlugs.length > 0) {
      const chunkResults = await Promise.all(
        kbSlugs.map(slug => redis.get(`kb:${slug}`).catch(() => null))
      );
      knowledgeChunks = chunkResults.map((raw, i) => {
        if (!raw) return null;
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return { ...parsed, slug: kbSlugs[i] };
        } catch { return null; }
      }).filter(Boolean);
    }

    // ═════════════════════════════════════════════════════════════════
    // RESPONSE
    // ═════════════════════════════════════════════════════════════════
    return res.status(200).json({
      success: true,
      generated_at: new Date().toISOString(),
      range_days: range,

      summary: {
        today: {
          chats: today.total_chats || 0,
          messages: today.total_messages || 0,
          unique_visitors: today.unique_visitors || 0,
          fallbacks: today.fallback_count || 0,
          visibility_checks: today.visibility_checks || 0,
          visibility_emails: today.visibility_emails || 0,
          emails_sent: today.emails_sent || 0,
          emails_failed: today.emails_failed || 0
        },
        period: {
          ...totals,
          avg_messages_per_chat: totals.total_chats > 0
            ? Math.round((totals.total_messages / totals.total_chats) * 10) / 10
            : 0,
          fallback_rate: totals.total_messages > 0
            ? Math.round((totals.fallback_count / totals.total_messages) * 1000) / 10
            : 0,
          booking_conversion: totals.booking_intents > 0
            ? Math.round((totals.booking_completions / totals.booking_intents) * 1000) / 10
            : 0,
          returning_rate: (totals.new_users + totals.returning_users) > 0
            ? Math.round((totals.returning_users / (totals.new_users + totals.returning_users)) * 1000) / 10
            : 0
        }
      },

      daily: dailyStats,
      topQuestions,
      topTopics,
      modelUsage: modelAgg,
      recentFallbacks,
      recentEmails,
      visibilityEmails,
      emailBlocklist,
      emailWhitelist,
      heatmap,

      visibility: {
        scoreDistribution: {
          hoch: parseInt(visibilityScores?.hoch || 0),
          mittel: parseInt(visibilityScores?.mittel || 0),
          niedrig: parseInt(visibilityScores?.niedrig || 0)
        },
        recentChecks: recentVisibilityChecks
      },

      silas: {
        summary: {
          today: {
            generations: silasToday.total_generations || 0,
            keywords: silasToday.total_keywords || 0,
            successful: silasToday.successful || 0,
            failed: silasToday.failed || 0,
            rate_limit_hits: silasToday.rate_limit_hits || 0,
            unique_users: silasToday.unique_users || 0,
            downloads: (silasToday.downloads_csv || 0) + (silasToday.downloads_txt || 0) + (silasToday.downloads_html || 0)
          },
          period: {
            ...silasTotals,
            total_downloads: silasTotals.downloads_csv + silasTotals.downloads_txt + silasTotals.downloads_html,
            success_rate: (silasTotals.successful + silasTotals.failed) > 0
              ? Math.round((silasTotals.successful / (silasTotals.successful + silasTotals.failed)) * 1000) / 10
              : 0,
            avg_keywords_per_generation: silasTotals.total_generations > 0
              ? Math.round((silasTotals.total_keywords / silasTotals.total_generations) * 10) / 10
              : 0,
            master_mode_rate: silasTotals.total_generations > 0
              ? Math.round((silasTotals.master_mode_uses / silasTotals.total_generations) * 1000) / 10
              : 0
          }
        },
        daily: silasDailyStats,
        topKeywords: silasTopKeywords,
        intentDistribution: silasIntentAgg,
        modelUsage: silasModelAgg,
        templates: silasTemplates,
        recentErrors: silasRecentErrors,
        heatmap: silasHeatmap
      },

      buildLog: {
        latest: latestBuild,
        triggers: buildTriggers,
        results: buildResults,
        inventory: buildInventory,
        excludedUrls: excludedUrls
      },

      knowledgeChunks,

      health: {
        latest: healthLatest,
        log: healthLog,
        incidents: healthIncidents
      },

      // NEU: Website-Roast
      roast: {
        today: {
          total: safeInt(roastToday?.total),
          note_1: safeInt(roastToday?.note_1),
          note_2: safeInt(roastToday?.note_2),
          note_3: safeInt(roastToday?.note_3),
          note_4: safeInt(roastToday?.note_4),
          note_5: safeInt(roastToday?.note_5)
        },
        recentChecks: roastRecent
      }
    });

  } catch (error) {
    console.error('Dashboard API Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
