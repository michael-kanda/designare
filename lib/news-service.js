// lib/news-service.js - Liest das tägliche Tech-News-Briefing aus Redis
// Wird vom Cron-Job /api/cron/fetch-news befüllt
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const NEWS_CACHE_KEY = 'news:daily-briefing';

/**
 * Holt das tägliche News-Briefing aus Redis.
 * @returns {Promise<string>} News-Kontext für den System-Prompt, oder leer
 */
export async function getNewsContext() {
  try {
    const cached = await redis.get(NEWS_CACHE_KEY);
    if (!cached) {
      console.log('📰 Kein News-Briefing im Cache');
      return '';
    }

    const briefing = typeof cached === 'string' ? JSON.parse(cached) : cached;

    // Prüfe ob das Briefing von heute ist (max. 20 Stunden alt)
    const fetchedAt = new Date(briefing.fetchedAt);
    const ageHours = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);

    if (ageHours > 20) {
      console.log(`📰 News-Briefing veraltet (${Math.round(ageHours)}h alt)`);
      return '';
    }

    console.log(`📰 News-Briefing geladen (${Math.round(ageHours)}h alt, ${briefing.sources?.length || 0} Quellen)`);
    return briefing.summary || '';

  } catch (err) {
    console.warn('⚠️ News-Service Fehler:', err.message);
    return '';
  }
}

/**
 * Speichert das tägliche News-Briefing in Redis.
 * Wird vom Cron-Job aufgerufen.
 * @param {string} summary - Zusammenfassung für Evita
 * @param {string[]} sources - Verwendete Quellen
 */
export async function saveNewsBriefing(summary, sources = []) {
  try {
    const data = {
      summary,
      sources,
      fetchedAt: new Date().toISOString()
    };
    // TTL: 24 Stunden
    await redis.set(NEWS_CACHE_KEY, JSON.stringify(data), { ex: 86400 });
    console.log(`📰 News-Briefing gespeichert (${summary.length} Zeichen, ${sources.length} Quellen)`);
  } catch (err) {
    console.error('❌ News-Briefing Speicherfehler:', err.message);
    throw err;
  }
}
