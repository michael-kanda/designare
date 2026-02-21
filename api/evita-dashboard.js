// api/evita-dashboard.js - Dashboard-API für Evita- & Silas-Statistiken
// Authentifizierung via Bearer Token (EVITA_DASHBOARD_TOKEN in Vercel Env)
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ===================================================================
// AUTH CHECK
// ===================================================================
function isAuthorized(req) {
  const token = process.env.EVITA_DASHBOARD_TOKEN;
  if (!token) return false; // Kein Token konfiguriert = Dashboard gesperrt

  // Bearer Token aus Header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1] === token;
  }

  // Alternativ: Query-Parameter (für einfaches Bookmarking)
  const queryToken = req.query?.token;
  return queryToken === token;
}

// ===================================================================
// HELPER: Letzte N Tage als Array
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

// ===================================================================
// MAIN HANDLER
// ===================================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth prüfen
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized. Token required.' });
  }

  try {
    const range = parseInt(req.query?.range || '30'); // Default: 30 Tage
    const days = getLastNDays(range);

    // ===============================================================
    // 1. DAILY STATS – EVITA (Nachrichten, Chats, Bookings, Fallbacks)
    // ===============================================================
    const dailyStats = [];
    
    for (const day of days) {
      const [stats, uniqueCount] = await Promise.all([
        redis.hgetall(`evita:stats:daily:${day}`),
        redis.pfcount(`evita:stats:unique:${day}`)
      ]);

      dailyStats.push({
        date: day,
        total_chats: parseInt(stats?.total_chats || 0),
        total_messages: parseInt(stats?.total_messages || 0),
        booking_intents: parseInt(stats?.booking_intents || 0),
        booking_completions: parseInt(stats?.booking_completions || 0),
        fallback_count: parseInt(stats?.fallback_count || 0),
        new_users: parseInt(stats?.new_users || 0),
        returning_users: parseInt(stats?.returning_users || 0),
        visibility_checks: parseInt(stats?.visibility_checks || 0),
        visibility_emails: parseInt(stats?.visibility_emails || 0),
        emails_sent: parseInt(stats?.emails_sent || 0),
        emails_failed: parseInt(stats?.emails_failed || 0),
        unique_visitors: uniqueCount || 0
      });
    }

    // ===============================================================
    // 1b. DAILY STATS – SILAS
    // ===============================================================
    const silasDailyStats = [];

    for (const day of days) {
      const [stats, uniqueCount] = await Promise.all([
        redis.hgetall(`silas:stats:daily:${day}`),
        redis.pfcount(`silas:stats:unique:${day}`)
      ]);

      silasDailyStats.push({
        date: day,
        total_generations: parseInt(stats?.total_generations || 0),
        total_keywords: parseInt(stats?.total_keywords || 0),
        successful: parseInt(stats?.successful || 0),
        failed: parseInt(stats?.failed || 0),
        rate_limit_hits: parseInt(stats?.rate_limit_hits || 0),
        master_mode_uses: parseInt(stats?.master_mode_uses || 0),
        downloads_csv: parseInt(stats?.downloads_csv || 0),
        downloads_txt: parseInt(stats?.downloads_txt || 0),
        downloads_html: parseInt(stats?.downloads_html || 0),
        downloaded_items: parseInt(stats?.downloaded_items || 0),
        unique_users: uniqueCount || 0
      });
    }

    // ===============================================================
    // 2. AGGREGIERTE ZUSAMMENFASSUNG – EVITA
    // ===============================================================
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

    // Heute separat – Evita
    const today = dailyStats[dailyStats.length - 1] || {};

    // ===============================================================
    // 2b. AGGREGIERTE ZUSAMMENFASSUNG – SILAS
    // ===============================================================
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

    // Heute separat – Silas
    const silasToday = silasDailyStats[silasDailyStats.length - 1] || {};

    // ===============================================================
    // 3. TOP-FRAGEN – EVITA (Sorted Set, Top 20)
    // ===============================================================
    let topQuestions = [];
    try {
      const raw = await redis.zrange('evita:stats:top_questions', 0, 19, { rev: true, withScores: true });
      for (let i = 0; i < raw.length; i += 2) {
        topQuestions.push({
          question: raw[i],
          count: parseInt(raw[i + 1])
        });
      }
    } catch (e) {
      console.error('Top-Fragen Fehler:', e.message);
    }

    // ===============================================================
    // 3b. TOP-KEYWORDS – SILAS (Sorted Set, Top 30)
    // ===============================================================
    let silasTopKeywords = [];
    try {
      const raw = await redis.zrange('silas:stats:top_keywords', 0, 29, { rev: true, withScores: true });
      for (let i = 0; i < raw.length; i += 2) {
        silasTopKeywords.push({
          keyword: raw[i],
          count: parseInt(raw[i + 1])
        });
      }
    } catch (e) {
      console.error('Silas Top-Keywords Fehler:', e.message);
    }

    // ===============================================================
    // 4. THEMEN-AGGREGATION – EVITA (letzte N Tage)
    // ===============================================================
    const topicAgg = {};
    for (const day of days) {
      try {
        const topics = await redis.hgetall(`evita:stats:topics:${day}`);
        if (topics) {
          Object.entries(topics).forEach(([topic, count]) => {
            topicAgg[topic] = (topicAgg[topic] || 0) + parseInt(count);
          });
        }
      } catch (e) {}
    }

    const topTopics = Object.entries(topicAgg)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([topic, count]) => ({ topic, count }));

    // ===============================================================
    // 4b. INTENT-VERTEILUNG – SILAS (letzte N Tage)
    // ===============================================================
    const silasIntentAgg = {};
    for (const day of days) {
      try {
        const intents = await redis.hgetall(`silas:stats:intents:${day}`);
        if (intents) {
          Object.entries(intents).forEach(([intent, count]) => {
            silasIntentAgg[intent] = (silasIntentAgg[intent] || 0) + parseInt(count);
          });
        }
      } catch (e) {}
    }

    // ===============================================================
    // 5. MODELL-NUTZUNG – EVITA (letzte N Tage aggregiert)
    // ===============================================================
    const modelAgg = {};
    for (const day of days) {
      try {
        const models = await redis.hgetall(`evita:stats:models:${day}`);
        if (models) {
          Object.entries(models).forEach(([model, count]) => {
            modelAgg[model] = (modelAgg[model] || 0) + parseInt(count);
          });
        }
      } catch (e) {}
    }

    // ===============================================================
    // 5b. MODELL-NUTZUNG – SILAS
    // ===============================================================
    const silasModelAgg = {};
    for (const day of days) {
      try {
        const models = await redis.hgetall(`silas:stats:models:${day}`);
        if (models) {
          Object.entries(models).forEach(([model, count]) => {
            silasModelAgg[model] = (silasModelAgg[model] || 0) + parseInt(count);
          });
        }
      } catch (e) {}
    }

    // ===============================================================
    // 6. FALLBACK-NACHRICHTEN – EVITA (letzte 20)
    // ===============================================================
    let recentFallbacks = [];
    try {
      const raw = await redis.lrange('evita:stats:fallbacks', 0, 19);
      recentFallbacks = raw.map(entry => {
        try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
        catch { return { message: entry, timestamp: null }; }
      });
    } catch (e) {}

    // ===============================================================
    // 6b. FEHLER-LOG – SILAS (letzte 20)
    // ===============================================================
    let silasRecentErrors = [];
    try {
      const raw = await redis.lrange('silas:stats:errors', 0, 19);
      silasRecentErrors = raw.map(entry => {
        try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
        catch { return { keyword: '?', error: entry, timestamp: null }; }
      });
    } catch (e) {}

    // ===============================================================
    // 7. HEATMAP – EVITA (Wochentag × Stunde)
    // ===============================================================
    let heatmap = {};
    try {
      heatmap = await redis.hgetall('evita:stats:heatmap') || {};
    } catch (e) {}

    // ===============================================================
    // 7b. HEATMAP – SILAS
    // ===============================================================
    let silasHeatmap = {};
    try {
      silasHeatmap = await redis.hgetall('silas:stats:heatmap') || {};
    } catch (e) {}

    // ===============================================================
    // 8. VISIBILITY-CHECK STATISTIKEN
    // ===============================================================
    let visibilityScores = {};
    try {
      visibilityScores = await redis.hgetall('evita:stats:visibility_scores') || {};
    } catch (e) {}

    let recentVisibilityChecks = [];
    try {
      const raw = await redis.lrange('evita:stats:visibility_checks', 0, 19);
      recentVisibilityChecks = raw.map(entry => {
        try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
        catch { return null; }
      }).filter(Boolean);
    } catch (e) {}

    // ===============================================================
    // 9. E-MAIL-VERSAND LOG (letzte 20)
    // ===============================================================
    let recentEmails = [];
    try {
      const raw = await redis.lrange('evita:stats:emails', 0, 19);
      recentEmails = raw.map(entry => {
        try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
        catch { return { to: '?', subject: '?', success: false, timestamp: null }; }
      });
    } catch (e) {}

    // ===============================================================
    // 9a. VISIBILITY REPORT-MAILS (letzte 20)
    // ===============================================================
    let visibilityEmails = [];
    try {
      const raw = await redis.lrange('evita:stats:visibility_emails', 0, 19);
      visibilityEmails = raw.map(entry => {
        try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
        catch { return null; }
      }).filter(Boolean);
    } catch (e) {}

    // ===============================================================
    // 9b. TEMPLATE-NUTZUNG – SILAS
    // ===============================================================
    let silasTemplates = [];
    try {
      const raw = await redis.zrange('silas:stats:templates', 0, 9, { rev: true, withScores: true });
      for (let i = 0; i < raw.length; i += 2) {
        silasTemplates.push({
          template: raw[i],
          count: parseInt(raw[i + 1])
        });
      }
    } catch (e) {}

    // ===============================================================
    // RESPONSE
    // ===============================================================
    return res.status(200).json({
      success: true,
      generated_at: new Date().toISOString(),
      range_days: range,

      // ── EVITA ──────────────────────────────────────────────────
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
      heatmap,

      visibility: {
        scoreDistribution: {
          hoch: parseInt(visibilityScores?.hoch || 0),
          mittel: parseInt(visibilityScores?.mittel || 0),
          niedrig: parseInt(visibilityScores?.niedrig || 0)
        },
        recentChecks: recentVisibilityChecks
      },

      // ── SILAS ──────────────────────────────────────────────────
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
      }
    });

  } catch (error) {
    console.error('Dashboard API Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
